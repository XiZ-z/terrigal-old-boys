// Password-gated: publishes an approved (possibly Ash-corrected) result, or
// a wet-round report, straight to data.js on GITHUB_BRANCH via the GitHub
// Contents API, then archives the pending record (kept, not deleted, as an
// audit trail).
const { RESERVE_DATES } = require('../../data.js');
const { sheetsStore, isAuthed, json, getDataJs, putDataJs, upsertEntry, upsertWetRound, upsertFinalsWetWeek, resolveDate, dateSlug, slotForCourt, FINALS_SLOTS, FINALS_STAGES } = require('./lib/shared');

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
      // finalsStage can be corrected at review time (e.g. wrong stage picked
      // when reporting a wet week) -- defaults to whatever was submitted.
      const finalsStage = payload.finalsStage || record.finalsStage;
      if (!FINALS_STAGES.includes(finalsStage)) return json(400, { error: 'Invalid finals stage' });

      const { content, sha } = await getDataJs();
      const newContent = upsertFinalsWetWeek(content, finalsStage);
      await putDataJs(newContent, sha, `Push ${finalsStage} back a week for wet weather (approved via review)`);

      await store.setJSON(`approved/${id}.json`, { ...record, finalsStage, approvedAt: new Date().toISOString() });
      await store.delete(`pending/${id}.json`);
      return json(200, { ok: true, key: `wet-finals-${finalsStage}` });
    }

    if (record.wet) {
      // roundNum can be corrected at review time (e.g. wrong round picked
      // when reporting a wet week) -- defaults to whatever was submitted.
      const roundNum = payload.roundNum !== undefined ? Number(payload.roundNum) : record.roundNum;
      if (!Number.isInteger(roundNum) || roundNum < 1 || roundNum > 14) {
        return json(400, { error: 'Invalid round number' });
      }

      const { content, sha } = await getDataJs();
      const newContent = upsertWetRound(content, roundNum, RESERVE_DATES);
      await putDataJs(newContent, sha, `Mark Round ${roundNum} as WET (approved via review)`);

      await store.setJSON(`approved/${id}.json`, { ...record, roundNum, approvedAt: new Date().toISOString() });
      await store.delete(`pending/${id}.json`);
      return json(200, { ok: true, key: `wet-round-${roundNum}` });
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

    // Round/court (weekly) or finals slot (finals) can be corrected at
    // review time -- e.g. the wrong round or court was picked at upload.
    // Recompute the data.js key from the correction rather than trusting
    // whatever the pending record was originally staged under.
    let { roundNum, courtNum, finalsSlot, blockConst, keyLiteral, key } = record;
    if (record.mode === 'weekly') {
      if (payload.roundNum !== undefined) roundNum = Number(payload.roundNum);
      if (payload.courtNum !== undefined) courtNum = Number(payload.courtNum);
      if (!Number.isInteger(roundNum) || roundNum < 1 || roundNum > 14) {
        return json(400, { error: 'Invalid round number' });
      }
      if (!Number.isInteger(courtNum) || courtNum < 1 || courtNum > 4) {
        return json(400, { error: 'Invalid court number' });
      }
      const slot = slotForCourt(roundNum, courtNum);
      key = `${roundNum}-${slot}`;
      blockConst = 'RESULTS';
      keyLiteral = `"${key}"`;
    } else if (record.mode === 'finals' && payload.finalsSlot !== undefined) {
      finalsSlot = payload.finalsSlot;
      if (!FINALS_SLOTS.includes(finalsSlot)) return json(400, { error: 'Invalid finals slot' });
      key = finalsSlot;
      blockConst = 'FINALS_RESULTS';
      keyLiteral = finalsSlot;
    }
    const correctedRecord = { ...record, roundNum, courtNum, finalsSlot, blockConst, keyLiteral, key };

    let valueLiteral = `{ setsA: ${setsA}, setsB: ${setsB}, gamesA: ${gamesA}, gamesB: ${gamesB} }`;
    if (record.mode === 'finals') {
      const winner = payload.winner === 'B' ? 'B' : 'A';
      valueLiteral = `{ setsA: ${setsA}, setsB: ${setsB}, gamesA: ${gamesA}, gamesB: ${gamesB}, winner: '${winner}' }`;
    }

    const { content, sha } = await getDataJs();
    const newContent = upsertEntry(content, blockConst, keyLiteral, valueLiteral);
    await putDataJs(
      newContent,
      sha,
      `Add result ${key} (approved via review)`
    );

    // Nest approved photos under date/court (or date/finals-slot) so
    // they're browsable at a glance in the Blobs dashboard, not just a flat
    // pile of ids -- pending stays flat since it's only ever looked at
    // once, right before approval.
    const folder = correctedRecord.mode === 'weekly' ? `court${courtNum}` : finalsSlot;
    const approvedId = `${dateSlug(resolveDate(correctedRecord))}/${folder}/${id}`;

    const { data: photoBytes, metadata: photoMetadata } = await store.getWithMetadata(`pending/${id}.jpg`, { type: 'arrayBuffer' });
    await store.set(`approved/${approvedId}.jpg`, Buffer.from(photoBytes), { metadata: photoMetadata });
    await store.setJSON(`approved/${approvedId}.json`, {
      ...correctedRecord,
      id: approvedId,
      approved: { setsA, setsB, gamesA, gamesB, winner: payload.winner },
      approvedAt: new Date().toISOString(),
    });
    await store.delete(`pending/${id}.json`);
    await store.delete(`pending/${id}.jpg`);

    return json(200, { ok: true, key });
  } catch (err) {
    // If this happens after the GitHub commit already landed, the result
    // IS live -- retrying is safe (upsertEntry/upsertWetRound/
    // upsertFinalsWetWeek are all idempotent), it just re-does the commit
    // and finishes the archive step that failed the first time.
    return json(500, { error: `Approve failed: ${err.message}. Safe to retry -- if it already published, retrying just re-confirms it.` });
  }
};
