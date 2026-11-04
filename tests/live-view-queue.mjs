import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sourceBlock(startText, endText) {
  const start = html.indexOf(startText);
  const end = html.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `source block not found: ${startText}`);
  return html.slice(start, end).trim();
}

const projectionSource = sourceBlock('function liveQueueProjection(', '\nfunction buildUpNext');
const projection = new Function(`${projectionSource}; return liveQueueProjection;`)();

const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const normalizeSource = sourceBlock('function normalizeLiveSessionPayload(', '\nfunction applyLiveSessionData');
const normalize = new Function('num', 'TextEncoder', `${normalizeSource}; return normalizeLiveSessionPayload;`)(num, TextEncoder);

// Extract the exact eligible-index selector so the tests exercise the same
// queue ordering code used by both the host's Up Next picker and Live View.
const eligibleSource = sourceBlock('function eligibleQueueIndexes()', '\nfunction pickN(');
const pickerSource = sourceBlock('function pickN(', '\nconst pick4');
function makePicker(state) {
  return new Function('S0', `
    let S=S0;
    const isRest=p=>!!(S.rest&&S.rest[String(p).toLowerCase()]);
    const normalizeWaitTimes=(queue,wait)=>wait||{};
    const gk=p=>String(p).toLowerCase();
    const wk=p=>String(p).toLowerCase();
    const refine4=ix=>ix.slice(0,4);
    ${eligibleSource}
    ${pickerSource}
    return {eligibleQueueIndexes,pickN};
  `)(state);
}

// Resting players are omitted from eligibility without moving their stored
// queue positions. Physical positions remain separate from eligible positions.
{
  const queue = ['Ana','Ben','Cara','Dan','Eli','Resting','Fay','Gus','Hana','Ivan','Jack'];
  const eligible = [0,2,4,6,7,8,9,10];
  const now = 1_800_000_000_000;
  const avg = 30 * 60_000;
  const courts = [
    {n:'Court 1',a:true,t:now - 10 * 60_000}, // 20 minutes predicted remaining
    {n:'Court 2',a:true,t:now - 20 * 60_000}, // 10 minutes predicted remaining
    {n:'Court 3',a:false,t:0},                // free now
  ];
  const result = projection(queue,eligible,courts,avg,now);
  assert.deepEqual(result.map(x=>x.position),[1,2,3,4,5,6,7,8,9,10,11]);
  assert.equal(result[1].resting,true);
  assert.equal(result[3].resting,true);
  assert.equal(result[5].resting,true);
  assert.equal(result[0].eligiblePosition,1);
  assert.equal(result[2].eligiblePosition,2);
  assert.equal(result[10].eligiblePosition,8);
  assert.equal(result[0].etaMs,0);
  assert.equal(result[2].etaMs,0);
  assert.equal(result[4].etaMs,0);
  assert.equal(result[6].etaMs,0);
  assert.equal(result[7].etaMs,10 * 60_000);
  assert.equal(result[10].etaMs,10 * 60_000);

  // Removing the resting rows entirely produces the same ETA sequence:
  // resting players do not consume one of the four-player call groups.
  const compact = projection(
    ['Ana','Cara','Eli','Fay','Gus','Hana','Ivan','Jack'],
    [0,1,2,3,4,5,6,7],
    courts,
    avg,
    now
  );
  assert.deepEqual(
    compact.map(x=>x.etaMs),
    [0,0,0,0,10*60_000,10*60_000,10*60_000,10*60_000]
  );
}

// With every court busy, ETA follows the next predicted court completion,
// then assigns later groups to the next earliest court.
{
  const now = 1_800_000_000_000;
  const avg = 30 * 60_000;
  const queue = Array.from({length:8},(_,i)=>'P'+i);
  const result = projection(queue,queue.map((_,i)=>i),[
    {a:true,t:now - 20*60_000}, // 10m remaining
    {a:true,t:now - 10*60_000}, // 20m remaining
  ],avg,now);
  assert.ok(result.slice(0,4).every(x=>x.etaMs===10*60_000));
  assert.ok(result.slice(4,8).every(x=>x.etaMs===20*60_000));
}

// Two open courts can immediately take two four-player groups.
{
  const now = 1_800_000_000_000;
  const result = projection(
    Array.from({length:8},(_,i)=>'P'+i),
    [0,1,2,3,4,5,6,7],
    [{a:false,t:0},{a:false,t:0}],
    25*60_000,
    now
  );
  assert.ok(result.every(x=>x.etaMs===0));
}

// Partner look-ahead can select players deeper in the stack. Those exact
// Up Next players must share the first court's ETA instead of their raw rank.
{
  const now = 1_800_000_000_000;
  const queue = Array.from({length:8},(_,i)=>'P'+i);
  const result = projection(
    queue,
    queue.map((_,i)=>i),
    [{a:true,t:now-20*60_000}],
    30*60_000,
    now,
    [0,1,6,7]
  );
  assert.deepEqual(result.map(x=>x.etaMs),[
    10*60_000,10*60_000,40*60_000,40*60_000,
    40*60_000,40*60_000,10*60_000,10*60_000
  ]);
}

// No history means no invented minute estimate, but resting state still works.
{
  const result = projection(['A','B','C'],[0,2],[
    {a:true,t:1_800_000_000_000}
  ],0,1_800_000_000_000);
  assert.equal(result[0].etaMs,null);
  assert.equal(result[1].resting,true);
  assert.equal(result[2].eligiblePosition,2);
}

// An open court cannot start an incomplete group of fewer than four.
{
  const result = projection(['A','B','Resting'],[0,1],[
    {a:false,t:0}
  ],0,1_800_000_000_000);
  assert.deepEqual(result.map(x=>x.etaMs),[null,null,null]);
  assert.equal(result.filter(x=>!x.resting).length,2);
}

// All-resting queues have no eligible positions and must not get a fake ETA.
{
  const result = projection(['A','B'],[],[{a:false,t:0}],30*60_000,1_800_000_000_000);
  assert.ok(result.every(x=>x.resting&&x.eligiblePosition===null&&x.etaMs===null));
}

// Even before a duration baseline exists, an actually open court makes the
// next four eligible players ready now; later groups remain unestimated.
{
  const result = projection(
    ['A','B','C','D','E'],
    [0,1,2,3,4],
    [{a:true,t:1_800_000_000_000},{a:false,t:0}],
    0,
    1_800_000_000_000
  );
  assert.deepEqual(result.map(x=>x.etaMs),[0,0,0,0,null]);
}

// The existing Equal Sit-outs priority is the same order sent to Live View.
{
  const state = {
    queue:['Resting','Ana','Ben','Cara'],
    rest:{resting:true},
    eq:true,
    gp:{ana:4,ben:1,cara:1},
    wt:{ana:100,ben:20,cara:50},
  };
  const picker = makePicker(state);
  assert.deepEqual(picker.eligibleQueueIndexes(),[2,3,1]);
  assert.deepEqual(picker.pickN(4),[1,2,3].sort((a,b)=>a-b));
}

// Payload normalization keeps eligibility indexes and active court timestamps,
// while old clients without these new fields remain readable.
{
  const now = 1_800_000_000_000;
  const data = normalize({
    seq:7,t:11,wb:2,
    q:['Ana','Resting','Cara'],
    ei:[0,2,2,9,-1],
    courts:[
      {n:'Court 1',a:true,p:['A','B','C','D'],s:[6,4],t:now-5*60_000},
      {n:'Court 2',a:false,p:[],s:[0,0],t:now},
    ],
    tm:{a:25*60_000},
  });
  assert.deepEqual(data.q,['Ana','Resting','Cara']);
  assert.deepEqual(data.ei,[0,2]);
  assert.equal(data.courts[0].t,now-5*60_000);
  assert.equal(data.courts[1].t,0);

  const restAware = normalize({
    q:['Legacy A','Resting','Legacy B'],
    ri:[1],
    courts:[{n:'Court 1',a:false,p:[],s:[0,0]}],
  });
  assert.deepEqual(restAware.ei,[0,2],'resting indexes are omitted when Equal Sit-outs ordering is not active');

  const legacy = normalize({
    q:['Legacy A','Legacy B'],
    courts:[{n:'Court 1',a:true,p:[],s:[0,0]}],
  });
  assert.deepEqual(legacy.ei,[0,1],'legacy payloads treat all transmitted queue players as eligible');
  assert.equal(legacy.courts[0].t,0,'legacy court records without a start timestamp stay safe');
}

// Guard the host/viewer wiring so a future refactor cannot silently stop
// publishing eligibility metadata or rendering the resting indicator.
assert.match(html,/ei=S\.eq\?eligibleQueueIndexes\(\):null/);
assert.match(html,/ri=S\.eq\?\[\]:q\.map/);
assert.match(html,/t:c\.isActive\?Number\(c\.t\)\|\|0:0/);
assert.match(html,/liveQueueProjection\(queueData,d\.ei,courtsData/);\nassert.match(html,/UP NEXT/);
assert.match(html,/RESTING · SKIPPED/);
assert.match(html,/Eligible #/);

console.log(JSON.stringify({
  pass:true,
  restSkipped:true,
  equalSitoutsOrder:true,
  multipleCourtEta:true,
  activeCourtTiming:true,
  etaNoHistoryFallback:true,
  legacyPayloadCompatibility:true,
},null,2));
