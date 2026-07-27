// Shared helpers for the score-sheet upload/review functions.
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'sheets';

// getStore(name) alone relies on Netlify auto-injecting site credentials
// into the function's environment, which isn't reliably present in every
// deploy context -- falls back to explicit siteID/token (a Netlify
// Personal Access Token) when those are configured, since that's Netlify's
// own documented fix for MissingBlobsEnvironmentError.
function sheetsStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({
      name: STORE_NAME,
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN,
    });
  }
  return getStore(STORE_NAME);
}

// Single shared password gate (env var REVIEW_PASSWORD) -- proportionate
// to a single-admin, low-stakes internal tool. Sent as a bearer header.
function isAuthed(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  return !!process.env.REVIEW_PASSWORD && token === process.env.REVIEW_PASSWORD;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------- GitHub Contents API (commits approved results to data.js) ----------
const GITHUB_API = 'https://api.github.com';

async function githubRequest(path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function getDataJs() {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH;
  const data = await githubRequest(`/repos/${repo}/contents/data.js?ref=${branch}`);
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

async function putDataJs(newContent, sha, message) {
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH;
  return githubRequest(`/repos/${repo}/contents/data.js`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(newContent, 'utf-8').toString('base64'),
      sha,
      branch,
    }),
  });
}

// Inserts or replaces a single entry inside a top-level `const NAME = { ... };`
// object literal in data.js's source text -- idempotent (resubmitting the
// same key updates it in place instead of duplicating it). keyLiteral is the
// exact source text of the key, e.g. `"3-2"` (weekly) or `game1` (finals).
function upsertEntry(content, blockConst, keyLiteral, valueLiteral) {
  const startMarker = `const ${blockConst} = {`;
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`${blockConst} not found in data.js`);
  const bodyStart = startIdx + startMarker.length;
  const endIdx = content.indexOf('\n};', bodyStart);
  if (endIdx === -1) throw new Error(`${blockConst} closing not found`);

  let body = content.slice(bodyStart, endIdx);
  const escapedKey = keyLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRe = new RegExp(`\\n[ \\t]*${escapedKey}\\s*:\\s*\\{[^}]*\\},?`);
  const newLine = `\n  ${keyLiteral}: ${valueLiteral},`;

  body = lineRe.test(body) ? body.replace(lineRe, newLine) : body + newLine;

  return content.slice(0, bodyStart) + body + content.slice(endIdx);
}

// Marks a round postponed in WET_ROUNDS, auto-assigning the correct reserve
// date per the season's fixed rule: the first wet round of the season gets
// the first reserve date, the second wet round gets the second, and any
// further one has nowhere to go and is recorded as still-TBC (null) --
// mirrors the manual process this replaces. reserveDates is data.js's own
// RESERVE_DATES, passed in so this stays in sync with the season config.
function upsertWetRound(content, roundNum, reserveDates) {
  const startMarker = 'const WET_ROUNDS = {';
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) throw new Error('WET_ROUNDS not found in data.js');
  const bodyStart = startIdx + startMarker.length;
  const endIdx = content.indexOf('\n};', bodyStart);
  if (endIdx === -1) throw new Error('WET_ROUNDS closing not found');

  let body = content.slice(bodyStart, endIdx);

  // Ignore the commented-out example line when deciding which reserve
  // date is still free, or it would always look like the first one's
  // already taken.
  const activeBody = body.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const nextDate = reserveDates.find(d => !activeBody.includes(`"${d}"`));
  const valueLiteral = nextDate ? `"${nextDate}"` : 'null';

  const lineRe = new RegExp(`\\n(?!\\s*//)\\s*${roundNum}\\s*:\\s*(?:"[^"]*"|null)\\s*,?`);
  const newLine = `\n  ${roundNum}: ${valueLiteral},`;
  body = lineRe.test(body) ? body.replace(lineRe, newLine) : body + newLine;

  return content.slice(0, bodyStart) + body + content.slice(endIdx);
}

// ---------- Anthropic vision read of the score sheet photo ----------
async function readScoreSheet(base64Data, mediaType, isFinals) {
  const finalsNote = isFinals
    ? ' This is a finals sheet -- also read the explicit Winner box (whichever side, A or B, is marked/circled as the winner).'
    : '';
  const prompt = `You are reading a photo of a paper score sheet for a club tennis competition. Only read the "Total" row for each side (Team A and Team B) -- ignore player names, the individual pairing rows, bonus points, and the sheet's own Points column.
Sets are out of 6 total and can include .5 (a 4-4 game score in one set counts as a half-set draw). Games are the total games summed across all 6 sets (always sums to 48 between both sides).${finalsNote}
Respond with ONLY a single JSON object, no other text, no markdown code fences, in exactly this shape: {"setsA": number, "setsB": number, "gamesA": number, "gamesB": number${isFinals ? ', "winner": "A" or "B"' : ''}}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  // Don't assume content[0] is the text block -- the model can emit a
  // `thinking` block first, pushing the actual answer to a later index.
  const textBlock = data.content.find(block => block.type === 'text');
  if (!textBlock) throw new Error(`No text block in Anthropic response: ${JSON.stringify(data.content)}`);
  const text = textBlock.text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(text);
}

module.exports = {
  sheetsStore, isAuthed, json,
  getDataJs, putDataJs, upsertEntry, upsertWetRound,
  readScoreSheet,
};
