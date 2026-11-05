import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function rotateQueueReturnOrder(');
const end=html.indexOf('\nfunction clear(c)',start);
assert.ok(start>=0&&end>start,'queue return rotation helper must exist');
const rotate=new Function(html.slice(start,end)+';return rotateQueueReturnOrder;')();

const original=['Ana','Ben','Cara','Dan'];
assert.deepEqual(rotate(original),['Ben','Cara','Dan','Ana'],'each completed game rotates the four-player group by one seat');
assert.deepEqual(rotate(['Ana','Ben']),['Ben','Ana'],'two returned players still swap');
assert.deepEqual(rotate(['Ana']),['Ana'],'single-player input is stable');

// The waiting line is not shuffled: only the just-finished group is rotated
// and appended behind every player who was already waiting.
{
  const queue=['Eli','Fay','Gus','Hana'];
  const finished=['Ana','Ben','Cara','Dan'];
  const before=queue.slice();
  const returned=rotate(finished);
  queue.push(...returned);
  assert.deepEqual(queue.slice(0,before.length),before,'waiting players stay ahead in original order');
  assert.deepEqual(queue.slice(before.length),['Ben','Cara','Dan','Ana']);
  assert.equal(new Set(queue).size,8,'nobody is duplicated or lost');
}

// Simulate repeated play with the same four-player group. Every player advances
// to the front in turn; nobody stays anchored to the same stack position.
{
  let queue=['A','B','C','D'];
  const leaders=[];
  for(let match=1;match<=12;match++){
    const playing=queue.splice(0,4);
    leaders.push(playing[0]);
    const returned=rotate(playing);
    assert.equal(returned.length,4);
    assert.deepEqual(new Set(returned),new Set(playing));
    queue.push(...returned);
  }
  assert.deepEqual(leaders,['A','B','C','D','A','B','C','D','A','B','C','D']);
}

// Multi-court games may finish in either order. Each finished group rotates
// independently, without moving players who were already waiting.
{
  const courtOne=['A','B','C','D'];
  const courtTwo=['E','F','G','H'];
  const queue=['I','J'];
  queue.push(...rotate(courtTwo));
  queue.push(...rotate(courtOne));
  assert.deepEqual(queue,['I','J','F','G','H','E','B','C','D','A']);
}

// Ensure the live app applies the rotation to both all-four-player return
// paths. Winners Stay's active win-through path remains intentionally separate.
assert.match(html,/players:takeNext\(\),score:\[0,0\]/);
assert.match(html,/const returned=rotateQueueReturnOrder\(\[\.\.\.lo,\.\.\.wn\]\);S\.queue\.push\(\.\.\.returned\);markWaiting\(returned\)/);
assert.match(html,/returned=rotateQueueReturnOrder\(back\);S\.queue\.push\(\.\.\.returned\);markWaiting\(returned\)/);
assert.match(html,/function clear\(c\)\{Object\.assign\(c,\{isActive:false,players:\[\],score:\[0,0\],mid:'',t:0,hold:null,stk:0\}\)\}/);

console.log(JSON.stringify({
  pass:true,
  oneSeatProgressiveRotation:true,
  waitingQueuePreserved:true,
  allPlayersRequeuedOnce:true,
  multiCourtOutOfOrderFinish:true,
  winnersStaySemanticsPreserved:true
},null,2));
