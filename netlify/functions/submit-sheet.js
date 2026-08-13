// Public endpoint (no auth) -- a club member submits a score sheet photo.
// Reads the totals off it with Claude vision and stages it for Ash to
// review; nothing here touches data.js directly.
const { randomUUID } = require('crypto');
const { slotForCourt, ALL_ROUNDS, teamLabel, computeFinalsState, matchPoints } = require('../../data.js');
const { sheetsStore, json, readScoreSheet, checkRateLimit, resolveDate, dateSlug, FINALS_SLOTS, FINALS_STAGES } = require('./lib/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const store = sheetsStore();
  if (!(await checkRateLimit(store, event))) {
    return json(429, { error: 'Too many submissions from this connection today -- try again tomorrow, or contact Ash.' });
  }

  const { mode, mediaType, photoBase64 } = payload;

  // A wet report has no photo to read -- just flags a round/finals stage as
  // postponed for Ash to approve, which then auto-assigns the replay date.
  if (mode === 'weekly' && payload.wet === true) {
    const roundNum = Number(payload.roundNum);
    if (!Number.isInteger(roundNum) || roundNum < 1 || roundNum > 14) {
      return json(400, { error: 'Invalid round number' });
    }
    const id = randomUUID();
    await store.setJSON(`pending/${id}.json`, {
      id, mode: 'weekly', wet: true, roundNum,
      createdAt: new Date().toISOString(),
    });
    return json(200, { ok: true, id, wet: true, roundNum });
  }
  if (mode === 'finals' && payload.wet === true) {
    const finalsStage = payload.finalsStage;
    if (!FINALS_STAGES.includes(finalsStage)) return json(400, { error: 'Invalid finals stage' });
    const id = randomUUID();
    await store.setJSON(`pending/${id}.json`, {
      id, mode: 'finals', wet: true, finalsStage,
      createdAt: new Date().toISOString(),
    });
    return json(200, { ok: true, id, wet: true, finalsStage });
  }

  if (!photoBase64 || !mediaType) return json(400, { error: 'Missing photo' });

  let blockConst, keyLiteral, key, roundNum = null, courtNum = null, finalsSlot = null, weeklySlot = null;

  if (mode === 'weekly') {
    roundNum = Number(payload.roundNum);
    courtNum = Number(payload.courtNum);
    if (!Number.isInteger(roundNum) || roundNum < 1 || roundNum > 14) {
      return json(400, { error: 'Invalid round number' });
    }
    if (!Number.isInteger(courtNum) || courtNum < 1 || courtNum > 4) {
      return json(400, { error: 'Invalid court number' });
    }
    weeklySlot = slotForCourt(roundNum, courtNum);
    key = `${roundNum}-${weeklySlot}`;
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

  // Resolve which real team is "A" and which is "B" per the app's own fixture
  // (weekly) or bracket state (finals), so the vision read can be told which
  // two teams to expect and match the sheet's own handwritten "TEAM ___ V
  // TEAM ___" boxes against them -- rather than assuming whichever side is
  // physically written first/left on the sheet is always "A". Finals slots
  // can be unresolved this early (e.g. semis before elimination's played),
  // in which case there's nothing to match against and the read falls back
  // to whatever order the sheet itself is in.
  let teamA = null, teamB = null;
  if (mode === 'weekly') {
    [teamA, teamB] = ALL_ROUNDS[roundNum - 1][weeklySlot];
  } else {
    const slotInfo = computeFinalsState()[finalsSlot];
    if (slotInfo) ({ teamA, teamB } = slotInfo);
  }
  const teamLabels = teamA != null && teamB != null
    ? { teamALabel: teamLabel(teamA), teamBLabel: teamLabel(teamB) }
    : null;

  // Needed before the read itself now, not just for filing afterward -- the
  // sheet's own "COURT"/"DATE" boxes get cross-checked against these.
  const dateStr = resolveDate({ mode, roundNum, finalsSlot });
  const expectedContext = { expectedDate: dateStr, expectedCourt: mode === 'weekly' ? courtNum : null };

  // A "submit anyway" resubmission (see the mismatch check below) carries
  // the numbers the uploader already saw and confirmed, rather than reading
  // the photo again -- reuses the already-paid-for vision read instead of
  // re-running (and re-billing) it on the same image.
  let extracted;
  if (payload.confirmedExtracted) {
    extracted = payload.confirmedExtracted;
  } else {
    try {
      extracted = await readScoreSheet(photoBase64, mediaType, mode === 'finals', teamLabels, expectedContext);
    } catch (err) {
      return json(502, { error: `Could not read the photo: ${err.message}` });
    }
  }

  // The model doesn't always return the exact shape asked for on an
  // ambiguous/hard-to-read photo -- catch that here with a clear message,
  // rather than silently staging a pending record with undefined numbers
  // that could corrupt data.js if approved without the blank fields
  // being noticed.
  const requiredFields = ['setsA', 'setsB', 'gamesA', 'gamesB'];
  const hasAllNumbers = requiredFields.every(f => typeof extracted[f] === 'number' && Number.isFinite(extracted[f]));
  const winnerOk = mode !== 'finals' || extracted.winner === 'A' || extracted.winner === 'B';
  if (!hasAllNumbers || !winnerOk) {
    return json(502, { error: `Could not read this photo clearly (got: ${JSON.stringify(extracted)}) -- try again with a clearer, well-lit photo of the Total row.` });
  }

  // Weekly plays exactly 6 sets of 8 games each; finals plays 8 (the
  // sudden-death tiebreaker, if needed, only decides the Winner box -- it
  // has no row of its own in the sheet's SCORE table, so it isn't part of
  // the recorded Total). Either way, both the sets count and the games
  // count are hard invariants, not heuristics: every set is won 1-0 or
  // drawn 0.5-0.5, so setsA+setsB always equals the number of sets played;
  // games always sums to 8 per set. This caught a real misread: Round
  // 2/Court 2 had Team 7's games read as 24 instead of 18.
  const expectedSets = mode === 'weekly' ? 6 : 8;
  const expectedGames = mode === 'weekly' ? 48 : 64;
  const actualSets = extracted.setsA + extracted.setsB;
  const actualGames = extracted.gamesA + extracted.gamesB;
  const sheetMismatch = actualSets !== expectedSets || actualGames !== expectedGames;

  // Catches a different mistake to a misread: the *right* photo read
  // correctly but filed under the *wrong* court/round -- e.g. picking Court
  // 3 in the dropdown while actually holding Court 2's sheet. Only flagged
  // on a clear read-back: courtOnSheet/dateMatches come back null whenever
  // the model isn't confident, and null never counts as a mismatch here --
  // an unreadable Court/Date box shouldn't nag someone who filled in
  // everything else correctly.
  const courtMismatch = mode === 'weekly'
    && extracted.courtOnSheet != null && extracted.courtOnSheet !== courtNum;
  const dateMismatch = extracted.dateMatches === false;

  // Finals-only: the Winner box only exists to record a sudden-death
  // tiebreaker outcome, needed when the two sides are dead level on points
  // after bonus. Whenever they're NOT level, whoever has more points simply
  // wins -- no tiebreaker involved -- so the Winner box should always agree
  // with that. If it names the side with fewer points, either the Winner
  // box or the Games/Sets Total was misread; a genuine tie is the only case
  // where the Winner box is the sole source of truth and can't be checked.
  const bp = mode === 'finals' ? matchPoints(extracted) : null;
  const expectedWinner = bp && bp.totalA !== bp.totalB ? (bp.totalA > bp.totalB ? 'A' : 'B') : null;
  const winnerMismatch = expectedWinner != null && extracted.winner !== expectedWinner;

  const hasIssue = sheetMismatch || courtMismatch || dateMismatch || winnerMismatch;

  if (hasIssue && !payload.confirmedExtracted) {
    return json(200, {
      ok: true, mismatch: true, extracted,
      expectedSets, actualSets, expectedGames, actualGames,
      courtMismatch, courtOnSheet: extracted.courtOnSheet ?? null, expectedCourt: courtNum,
      dateMismatch, expectedDate: dateStr,
      winnerMismatch, winnerOnSheet: extracted.winner ?? null, expectedWinner,
    });
  }

  const slug = dateSlug(dateStr);

  // Prefix the blob key itself with the human-readable round/court/date so
  // it's identifiable at a glance in the Blobs dashboard, not just in the
  // metadata you have to click into -- the trailing UUID keeps it unique.
  const id = mode === 'weekly'
    ? `r${roundNum}-c${courtNum}-${slug}-${randomUUID()}`
    : `finals-${finalsSlot}-${slug}-${randomUUID()}`;
  await store.set(`pending/${id}.jpg`, Buffer.from(photoBase64, 'base64'), {
    metadata: { mode, roundNum, courtNum, finalsSlot, date: dateStr },
  });
  await store.setJSON(`pending/${id}.json`, {
    id, mode, blockConst, keyLiteral, key,
    roundNum, courtNum, finalsSlot,
    extracted,
    // Only ever set here -- this point is only reached on a mismatch when
    // the uploader has already been warned and chose to submit anyway, so
    // review.html can flag it (and say *why*) rather than have it look like
    // a clean read.
    ...(hasIssue ? {
      mismatchAcknowledged: true,
      mismatchDetail: {
        expectedSets, actualSets, expectedGames, actualGames,
        courtMismatch, courtOnSheet: extracted.courtOnSheet ?? null, expectedCourt: courtNum,
        dateMismatch, expectedDate: dateStr,
        winnerMismatch, winnerOnSheet: extracted.winner ?? null, expectedWinner,
      },
    } : {}),
    createdAt: new Date().toISOString(),
  });

  return json(200, { ok: true, id, key, extracted });
};
