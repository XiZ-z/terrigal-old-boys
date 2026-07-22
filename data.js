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

const FINALS_DATES = {
  elimination: "25 Nov 2026",
  semis: "2 Dec 2026",
  grandFinal: "9 Dec 2026",
};

// ---------- Weekly results ----------
// Add one line here per court per week, once that court's paper score sheet
// has been scanned in and read back. Key is "roundNumber-courtIndex" (court 0-3).
// setsA/setsB: out of 6 total sets, can include .5 (a 4-4 set is a draw).
// gamesA/gamesB: total games across all 6 sets, always sums to 48.
const RESULTS = {
  // Round 1 — Team 1 v Team 8, Team 2 v Team 7, Team 3 v Team 6, Team 4 v Team 5
  "1-0": { setsA: 4.5, setsB: 1.5, gamesA: 29, gamesB: 19 },
  "1-1": { setsA: 3,   setsB: 3,   gamesA: 24, gamesB: 24 },
  "1-2": { setsA: 6,   setsB: 0,   gamesA: 36, gamesB: 12 },
  "1-3": { setsA: 2,   setsB: 4,   gamesA: 22, gamesB: 26 },
  // Round 2 — Team 1 v Team 7, Team 8 v Team 6, Team 2 v Team 5, Team 3 v Team 4
  "2-0": { setsA: 4,   setsB: 2,   gamesA: 27, gamesB: 21 },
  "2-1": { setsA: 1,   setsB: 5,   gamesA: 17, gamesB: 31 },
  "2-2": { setsA: 3.5, setsB: 2.5, gamesA: 25, gamesB: 23 },
  "2-3": { setsA: 2.5, setsB: 3.5, gamesA: 23, gamesB: 25 },
};

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

// ---------- Head-to-head ----------
// Total ladder points each team earned in the (up to two) matches played
// directly against each other. Used to break ties on the ladder.
function headToHeadPoints(teamA, teamB){
  teamA = Number(teamA); teamB = Number(teamB);
  let ptsA = 0, ptsB = 0;
  ALL_ROUNDS.forEach((pairs, idx) => {
    const roundNum = idx+1;
    pairs.forEach((m, courtIdx) => {
      const [x, y] = m;
      const isMatch = (x===teamA && y===teamB) || (x===teamB && y===teamA);
      if(!isMatch) return;
      const r = RESULTS[`${roundNum}-${courtIdx}`];
      if(!r) return;
      const bp = matchPoints(r);
      if(x===teamA){ ptsA += bp.totalA; ptsB += bp.totalB; }
      else { ptsA += bp.totalB; ptsB += bp.totalA; }
    });
  });
  return { ptsA, ptsB };
}

// ---------- Ladder ----------
// Ranking: total points descending, then head-to-head points between the
// tied teams (per the club's convention — easy to spot-check against the
// 1-2 relevant paper sheets), then overall set/game differential as a
// fallback for anything head-to-head can't resolve (e.g. a 3+-way tie).
function computeLadder(){
  const teams = {};
  for(let t=1;t<=8;t++){ teams[t] = { played:0, setsFor:0, setsAgainst:0, gamesFor:0, gamesAgainst:0, points:0 }; }

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
    });
  });

  return Object.entries(teams)
    .map(([t,v]) => ({ team:t, ...v }))
    .sort((x,y) => {
      if(y.points !== x.points) return y.points - x.points;
      const h2h = headToHeadPoints(x.team, y.team);
      if(h2h.ptsA !== h2h.ptsB) return h2h.ptsB - h2h.ptsA;
      return (y.setsFor-y.setsAgainst)-(x.setsFor-x.setsAgainst)
        || (y.gamesFor-y.gamesAgainst)-(x.gamesFor-x.gamesAgainst);
    });
}

// ---------- Next match night (first round with no results entered yet) ----------
function getNextRound(){
  for(let idx=0; idx<ALL_ROUNDS.length; idx++){
    const roundNum = idx+1;
    const allPlayed = ALL_ROUNDS[idx].every((m, courtIdx) => RESULTS[`${roundNum}-${courtIdx}`]);
    if(!allPlayed){
      return { roundNum, pairs: ALL_ROUNDS[idx], date: DATES[idx] };
    }
  }
  return null; // round robin complete
}
