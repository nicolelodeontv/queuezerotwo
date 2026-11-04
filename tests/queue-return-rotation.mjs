import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function rotateQueueReturnOrder(');
const end=html.indexOf('\nfunction clear(c)',start);
assert.ok(start>=0&&end>start,'queue return rotation helper must exist');
const rotate=new Function(html.slice(start,end)+';return rotateQueueReturnOrder;')();

const original=['Ana','Ben','Cara','Dan'];
assert.deepEqual(rotate(original,1),['Ben','Cara','Dan','Ana'],'first completed game rotates one seat');
assert.deepEqual(rotate(original,2),['Cara','Dan','Ana','Ben'],'second completed game rotates two seats');
assert.deepEqual(rotate(original,3),['Dan','Ana','Ben','Cara'],'third completed game rotates three seats');
assert.deepEqual(rotate(original,4),['Ben','Cara','Dan','Ana'],'rotation cycles without freezing the front player');
assert.deepEqual(rotate(original,5),['Cara','Dan','Ana','Ben']);
assert.deepEqual(rotate(['Ana','Ben'],1),['Ben','Ana'],'two returned players still swap');
assert.deepEqual(rotate(['Ana'],1),['Ana'],'single-player input is stable');
assert.deepEqual(rotate(original,0),['Ben','Cara','Dan','Ana'],'legacy matches without a rotation counter use the safe first step');
assert.deepEqual(rotate(original,-5),['Ben','Cara','Dan','Ana'],'invalid negative counters use the safe first step');

// The waiting line is not shuffled: only the just-finished group is rotated
// and appended behind every player who was already waiting.
{
  const queue=['Eli','Fay','Gus','Hana'];
  const finished=['Ana','Ben','Cara','Dan'];
  const before=queue.slice();
  const returned=rotate(finished,1);
  queue.push(...returned);
  assert.deepEqual(queue.slice(0,before.length),before,'waiting players stay ahead in original order');
  assert.deepEqual(queue.slice(before.length),['Ben','Cara','Dan','Ana']);
  assert.equal(new Set(queue).size,8,'nobody is duplicated or lost');
}

// Simulate repeated play with the same four-player group. The queue leader
// advances around the group instead of preserving winner/loser pair blocks.
{
  let queue=['A','B','C','D'];
  const leaders=[];
  for(let match=1;match<=12;match++){
    const playing=queue.splice(0,4);
    leaders.push(playing[0]);
    const returned=rotate(playing,match);
    assert.equal(returned.length,4);
    assert.deepEqual(new Set(returned),new Set(playing));
    queue.push(...returned);
  }
  assert.deepEqual(leaders,['A','B','D','C','A','B','D','C','A','B','D','C']);
}

// Multi-court games carry their own rotation counters, so finishing courts
// out of order cannot reuse the most recently started game's counter.
{
  const courtOne={rot:1,players:['A','B','C','D']};
  const courtTwo={rot:2,players:['E','F','G','H']};
  const queue=['I','J'];
  queue.push(...rotate(courtTwo.players,courtTwo.rot));
  queue.push(...rotate(courtOne.players,courtOne.rot));
  assert.deepEqual(queue,['I','J','G','H','E','F','B','C','D','A']);
}

// Ensure the live app captures a per-match rotation sequence and applies it
// to both all-four-player return paths. Winners Stay's active win-through path
// remains intentionally separate.
assert.match(html,/players:takeNext\(\),score:\[0,0\],[^}]*rot:S\.sd/);
assert.match(html,/const returned=rotateQueueReturnOrder\(\[\.\.\.lo,\.\.\.wn\],c\.rot\);S\.queue\.push\(\.\.\.returned\);markWaiting\(returned\)/);
assert.match(html,/returned=rotateQueueReturnOrder\(back,c\.rot\);S\.queue\.push\(\.\.\.returned\);markWaiting\(returned\)/);
assert.match(html,/rot:0\}\)\}/);

console.log(JSON.stringify({
  pass:true,
  progressiveSeatRotation:true,
  waitingQueuePreserved:true,
  allPlayersRequeuedOnce:true,
  multiCourtOutOfOrderFinish:true,
  legacyActiveMatchFallback:true,
  winnersStaySemanticsPreserved:true
},null,2));
