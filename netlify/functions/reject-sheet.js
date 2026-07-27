// Password-gated: discards a pending submission. No data.js change.
const { sheetsStore, isAuthed, json } = require('./lib/shared');

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
  await store.delete(`pending/${id}.json`);
  await store.delete(`pending/${id}.jpg`);

  return json(200, { ok: true });
};
