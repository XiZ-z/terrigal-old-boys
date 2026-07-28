// Password-gated: archives a rejected submission (audit trail, same idea as
// approve-sheet's `approved/` archive) then discards it from pending. No
// data.js change.
const { sheetsStore, isAuthed, json, resolveDate, dateSlug } = require('./lib/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!isAuthed(event)) return json(401, { error: 'Unauthorized' });

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { id, reason } = payload;
  const store = sheetsStore();

  const record = await store.get(`pending/${id}.json`, { type: 'json' });
  if (!record) return json(200, { ok: true }); // already gone -- nothing to archive, safe no-op

  const rejectedAt = new Date().toISOString();

  if (record.wet) {
    // No photo to archive -- just the record itself.
    await store.setJSON(`rejected/${id}.json`, { ...record, rejectedAt, reason: reason || null });
    await store.delete(`pending/${id}.json`);
    return json(200, { ok: true });
  }

  // Same date/court (or date/finals-slot) nesting as approve-sheet's
  // `approved/` archive, so rejected photos are just as easy to browse.
  const folder = record.mode === 'weekly' ? `court${record.courtNum}` : record.finalsSlot;
  const rejectedId = `${dateSlug(resolveDate(record))}/${folder}/${id}`;

  const { data: photoBytes, metadata: photoMetadata } = await store.getWithMetadata(`pending/${id}.jpg`, { type: 'arrayBuffer' });
  await store.set(`rejected/${rejectedId}.jpg`, Buffer.from(photoBytes), { metadata: photoMetadata });
  await store.setJSON(`rejected/${rejectedId}.json`, { ...record, id: rejectedId, rejectedAt, reason: reason || null });
  await store.delete(`pending/${id}.json`);
  await store.delete(`pending/${id}.jpg`);

  return json(200, { ok: true });
};
