// Public endpoint (no auth) -- a club member submits a score sheet photo.
// Reads the totals off it with Claude vision and stages it for Ash to
// review; nothing here touches data.js directly.
const { randomUUID } = require('crypto');
const { slotForCourt } = require('../../data.js');
const { sheetsStore, json, readScoreSheet } = require('./lib/shared');

const FINALS_SLOTS = ['game1', 'game2', 'game3', 'semi1', 'semi2', 'final'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { mode, mediaType, photoBase64 } = payload;
  if (!photoBase64 || !mediaType) return json(400, { error: 'Missing photo' });

  let blockConst, keyLiteral, key, roundNum = null, courtNum = null, finalsSlot = null;

  if (mode === 'weekly') {
    roundNum = Number(payload.roundNum);
    courtNum = Number(payload.courtNum);
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
  } else if (mode === 'finals') {
    finalsSlot = payload.finalsSlot;
    if (!FINALS_SLOTS.includes(finalsSlot)) return json(400, { error: 'Invalid finals slot' });
    key = finalsSlot;
    blockConst = 'FINALS_RESULTS';
    keyLiteral = finalsSlot;
  } else {
    return json(400, { error: 'mode must be "weekly" or "finals"' });
  }

  let extracted;
  try {
    extracted = await readScoreSheet(photoBase64, mediaType, mode === 'finals');
  } catch (err) {
    return json(502, { error: `Could not read the photo: ${err.message}` });
  }

  const id = randomUUID();
  const store = sheetsStore();
  await store.set(`pending/${id}.jpg`, Buffer.from(photoBase64, 'base64'));
  await store.setJSON(`pending/${id}.json`, {
    id, mode, blockConst, keyLiteral, key,
    roundNum, courtNum, finalsSlot,
    extracted,
    createdAt: new Date().toISOString(),
  });

  return json(200, { ok: true, id, key, extracted });
};
