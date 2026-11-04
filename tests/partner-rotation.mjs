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
    ';return {get S(){return S},set S(v){S=v},pc,oc,split4,refine4,rep4}'
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

// 3. A repeat that is truly unavoidable (exactly 4 players) must not crash.
A.S = fresh(4);
A.S.log.push({ p: ['P0', 'P1', 'P2', 'P3'], w: 0, s: [11, 5] });
const t = A.split4(A.S.queue);
assert.equal(t.length, 4);

// 4. With four players, the next round selects a different teammate pairing.
A.S = fresh(4, 'soc');
A.S.log.push({ p: ['P0', 'P1', 'P2', 'P3'], w: 0, s: [11, 5] });
const nextRound = A.split4(A.S.queue);
assert.equal(A.pc(nextRound[0], nextRound[1]), 0, 'Team 1 must rotate away from its previous partner');
assert.equal(A.pc(nextRound[2], nextRound[3]), 0, 'Team 2 must rotate away from its previous partner');

// 5. Social Mix is the default, and legacy saved sessions/backups migrate once and disable Winners Stay.
assert.match(html, /md:'soc',rotationModeVersion:1/, 'new sessions must default to Social Mix');
assert.ok(html.includes("if(S.rotationModeVersion!==1){S.md='soc';S.ws=false;S.rotationModeVersion=1}"), 'legacy saved sessions must migrate to Social Mix once');
assert.ok(html.includes("R.md=s.rotationModeVersion===1&&s.md==='bal'?'bal':'soc';R.rotationModeVersion=1"), 'legacy backups must migrate while preserving a newer explicit Balanced choice');
assert.ok(html.includes("R.ws=s.rotationModeVersion===1&&!!s.ws;"), 'legacy backups must disable Winners Stay during the one-time migration');
assert.ok(html.includes("function smd(m){S.md=m==='soc'?'soc':'bal';S.rotationModeVersion=1;"), 'manual mode changes must be preserved after migration');

console.log('partner-rotation: all checks passed');
