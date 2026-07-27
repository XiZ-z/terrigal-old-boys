// Password-gated: returns every approved submission (photo + the final
// recorded numbers, not the raw AI extraction) for review.html's Archive
// tab -- lets Ash browse back through previously uploaded score sheets.
const { sheetsStore, isAuthed, json, resolveTeams } = require('./lib/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!isAuthed(event)) return json(401, { error: 'Unauthorized' });

  try {
    const store = sheetsStore();
    const { blobs } = await store.list({ prefix: 'approved/' });
    const ids = [...new Set(
      blobs
        .filter(b => b.key.endsWith('.json'))
        .map(b => b.key.slice('approved/'.length, -'.json'.length))
    )];

    const items = (await Promise.all(ids.map(async id => {
      const record = await store.get(`approved/${id}.json`, { type: 'json' });
      if (!record) return null; // list() briefly surfacing a not-yet-propagated key
      if (record.wet) return record; // no photo -- just records what got marked postponed
      const photoBytes = await store.get(`approved/${id}.jpg`, { type: 'arrayBuffer' });
      const photoDataUrl = `data:image/jpeg;base64,${Buffer.from(photoBytes).toString('base64')}`;
      return { ...record, ...resolveTeams(record), photoDataUrl };
    }))).filter(Boolean);

    items.sort((a, b) => (b.approvedAt || '').localeCompare(a.approvedAt || ''));
    return json(200, { items });
  } catch (err) {
    return json(500, { error: `Could not load the archive: ${err.message}` });
  }
};
