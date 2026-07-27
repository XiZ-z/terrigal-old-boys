// Password-gated: returns every pending submission's metadata for
// review.html to render. Photos are NOT inlined here -- review.html fetches
// each one separately via get-photo.js, since combining them all into one
// response hits Netlify's 6MB function response cap as soon as more than a
// couple of photos are pending at once.
const { sheetsStore, isAuthed, json, resolveTeams } = require('./lib/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!isAuthed(event)) return json(401, { error: 'Unauthorized' });

  try {
    const store = sheetsStore();
    const { blobs } = await store.list({ prefix: 'pending/' });
    const ids = [...new Set(
      blobs
        .filter(b => b.key.endsWith('.json'))
        .map(b => b.key.slice('pending/'.length, -'.json'.length))
    )];

    const items = (await Promise.all(ids.map(async id => {
      const record = await store.get(`pending/${id}.json`, { type: 'json' });
      // list() can momentarily surface a key just before its own write has
      // fully propagated -- skip it rather than crashing the whole
      // request (which, without this, silently hid every other pending
      // item too, not just the one that raced).
      if (!record) return null;
      if (record.wet) return record; // no photo, no teams -- just a round number
      return { ...record, ...resolveTeams(record) };
    }))).filter(Boolean);

    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return json(200, { items });
  } catch (err) {
    return json(500, { error: `Could not load pending submissions: ${err.message}` });
  }
};
