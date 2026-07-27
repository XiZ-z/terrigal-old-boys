// Password-gated: returns every pending submission (with its photo inlined
// as a data URL) for review.html to render.
const { ALL_ROUNDS, computeFinalsState } = require('../../data.js');
const { sheetsStore, isAuthed, json } = require('./lib/shared');

// Real team numbers for each submission, so the reviewer sees "Team 3 v
// Team 6" instead of generic A/B sides. Weekly pairings are a fixed
// schedule (ALL_ROUNDS), so this is always accurate. Finals pairings for
// game1-3 come from ladder seeding and are resolvable as soon as there are
// enough weekly results in; semis/final additionally need the earlier
// finals matches approved, so those resolve to null until then. This uses
// whatever data.js was last deployed to poc, so it can lag behind dev's
// live results for finals specifically -- fine for now since finals are
// months away.
function resolveTeams(record) {
  if (record.mode === 'weekly') {
    const slot = Number(record.key.split('-')[1]);
    const [teamA, teamB] = ALL_ROUNDS[record.roundNum - 1][slot];
    return { teamA, teamB };
  }
  const state = computeFinalsState();
  const slotInfo = state[record.finalsSlot];
  return slotInfo ? { teamA: slotInfo.teamA, teamB: slotInfo.teamB } : { teamA: null, teamB: null };
}

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
    const photoBytes = await store.get(`pending/${id}.jpg`, { type: 'arrayBuffer' });
    const photoDataUrl = `data:image/jpeg;base64,${Buffer.from(photoBytes).toString('base64')}`;
    return { ...record, ...resolveTeams(record), photoDataUrl };
  }));

  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return json(200, { items });
};
