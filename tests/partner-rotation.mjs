// Unit test for partner-repeat avoidance. No browser or dependencies needed.
// Pulls the pairing code straight out of index.html so it can't drift from the app.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('let PCC=null;');
const end = html.indexOf('function takeNext');
assert.ok(start > 0 && end > start, 'pairing code not found in index.html');

const api = new Function(
  'S0',
  'let S=S0;const lvl=n=>S.lv[n.toLowerCase()]||0;' +
    html.slice(start, end) +
    ';return {get S(){return S},set S(v){S=v},pc,oc,split4,refine4,rep4,co4}'
);

function fresh(n, md = 'soc') {
  return { log: [], queue: Array.from({ length: n }, (_, i) => 'P' + i), lv: {}, md, sd: 0 };
}
const A = api(fresh(8));

// 1. Counts are case-insensitive and cached results refresh when the log changes.
A.S = fresh(8);
assert.equal(A.pc('P0', 'P1'), 0);
A.S.log.push({ p: ['P0', 'P1', 'P2', 'P3'], w: 0, s: [11, 5] });
assert.equal(A.pc('p0', 'P1'), 1, 'partner count should ignore case');
assert.equal(A.pc('P0', 'P2'), 0, 'opponents are not partners');
assert.equal(A.oc('P0', 'p3'), 1, 'opponent count should ignore case');
A.S.log.pop();
assert.equal(A.pc('P0', 'P1'), 0, 'undo must clear the cached count');

// 2. Full rotation: with enough players, nobody repeats a partner while avoidable.
for (const [n, games] of [[8, 4], [9, 6], [10, 7]]) {
  A.S = fresh(n);
  let repeats = 0;
  for (let g = 0; g < games; g++) {
    const ix = A.S.queue.length > 4 ? A.refine4(A.S.queue.map((_, i) => i)) : [0, 1, 2, 3];
    assert.equal(new Set(ix).size, 4, 'four distinct players');
    assert.ok(ix.includes(0) && ix.includes(1), 'first two in line keep their spot');
    const t = A.split4(ix.map(i => A.S.queue[i]));
    if (A.pc(t[0], t[1]) || A.pc(t[2], t[3])) repeats++;
    A.S.log.push({ p: t, w: 0, s: [11, 5] });
    for (let k = ix.length - 1; k >= 0; k--) A.S.queue.splice(ix[k], 1);
    A.S.queue.push(...t);
    A.S.sd++;
  }
  assert.equal(repeats, 0, `${n} players, ${games} games: partners repeated`);
}

// 3. Regression: the old one-slot look-ahead repeated P2 + P3 even though
// changing both back positions to P4 + P7 made a fresh pairing possible.
A.S = fresh(8, 'soc');
const earlierTeams = [
  ['P0', 'P1', 'P2', 'P3'],
  ['P4', 'P5', 'P6', 'P7'],
  ['P0', 'P3', 'P1', 'P2'],
  ['P4', 'P6', 'P5', 'P7'],
  ['P0', 'P2', 'P3', 'P1'],
  ['P4', 'P7', 'P6', 'P5'],
];
A.S.log = earlierTeams.map(p => ({ p, w: 0, s: [11, 5] }));
A.S.sd = earlierTeams.length;
A.S.queue = ['P0', 'P2', 'P3', 'P1', 'P4', 'P7', 'P6', 'P5'];
const repairedIx = A.refine4(A.S.queue.map((_, i) => i));
assert.ok(repairedIx.includes(0) && repairedIx.includes(1), 'the first two players keep their spots');
const repairedPlayers = repairedIx.map(i => A.S.queue[i]);
assert.equal(A.rep4(repairedPlayers), 0, 'two-slot look-ahead must find a quartet with no repeated teammates');
const repairedTeams = A.split4(repairedPlayers);
assert.equal(A.pc(repairedTeams[0], repairedTeams[1]), 0, 'Team 1 must avoid a prior partnership');
assert.equal(A.pc(repairedTeams[2], repairedTeams[3]), 0, 'Team 2 must avoid a prior partnership');


// 4. Large rosters: search the entire eligible stack and never choose a worse
// partnership score than another pair available behind the same first two players.
function simulateLargeRoster(n,games,mode,winnerMode) {
  A.S = fresh(n,mode);
  A.S.lv = Object.fromEntries(Array.from({length:n},(_,i)=>['p'+i,(i%5)+1]));
  let repeats=0,unavoidableRounds=0,zeroRepeatRounds=0;
  for(let g=0;g<games;g++) {
    const eligible=A.S.queue.map((_,i)=>i);
    const pool=eligible.slice(2);
    const ix=A.refine4(eligible);
    assert.equal(new Set(ix).size,4, `${n} players: four distinct players`);
    assert.ok(ix.includes(eligible[0])&&ix.includes(eligible[1]), `${n} players: first two eligible players keep their positions`);
    const chosen=ix.map(i=>A.S.queue[i]);
    const chosenScore=A.rep4(chosen);
    let minScore=Infinity,minCo=Infinity,minDistance=Infinity;
    for(let i=0;i<pool.length;i++) for(let j=i+1;j<pool.length;j++) {
      const candidate=[A.S.queue[eligible[0]],A.S.queue[eligible[1]],A.S.queue[pool[i]],A.S.queue[pool[j]]];
      const score=A.rep4(candidate),co=A.co4(candidate);
      const distance=(i+j)*(pool.length+1)+j;
      if(score<minScore||(score===minScore&&(co<minCo||(co===minCo&&distance<minDistance)))) {
        minScore=score;minCo=co;minDistance=distance;
      }
    }
    assert.equal(chosenScore,minScore,`${n} players, game ${g+1}: picker must find the fewest possible teammate repeats across the full queue`);
    const rankA=eligible.indexOf(ix[2])-2,rankB=eligible.indexOf(ix[3])-2;
    assert.equal(A.co4(chosen),minCo,`${n} players, game ${g+1}: among equal-partner groups, pick the one who have played together (as partners or opponents) the least`);
    assert.equal((rankA+rankB)*(pool.length+1)+rankB,minDistance,`${n} players, game ${g+1}: after that, tie-break must preserve the closest queue positions`);
    const teams=A.split4(chosen);
    const partnerCounts=[A.pc(teams[0],teams[1]),A.pc(teams[2],teams[3])];
    const repeated=partnerCounts.filter(count=>count>0).length;
    if(repeated) {
      assert.ok(minScore>0,`${n} players, game ${g+1}: a repeat is allowed only when no repeat-free pairing exists`);
      repeats+=repeated;unavoidableRounds++;
    } else zeroRepeatRounds++;
    const winner=winnerMode==='team1'?0:winnerMode==='team2'?1:g%2;
    A.S.log.push({p:teams.slice(),w:winner,s:[11,7]});
    for(let k=ix.length-1;k>=0;k--) A.S.queue.splice(ix[k],1);
    A.S.queue.push(...(winner===0?teams:[...teams.slice(2),...teams.slice(0,2)]));
    A.S.sd++;
  }
  return {n,mode,winnerMode,repeats,unavoidableRounds,zeroRepeatRounds};
}
const largeRosterRuns=[];
for(const n of [20,24,30,40]) {
  for(const mode of ['soc','bal']) {
    for(const winnerMode of ['team1','alternate']) {
      const result=simulateLargeRoster(n,100,mode,winnerMode);
      largeRosterRuns.push(result);
      if(n>=24) assert.equal(result.repeats,0,`${n} players, ${mode}, ${winnerMode}: 100 games should avoid repeat partners`);
      if(n===20) assert.ok(result.unavoidableRounds>0,`20 players, ${mode}, ${winnerMode}: test must cover the no-fresh-pair fallback`);
    }
  }
}

// 5. A repeat that is truly unavoidable (exactly 4 players) must not crash.
A.S = fresh(4);
A.S.log.push({ p: ['P0', 'P1', 'P2', 'P3'], w: 0, s: [11, 5] });
const t = A.split4(A.S.queue);
assert.equal(t.length, 4);

// 6. With four players, the next round selects a different teammate pairing.
A.S = fresh(4, 'soc');
A.S.log.push({ p: ['P0', 'P1', 'P2', 'P3'], w: 0, s: [11, 5] });
const nextRound = A.split4(A.S.queue);
assert.equal(A.pc(nextRound[0], nextRound[1]), 0, 'Team 1 must rotate away from its previous partner');
assert.equal(A.pc(nextRound[2], nextRound[3]), 0, 'Team 2 must rotate away from its previous partner');

// 7. Social Mix is the default, and legacy saved sessions/backups migrate once and disable Winners Stay.
assert.match(html, /md:'soc',rotationModeVersion:1/, 'new sessions default to the Shuffle (Social Mix) pairing');
assert.ok(html.includes("if(S.rotationModeVersion!==1){S.md='soc';S.ws=false;S.rotationModeVersion=1}"), 'legacy saved sessions must migrate to Social Mix once');
assert.ok(html.includes("R.md='soc';R.rotationModeVersion=1"), 'restored backups always use the single Shuffle mode');
assert.ok(html.includes("R.ws=false;"), 'restored backups always turn Winners Stay off');
assert.ok(html.includes("R.eq=true;"), 'restored backups always use equal sit-outs');
assert.ok(html.includes("S.md='soc';S.ws=false;S.eq=true;"), 'saved sessions are normalised to the single Shuffle mode on load');
assert.ok(html.includes("function smd(m){S.md=m==='soc'?'soc':'bal';S.rotationModeVersion=1;"), 'manual mode changes must be preserved after migration');

console.log(JSON.stringify({pass:true,largeRosterRuns},null,2));
