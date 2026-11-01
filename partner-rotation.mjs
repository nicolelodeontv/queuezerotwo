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

function fresh(n, md = 'bal') {
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

// 3. A repeat that is truly unavoidable (exactly 4 players) must not crash.
A.S = fresh(4);
A.S.log.push({ p: ['P0', 'P1', 'P2', 'P3'], w: 0, s: [11, 5] });
const t = A.split4(A.S.queue);
assert.equal(t.length, 4);
console.log('partner-rotation: all checks passed');
