// ---------- Season structure ----------
// Round-robin pairings by team number, 7 unique rounds repeated twice for 14 rounds
const BASE_ROUNDS = [
  [[1,8],[2,7],[3,6],[4,5]],
  [[1,7],[8,6],[2,5],[3,4]],
  [[1,6],[7,5],[8,4],[2,3]],
  [[1,5],[6,4],[7,3],[8,2]],
  [[1,4],[5,3],[6,2],[7,8]],
  [[1,3],[4,2],[5,8],[6,7]],
  [[1,2],[3,8],[4,7],[5,6]],
];
const ALL_ROUNDS = BASE_ROUNDS.concat(BASE_ROUNDS); // rounds 1-14

const DATES = [
  "5 Aug 2026","12 Aug 2026","19 Aug 2026","26 Aug 2026",
  "2 Sep 2026","9 Sep 2026","16 Sep 2026","23 Sep 2026",
  "30 Sep 2026","7 Oct 2026","14 Oct 2026","21 Oct 2026",
  "28 Oct 2026","4 Nov 2026"
];

const RESERVE_DATES = ["11 Nov 2026", "18 Nov 2026"];

// Rounds postponed due to wet weather. Value is the reserve date it's
// been rescheduled to, or null while that's still TBC. Remove the round's
// entry entirely once it's actually been replayed and its results are
// entered -- from that point it behaves like any other completed round.
const WET_ROUNDS = {
  // 5: "11 Nov 2026",
};

const FINALS_DATES = {
  elimination: "25 Nov 2026",
  semis: "2 Dec 2026",
  grandFinal: "9 Dec 2026",
};

// ---------- Weekly results ----------
// Add one line here per court per week, once that court's paper score sheet
// has been scanned in and read back. Key is "roundNumber-pairingSlot" (0-3)
// -- see displayCourt() below for why this isn't simply "court number".
// setsA/setsB: out of 6 total sets, can include .5 (a 4-4 set is a draw).
// gamesA/gamesB: total games across all 6 sets, always sums to 48.
const RESULTS = {
  // Sample data for dev preview only -- rounds 1-3. Cleared before the real season.
  // Round 1 — Team 1 v Team 8, Team 2 v Team 7, Team 3 v Team 6, Team 4 v Team 5
  "1-0": { setsA: 4,   setsB: 2,   gamesA: 27, gamesB: 21 },
  "1-1": { setsA: 3.5, setsB: 2.5, gamesA: 25, gamesB: 23 },
  "1-2": { setsA: 6,   setsB: 0,   gamesA: 30, gamesB: 18 },
  "1-3": { setsA: 2,   setsB: 4,   gamesA: 20, gamesB: 28 },
  // Round 2 — Team 1 v Team 7, Team 8 v Team 6, Team 2 v Team 5, Team 3 v Team 4
  "2-0": { setsA: 4.5, setsB: 1.5, gamesA: 28, gamesB: 20 },
  "2-1": { setsA: 2.5, setsB: 3.5, gamesA: 23, gamesB: 25 },
  "2-2": { setsA: 3,   setsB: 3,   gamesA: 22, gamesB: 26 },
  "2-3": { setsA: 4,   setsB: 2,   gamesA: 26, gamesB: 22 },
  // Round 3 — Team 1 v Team 6, Team 7 v Team 5, Team 8 v Team 4, Team 2 v Team 3
  "3-0": { setsA: 5,   setsB: 1,   gamesA: 31, gamesB: 17 },
  "3-1": { setsA: 2,   setsB: 4,   gamesA: 19, gamesB: 29 },
  "3-2": { setsA: 3.5, setsB: 2.5, gamesA: 21, gamesB: 27 },
  "3-3": { setsA: 1.5, setsB: 4.5, gamesA: 18, gamesB: 30 },
};

// ---------- Court display ----------
// ALL_ROUNDS pairs are indexed by "pairing slot" (0-3), a byproduct of the
// round-robin generation algorithm -- NOT the physical court number. Left
// as-is, slot 0 always holds Team 1, so Team 1 would always show as
// "Court 1" every single week. displayCourt() rotates the *label* shown to
// people by a per-round offset so which physical court a team is shown on
// varies across the season, without changing who plays whom or touching
// RESULTS at all (still keyed by the stable, unrotated pairing slot).
function displayCourt(roundNum, slotIdx){
  const offset = (roundNum - 1) % 4;
  return ((slotIdx + offset) % 4) + 1;
}
// Inverse of displayCourt(): given a round and the physical court number
// someone picked (1-4), returns which pairing slot that corresponds to.
function slotForCourt(roundNum, courtNum){
  const offset = (roundNum - 1) % 4;
  return ((courtNum - 1 - offset) % 4 + 4) % 4;
}

// ---------- Points calculation per match ----------
function matchPoints(r){
  let setsBonusA=0, setsBonusB=0;
  if(r.setsA > r.setsB){ setsBonusA = 2; }
  else if(r.setsB > r.setsA){ setsBonusB = 2; }
  else { setsBonusA = 1; setsBonusB = 1; }

  let gamesBonusA=0, gamesBonusB=0;
  if(r.gamesA > r.gamesB){ gamesBonusA = 2; }
  else if(r.gamesB > r.gamesA){ gamesBonusB = 2; }
  else { gamesBonusA = 1; gamesBonusB = 1; }

  return {
    setsBonusA, setsBonusB, gamesBonusA, gamesBonusB,
    totalA: r.setsA + setsBonusA + gamesBonusA,
    totalB: r.setsB + setsBonusB + gamesBonusB,
  };
}

// ---------- Ladder ----------
// Stats from just the matches between teamNum and opponentNum this season
// (up to two meetings). Used only as a last-resort tiebreak, when two teams
// are level on overall points, set diff, AND game diff -- follows the same
// points -> set diff -> game diff cascade as the main ladder, just scoped
// to their head-to-head matches only.
function headToHeadStats(teamNum, opponentNum){
  let points = 0, setsFor = 0, setsAgainst = 0, gamesFor = 0, gamesAgainst = 0;
  ALL_ROUNDS.forEach((pairs, idx) => {
    const roundNum = idx+1;
    pairs.forEach((m, courtIdx) => {
      const [a,b] = m;
      const r = RESULTS[`${roundNum}-${courtIdx}`];
      if(!r) return;
      const bp = matchPoints(r);
      if(a === teamNum && b === opponentNum){
        points += bp.totalA; setsFor += r.setsA; setsAgainst += r.setsB;
        gamesFor += r.gamesA; gamesAgainst += r.gamesB;
      } else if(a === opponentNum && b === teamNum){
        points += bp.totalB; setsFor += r.setsB; setsAgainst += r.setsA;
        gamesFor += r.gamesB; gamesAgainst += r.gamesA;
      }
    });
  });
  return { points, setDiff: setsFor - setsAgainst, gameDiff: gamesFor - gamesAgainst };
}
function headToHeadCompare(teamNum, opponentNum){
  const mine = headToHeadStats(teamNum, opponentNum);
  const theirs = headToHeadStats(opponentNum, teamNum);
  return (mine.points - theirs.points) || (mine.setDiff - theirs.setDiff) || (mine.gameDiff - theirs.gameDiff);
}

// Ranking: total points descending, then overall set differential
// (across the whole competition), then overall game differential,
// then head-to-head points -> sets -> games (only relevant once a pair is
// level on all three overall stats).
function computeLadder(){
  const teams = {};
  for(let t=1;t<=8;t++){ teams[t] = { played:0, setsFor:0, setsAgainst:0, gamesFor:0, gamesAgainst:0, points:0, form:[] }; }

  ALL_ROUNDS.forEach((pairs, idx) => {
    const roundNum = idx+1;
    pairs.forEach((m, courtIdx) => {
      const key = `${roundNum}-${courtIdx}`;
      const r = RESULTS[key];
      if(!r) return;
      const [a,b] = m;
      const bp = matchPoints(r);
      teams[a].played++; teams[b].played++;
      teams[a].setsFor += r.setsA; teams[a].setsAgainst += r.setsB;
      teams[b].setsFor += r.setsB; teams[b].setsAgainst += r.setsA;
      teams[a].gamesFor += r.gamesA; teams[a].gamesAgainst += r.gamesB;
      teams[b].gamesFor += r.gamesB; teams[b].gamesAgainst += r.gamesA;
      teams[a].points += bp.totalA;
      teams[b].points += bp.totalB;
      const outcome = bp.totalA === bp.totalB ? 'D' : (bp.totalA > bp.totalB ? 'W' : 'L');
      teams[a].form.push(outcome);
      teams[b].form.push(outcome === 'D' ? 'D' : (outcome === 'W' ? 'L' : 'W'));
    });
  });

  return Object.entries(teams)
    .map(([t,v]) => ({ team:t, ...v }))
    .sort((x,y) => y.points - x.points
      || (y.setsFor-y.setsAgainst)-(x.setsFor-x.setsAgainst)
      || (y.gamesFor-y.gamesAgainst)-(x.gamesFor-x.gamesAgainst)
      || headToHeadCompare(Number(y.team), Number(x.team)));
}

// ---------- Season records (biggest wins, closest match, longest streaks) ----------
function getAllPlayedMatches(){
  const matches = [];
  ALL_ROUNDS.forEach((pairs, idx) => {
    const roundNum = idx+1;
    pairs.forEach((m, courtIdx) => {
      const key = `${roundNum}-${courtIdx}`;
      const r = RESULTS[key];
      if(!r) return;
      matches.push({ roundNum, teamA: m[0], teamB: m[1], ...r });
    });
  });
  return matches;
}

function computeSeasonRecords(){
  const matches = getAllPlayedMatches();
  if(matches.length === 0) return null;

  let biggestWin = null, closest = null, mostLopsidedSets = null;
  matches.forEach(m => {
    const gameDiff = Math.abs(m.gamesA - m.gamesB);
    const setDiff = Math.abs(m.setsA - m.setsB);
    if(!biggestWin || gameDiff > biggestWin.gameDiff) biggestWin = { ...m, gameDiff };
    if(!closest || gameDiff < closest.gameDiff) closest = { ...m, gameDiff };
    if(!mostLopsidedSets || setDiff > mostLopsidedSets.setDiff) mostLopsidedSets = { ...m, setDiff };
  });

  const rows = computeLadder();
  let bestWinStreak = null, bestLossStreak = null;
  rows.forEach(r => {
    let curW=0, maxW=0, curL=0, maxL=0;
    r.form.forEach(o => {
      curW = o === 'W' ? curW+1 : 0;
      curL = o === 'L' ? curL+1 : 0;
      if(curW > maxW) maxW = curW;
      if(curL > maxL) maxL = curL;
    });
    if(maxW > 0 && (!bestWinStreak || maxW > bestWinStreak.streak)) bestWinStreak = { team: r.team, streak: maxW };
    if(maxL > 0 && (!bestLossStreak || maxL > bestLossStreak.streak)) bestLossStreak = { team: r.team, streak: maxL };
  });

  return { biggestWin, closest, mostLopsidedSets, bestWinStreak, bestLossStreak };
}

// ---------- Next match night (first round with no results entered yet) ----------
function roundIsPlayed(roundNum){
  return ALL_ROUNDS[roundNum - 1].every((m, courtIdx) => RESULTS[`${roundNum}-${courtIdx}`]);
}

// A wet round gets skipped -- the following week just plays the next
// round in the queue rather than waiting, so a wet round's index position
// no longer matches when it's actually played. Prefer whatever round is
// really next; only fall back to a still-pending wet round once nothing
// else is left, so the round robin doesn't get falsely reported complete
// while a wet round's replay is still outstanding.
function getNextRound(){
  let pendingWet = null;
  for(let idx=0; idx<ALL_ROUNDS.length; idx++){
    const roundNum = idx+1;
    if(roundIsPlayed(roundNum)) continue;
    if(WET_ROUNDS.hasOwnProperty(roundNum)){
      pendingWet = pendingWet || { roundNum, pairs: ALL_ROUNDS[idx], date: DATES[idx] };
      continue;
    }
    return { roundNum, pairs: ALL_ROUNDS[idx], date: DATES[idx] };
  }
  return pendingWet; // null once every round, including any wet one, is played
}

// Count of rounds actually completed so far -- used instead of
// "next.roundNum - 1" wherever progress is displayed, since a wet round
// being skipped-and-replayed-later can leave a later round finished
// before an earlier (wet) one.
function getRoundsPlayed(){
  let count = 0;
  for(let roundNum = 1; roundNum <= ALL_ROUNDS.length; roundNum++){
    if(roundIsPlayed(roundNum)) count++;
  }
  return count;
}

// ---------- Finals ----------
// Keyed by bracket slot ("game1"/"game2"/"game3"/"semi1"/"semi2"/"final"),
// matching the ids used in finals.html. Same setsA/setsB/gamesA/gamesB
// shape as RESULTS, plus an explicit `winner` ("A" or "B") read straight
// off the sheet's Winner box -- needed because a match tied on both sets
// and games after bonus points is settled by a tiebreaker set that isn't
// otherwise captured in those four numbers (finals only).
const FINALS_RESULTS = {
  // Sample data for dev preview only -- pretends Games 1-3 and Semi 1 have
  // been played, with Semi 2 resolved (teams known) but not yet played,
  // and the Grand Final still awaiting Semi 2. Cleared before real finals.
  game1: { setsA: 4,   setsB: 2,   gamesA: 27, gamesB: 21, winner: 'A' },
  game2: { setsA: 2,   setsB: 4,   gamesA: 20, gamesB: 28, winner: 'B' },
  game3: { setsA: 3.5, setsB: 2.5, gamesA: 25, gamesB: 23, winner: 'A' },
  semi1: { setsA: 4.5, setsB: 1.5, gamesA: 28, gamesB: 20, winner: 'A' },
};

// Resolves each bracket slot's actual teams (from ladder seeding and prior
// results) and, where a result has been entered, the winner/loser and
// score. Returns null once a slot's feeders aren't decided yet -- e.g.
// Semi 2 needs all three Elimination results in (to know every loser's
// ladder rank for "best-placed loser"), and the Final needs both semis.
function computeFinalsState(){
  const rows = computeLadder();
  const seedTeam = rank => Number(rows[rank - 1].team);
  const rankOf = team => rows.findIndex(r => Number(r.team) === team) + 1;

  const state = {
    game1: { teamA: seedTeam(1), teamB: seedTeam(6) },
    game2: { teamA: seedTeam(2), teamB: seedTeam(5) },
    game3: { teamA: seedTeam(3), teamB: seedTeam(4) },
  };

  ['game1', 'game2', 'game3'].forEach(g => {
    const r = FINALS_RESULTS[g];
    if(!r) return;
    state[g].result = r;
    state[g].winner = r.winner === 'A' ? state[g].teamA : state[g].teamB;
    state[g].loser = r.winner === 'A' ? state[g].teamB : state[g].teamA;
  });

  if(state.game1.winner && state.game3.winner){
    state.semi1 = { teamA: state.game1.winner, teamB: state.game3.winner };
  }
  if(state.game1.winner && state.game2.winner && state.game3.winner){
    const losers = [state.game1.loser, state.game2.loser, state.game3.loser];
    const bestLoser = losers.reduce((best, t) => rankOf(t) < rankOf(best) ? t : best);
    state.semi2 = { teamA: state.game2.winner, teamB: bestLoser };
  }

  ['semi1', 'semi2'].forEach(s => {
    if(!state[s]) return;
    const r = FINALS_RESULTS[s];
    if(!r) return;
    state[s].result = r;
    state[s].winner = r.winner === 'A' ? state[s].teamA : state[s].teamB;
  });

  if(state.semi1 && state.semi1.winner && state.semi2 && state.semi2.winner){
    state.final = { teamA: state.semi1.winner, teamB: state.semi2.winner };
    const r = FINALS_RESULTS.final;
    if(r){
      state.final.result = r;
      state.final.winner = r.winner === 'A' ? state.final.teamA : state.final.teamB;
    }
  }

  return state;
}
