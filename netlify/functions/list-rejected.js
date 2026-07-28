// Password-gated: returns every rejected submission's metadata (the raw AI
// extraction, plus rejection reason/time) for review.html's Archive tab.
// Photos are NOT inlined here -- fetched separately via get-photo.js, same
// reason as list-approved.js.
const { sheetsStore, isAuthed, json, resolveTeams } = require('./lib/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!isAuthed(event)) return json(401, { error: 'Unauthorized' });

  try {
    const store = sheetsStore();
    const { blobs } = await store.list({ prefix: 'rejected/' });
    const ids = [...new Set(
      blobs
        .filter(b => b.key.endsWith('.json'))
        .map(b => b.key.slice('rejected/'.length, -'.json'.length))
    )];

    const items = (await Promise.all(ids.map(async id => {
      const record = await store.get(`rejected/${id}.json`, { type: 'json' });
      if (!record) return null; // list() briefly surfacing a not-yet-propagated key
      if (record.wet) return record; // no photo -- just records what got marked postponed
      return { ...record, ...resolveTeams(record) };
    }))).filter(Boolean);

    items.sort((a, b) => (b.rejectedAt || '').localeCompare(a.rejectedAt || ''));
    return json(200, { items });
  } catch (err) {
    return json(500, { error: `Could not load rejected submissions: ${err.message}` });
  }
};
