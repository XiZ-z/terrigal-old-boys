// Password-gated: publishes an approved (possibly Ash-corrected) result, or
// a wet-round report, straight to data.js on GITHUB_BRANCH via the GitHub
// Contents API, then archives the pending record (kept, not deleted, as an
// audit trail).
const { RESERVE_DATES } = require('../../data.js');
const { sheetsStore, isAuthed, json, getDataJs, putDataJs, upsertEntry, upsertWetRound, upsertFinalsWetWeek, resolveDate, dateSlug } = require('./lib/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!isAuthed(event)) return json(401, { error: 'Unauthorized' });

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { id } = payload;
  const store = sheetsStore();

  try {
    const record = await store.get(`pending/${id}.json`, { type: 'json' });
    if (!record) return json(404, { error: 'Pending submission not found' });

    if (record.wet && record.mode === 'finals') {
      const { content, sha } = await getDataJs();
      const newContent = upsertFinalsWetWeek(content, record.finalsStage);
      await putDataJs(newContent, sha, `Push ${record.finalsStage} back a week for wet weather (approved via review)`);

      await store.setJSON(`approved/${id}.json`, { ...record, approvedAt: new Date().toISOString() });
      await store.delete(`pending/${id}.json`);
      return json(200, { ok: true, key: `wet-finals-${record.finalsStage}` });
    }

    if (record.wet) {
      const { content, sha } = await getDataJs();
      const newContent = upsertWetRound(content, record.roundNum, RESERVE_DATES);
      await putDataJs(newContent, sha, `Mark Round ${record.roundNum} as WET (approved via review)`);

      await store.setJSON(`approved/${id}.json`, { ...record, approvedAt: new Date().toISOString() });
      await store.delete(`pending/${id}.json`);
      return json(200, { ok: true, key: `wet-round-${record.roundNum}` });
    }

    const setsA = Number(payload.setsA);
    const setsB = Number(payload.setsB);
    const gamesA = Number(payload.gamesA);
    const gamesB = Number(payload.gamesB);
    if ([setsA, setsB, gamesA, gamesB].some(n => !Number.isFinite(n))) {
      return json(400, { error: 'setsA/setsB/gamesA/gamesB must be numbers' });
    }
    // Sanity bounds -- catches a fat-finger correction typo (e.g. "44"
    // instead of "4") before it corrupts the ladder, rather than trusting
    // whatever gets typed into the review page's number fields.
    if (setsA < 0 || setsA > 6 || setsB < 0 || setsB > 6 || gamesA < 0 || gamesA > 48 || gamesB < 0 || gamesB > 48) {
      return json(400, { error: 'Sets must be 0-6 and games 0-48 -- check for a typo before approving.' });
    }

    let valueLiteral = `{ setsA: ${setsA}, setsB: ${setsB}, gamesA: ${gamesA}, gamesB: ${gamesB} }`;
    if (record.mode === 'finals') {
      const winner = payload.winner === 'B' ? 'B' : 'A';
      valueLiteral = `{ setsA: ${setsA}, setsB: ${setsB}, gamesA: ${gamesA}, gamesB: ${gamesB}, winner: '${winner}' }`;
    }

    const { content, sha } = await getDataJs();
    const newContent = upsertEntry(content, record.blockConst, record.keyLiteral, valueLiteral);
    await putDataJs(
      newContent,
      sha,
      `Add result ${record.key} (approved via review)`
    );

    // Nest approved photos under date/court (or date/finals-slot) so
    // they're browsable at a glance in the Blobs dashboard, not just a flat
    // pile of ids -- pending stays flat since it's only ever looked at
    // once, right before approval.
    const folder = record.mode === 'weekly' ? `court${record.courtNum}` : record.finalsSlot;
    const approvedId = `${dateSlug(resolveDate(record))}/${folder}/${id}`;

    const { data: photoBytes, metadata: photoMetadata } = await store.getWithMetadata(`pending/${id}.jpg`, { type: 'arrayBuffer' });
    await store.set(`approved/${approvedId}.jpg`, Buffer.from(photoBytes), { metadata: photoMetadata });
    await store.setJSON(`approved/${approvedId}.json`, {
      ...record,
      id: approvedId,
      approved: { setsA, setsB, gamesA, gamesB, winner: payload.winner },
      approvedAt: new Date().toISOString(),
    });
    await store.delete(`pending/${id}.json`);
    await store.delete(`pending/${id}.jpg`);

    return json(200, { ok: true, key: record.key });
  } catch (err) {
    // If this happens after the GitHub commit already landed, the result
    // IS live -- retrying is safe (upsertEntry/upsertWetRound/
    // upsertFinalsWetWeek are all idempotent), it just re-does the commit
    // and finishes the archive step that failed the first time.
    return json(500, { error: `Approve failed: ${err.message}. Safe to retry -- if it already published, retrying just re-confirms it.` });
  }
};
