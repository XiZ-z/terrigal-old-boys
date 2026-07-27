// Password-gated: returns every pending submission (with its photo inlined
// as a data URL) for review.html to render.
const { sheetsStore, isAuthed, json, resolveTeams } = require('./lib/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!isAuthed(event)) return json(401, { error: 'Unauthorized' });

  const store = sheetsStore();
  const { blobs } = await store.list({ prefix: 'pending/' });
  const ids = [...new Set(
    blobs
      .filter(b => b.key.endsWith('.json'))
      .map(b => b.key.slice('pending/'.length, -'.json'.length))
  )];

  const items = await Promise.all(ids.map(async id => {
    const record = await store.get(`pending/${id}.json`, { type: 'json' });
    if (record.wet) return record; // no photo, no teams -- just a round number
    const photoBytes = await store.get(`pending/${id}.jpg`, { type: 'arrayBuffer' });
    const photoDataUrl = `data:image/jpeg;base64,${Buffer.from(photoBytes).toString('base64')}`;
    return { ...record, ...resolveTeams(record), photoDataUrl };
  }));

  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return json(200, { items });
};
