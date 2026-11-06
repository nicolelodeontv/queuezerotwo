import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.APP_URL || 'http://127.0.0.1:4173/';
const SUPABASE = 'https://wochetemsnrysnjrgoed.supabase.co';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openMenu(page) {
  if (!(await page.locator('#qmenu').isVisible())) await page.locator('#mnb').click();
}

async function assertMenuToggleTopmost(page) {
  const box = await page.locator('#mnb').boundingBox();
  assert.ok(box);
  const hit = await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.closest('#mnb')?.id || null, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  assert.equal(hit, 'mnb');
}

async function freshContext(browser, device) {
  const context = await browser.newContext({
    ...device,
    serviceWorkers: 'block',
    locale: 'en-US',
  });
  await context.route(SUPABASE + '/**', route => route.abort());
  return context;
}

async function syncContext(browser, device, publishes, resultPublishes) {
  const context = await browser.newContext({
    ...device,
    serviceWorkers: 'allow',
    locale: 'en-US',
  });
  await context.route(SUPABASE + '/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/rpc/publish_pickle_session')) {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
      publishes.push(body);
      return route.fulfill({status:200, contentType:'application/json', body:'[null]'});
    }
    if (u.pathname.endsWith('/rpc/publish_pickle_results_v2')) {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
      resultPublishes.push(body);
      return route.fulfill({status:200, contentType:'application/json', body:'"R2RES1234"'});
    }
    return route.abort();
  });
  return context;
}

async function setupFour(page) {
  await page.goto(APP.split('#')[0], {waitUntil: 'networkidle'});
  await page.evaluate(() => {
    localStorage.removeItem('pickleStackState');
    localStorage.removeItem('queuezerotwo-publish-queue-v1');
  });
  await page.reload({waitUntil: 'networkidle'});
  await page.evaluate(() => {
    if (innerWidth < 1024) document.getElementById('nvs')?.click();
  });
  await page.locator('#pn').waitFor({state:'visible',timeout:5000});
  await page.locator('#pn').fill('Alpha,Beta,Gamma,Delta');
  await page.locator('#f button').click();
  await page.waitForFunction(() => document.getElementById('wc')?.textContent === '4', null, {timeout: 5000});
  await page.getByRole('button', {name: 'Check in all'}).click();
  await page.waitForFunction(() => document.getElementById('wc')?.textContent === '0', null, {timeout: 5000});
  await page.evaluate(() => document.getElementById('nvp')?.click());
  assert.equal(await page.locator('#qc').innerText(), '4');
}

async function finishAndChoose(page,winner=0) {
  await page.getByRole('button',{name:'FINISH & LOG'}).click();
  const dialog=page.locator('[role="dialog"]').last();
  await dialog.waitFor({state:'visible',timeout:5000});
  await dialog.locator('[data-w="'+winner+'"]').click();
  await dialog.waitFor({state:'detached'});
}

async function simulateOldCacheToV44(browser,oldVersion) {
  const context = await browser.newContext({...devices['Desktop Chrome'],serviceWorkers:'allow',locale:'en-US'});
  const page = await context.newPage();
  let swFetch = 0;
  const currentSw = fs.readFileSync(path.resolve('sw.js'), 'utf8');
  assert.match(currentSw,/queuezerotwo-v49/);
  const oldSw = `const V='queuezerotwo-v${oldVersion}';self.addEventListener('install',e=>e.waitUntil(caches.open(V).then(c=>c.put('/__queuezerotwo_v${oldVersion}_sentinel__',new Response('v${oldVersion}'))).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`;
  await context.route('**/sw.js', async route => {
    swFetch++;
    await route.fulfill({status:200,contentType:'application/javascript',body:swFetch===1?oldSw:currentSw});
  });
  // Prevent real session writes in this cache-upgrade test while allowing the
  // app to remain online so 127.0.0.1 navigation still works without SW fallback.
  await context.route(SUPABASE+'/**',route=>route.abort());
  await page.goto(APP,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!navigator.serviceWorker?.controller,null,{timeout:5000});
  await page.evaluate(()=>{
    localStorage.setItem('pickleStackState',JSON.stringify({courts:[{id:1,name:'Court 1',isActive:false,players:[],score:[0,0],mid:'',t:0}],queue:['Persisted player'],waiting:[],rest:{},log:[],target:11,lv:{},md:'bal',sd:0,gp:{},wt:{},ws:false,wl:2,eq:false,tts:false,hap:true,sid:'PERSISTEDSID',sh:'a'.repeat(64)}));
    localStorage.setItem('queuezerotwo-publish-queue-v1',JSON.stringify({v:1,seq:1,items:[{seq:1,sid:'PERSISTEDSID',sh:'a'.repeat(64),kind:'state',attempts:0,lastError:'',payload:{t:11,q:['Persisted player'],courts:[],nx:[],lb:[]}}]}));
  });
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
  await page.waitForFunction(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    return !!r?.waiting || await caches.has('queuezerotwo-v49');
  },null,{timeout:10000});
  await page.evaluate(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    if(r?.waiting)r.waiting.postMessage('SKIP_WAITING');
  });
  await page.waitForFunction(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    return !!r && !r.waiting && r.active?.state==='activated' && await caches.has('queuezerotwo-v49');
  },null,{timeout:10000});
  // The aborted Supabase request must settle before the startup-resume timer
  // fires, leaving one pending state item for queue coalescing to replace.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const q=JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items;
    return q.length===1&&Number.isSafeInteger(q[0]?.payload?.seq);
  },null,{timeout:5000});
  const out=await page.evaluate(async(oldVersion)=>{
    const cache=await caches.open('queuezerotwo-v49');
    return {
      queue:JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items,
      state:JSON.parse(localStorage.getItem('pickleStackState')||'{}'),
      oldCache:await caches.has('queuezerotwo-v'+oldVersion),
      profilesCached:!!(await cache.match('/profiles.js'))
    };
  },oldVersion);
  assert.equal(out.oldCache,false,'The previous v'+oldVersion+' cache is removed');
  assert.equal(out.profilesCached,true,'profiles.js is present in the offline shell cache');
  assert.equal(out.queue.length,1);
  assert.equal(out.queue[0].sid,'PERSISTEDSID');
  assert.ok(Number.isSafeInteger(out.queue[0].payload.seq),'Startup publishes the persisted host state with a numeric sequence');
  assert.equal(out.queue[0].payload.seq,out.state.liveSeq,'The queued snapshot uses the sequence persisted on the host');
  assert.match(out.queue[0].id,/^[0-9a-f]{32}$/);
  assert.equal(out.state.queue[0],'Persisted player');
  assert.equal(out.state.sid,'PERSISTEDSID');
  await context.close();
}

async function finishLogWinnerSelectionRegression(browser) {
  const context=await freshContext(browser,devices['Desktop Chrome']);
  const page=await context.newPage();
  const seed=async(score,options={})=>page.evaluate(({score,options})=>{
    pushS=()=>{};
    S=mk();
    S.queue=(options.queue||[]).slice();
    S.log=[];
    S.ws=!!options.ws;
    S.wl=2;
    S.target=11;
    S.wb=2;
    S.wt={};
    S.gp={};
    Object.assign(S.courts[0],{
      id:1,name:'Court 1',isActive:true,
      players:['Alpha','Beta','Gamma','Delta'],
      score:score.slice(),mid:'EARLYFIN1',t:Date.now()-60000,
      hold:null,stk:0
    });
    render();
  },{score,options});
  const openPrompt=async()=>{
    await page.locator('#courts button[onclick="fin(1)"]').click();
    const d=page.locator('[role="dialog"]');
    await d.waitFor({state:'visible',timeout:3000});
    await page.waitForFunction(()=>!!document.activeElement?.closest('[role="dialog"]'),null,{timeout:3000});
    assert.match(await d.innerText(),/Who won\?/i);
    return d;
  };
  try {
    await page.goto(APP,{waitUntil:'networkidle'});
    await page.evaluate(()=>{
      window.__earlyFinishLiveOriginalPushS=pushS;
      window.__earlyFinishLiveOriginalRpc=sb.rpc.bind(sb);
    });

    await seed([1,0],{queue:['Waiting 1','Waiting 2']});
    let dialog=await openPrompt();
    assert.match(await dialog.innerText(),/Court 1 · 1-0/i);
    assert.match(await dialog.locator('[data-w="0"]').innerText(),/Team 1/i);
    assert.match(await dialog.locator('[data-w="1"]').innerText(),/Team 2/i);
    assert.match(await dialog.locator('[data-w="0"]').getAttribute('class'),/bg-pickle-500/,
      'The team leading on the scoreboard is visually highlighted');
    await dialog.locator('[data-w="0"]').click();
    await dialog.waitFor({state:'detached'});
    let result=await page.evaluate(()=>({
      winner:S.log[0]?.w,score:S.log[0]?.s,active:S.courts[0].isActive,
      wins:stats().filter(x=>x.w>0).map(x=>x.n).sort(),queue:S.queue.slice()
    }));
    assert.equal(result.winner,0);
    assert.deepEqual(result.score,[1,0]);
    assert.equal(result.active,false);
    assert.deepEqual(result.wins,['Alpha','Beta']);
    assert.deepEqual(result.queue,['Waiting 1','Waiting 2','Beta','Gamma','Delta','Alpha'],
      'Existing waiters stay ahead; the completed group returns with a one-seat rotation');

    // A chosen winner may contradict the score, for example after a forfeit.
    await seed([1,0]);
    dialog=await openPrompt();
    await dialog.locator('[data-w="1"]').click();
    await dialog.waitFor({state:'detached'});
    result=await page.evaluate(()=>({winner:S.log[0]?.w,wins:stats().filter(x=>x.w>0).map(x=>x.n).sort(),queue:S.queue.slice()}));
    assert.equal(result.winner,1);
    assert.deepEqual(result.wins,['Delta','Gamma']);
    assert.deepEqual(result.queue,['Delta','Alpha','Beta','Gamma'],
      'Choosing Team 2 still rotates all four returning players');

    // Keep the historical unscored result behavior.
    await seed([7,3]);
    dialog=await openPrompt();
    await dialog.locator('[data-w="-1"]').click();
    await dialog.waitFor({state:'detached'});
    result=await page.evaluate(()=>({winner:S.log[0]?.w,wins:stats(),active:S.courts[0].isActive}));
    assert.equal(result.winner,-1);
    assert.deepEqual(result.wins,[]);
    assert.equal(result.active,false);

    // Every dismissal route leaves the score active and unlogged.
    await seed([1,0]);
    dialog=await openPrompt();
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});
    result=await page.evaluate(()=>({active:S.courts[0].isActive,log:S.log.length,score:S.courts[0].score}));
    assert.deepEqual(result,{active:true,log:0,score:[1,0]});

    await seed([1,0]);
    dialog=await openPrompt();
    await page.locator('body > div.fixed.inset-0').last().click({position:{x:3,y:3}});
    await dialog.waitFor({state:'detached'});
    result=await page.evaluate(()=>({active:S.courts[0].isActive,log:S.log.length}));
    assert.deepEqual(result,{active:true,log:0});

    await seed([1,0]);
    dialog=await openPrompt();
    await dialog.locator('[data-x]').click();
    await dialog.waitFor({state:'detached'});
    result=await page.evaluate(()=>({active:S.courts[0].isActive,log:S.log.length}));
    assert.deepEqual(result,{active:true,log:0});

    // Another path cancels the match while the winner prompt is still open.
    // Confirming the stale prompt must close it, show a warning, and log nothing.
    await seed([1,0]);
    dialog=await openPrompt();
    await page.evaluate(()=>drop(1));
    await page.waitForFunction(()=>document.querySelectorAll('[role="dialog"]').length===2,null,{timeout:3000});
    const cancelPrompt=await page.locator('[role="dialog"]').last().innerText();
    assert.match(cancelPrompt,/Cancel match\?/i);
    await page.evaluate(()=>{
      const dialogs=[...document.querySelectorAll('[role="dialog"]')];
      const confirm=dialogs.at(-1)?.querySelector('button.y');
      if(!confirm)throw new Error('Cancel-match confirmation button was not rendered');
      confirm.click();
    });
    await page.waitForFunction(()=>document.querySelectorAll('[role="dialog"]').length===1,null,{timeout:3000});
    await dialog.locator('[data-w="0"]').click();
    await dialog.waitFor({state:'detached'});
    await page.waitForFunction(()=>document.getElementById('msg')?.innerText.includes('That match changed.'),null,{timeout:3000});
    result=await page.evaluate(()=>({active:S.courts[0].isActive,log:S.log.length,mid:S.courts[0].mid}));
    assert.equal(result.active,false);
    assert.equal(result.log,0);
    assert.equal(result.mid,'');

    // A completed score still opens the picker, and the host can override the scoreboard leader.
    await seed([11,5]);
    dialog=await openPrompt();
    await dialog.locator('[data-w="1"]').click();
    await dialog.waitFor({state:'detached'});
    result=await page.evaluate(()=>({winner:S.log[0]?.w,score:S.log[0]?.s,active:S.courts[0].isActive}));
    assert.deepEqual(result,{winner:1,score:[11,5],active:false});

    // Even a 0-0 finish lets the host choose a winner and records that choice.
    await seed([0,0]);
    dialog=await openPrompt();
    await dialog.locator('[data-w="0"]').click();
    await dialog.waitFor({state:'detached'});
    result=await page.evaluate(()=>({
      log:S.log.length,winner:S.log[0]?.w,score:S.log[0]?.s,
      active:S.courts[0].isActive,queue:S.queue.slice()
    }));
    assert.deepEqual(result,{log:1,winner:0,score:[0,0],active:false,queue:['Beta','Gamma','Delta','Alpha']});

    // Winners Stay applies the selected winner even when the score disagrees.
    await seed([1,0],{ws:true,queue:['Echo','Foxtrot','Hotel','India']});
    dialog=await openPrompt();
    await dialog.locator('[data-w="1"]').click();
    await dialog.waitFor({state:'detached'});
    result=await page.evaluate(()=>({
      winner:S.log[0]?.w,active:S.courts[0].isActive,
      players:S.courts[0].players.slice(),score:S.courts[0].score.slice(),
      hold:S.courts[0].hold,queue:S.queue.slice()
    }));
    assert.equal(result.winner,1);
    assert.equal(result.active,true);
    assert.deepEqual(result.players,['Gamma','Delta','Echo','Foxtrot']);
    assert.deepEqual(result.score,[0,0]);
    assert.deepEqual(result.hold,['Gamma','Delta']);
    assert.deepEqual(result.queue,['Hotel','India','Alpha','Beta']);

    // The actual save path must publish a valid sdata() snapshot whose leaderboard
    // reflects the manually selected winner, even when that choice contradicts 1-0.
    for(const pickedWinner of [0,1]){
      await seed([1,0]);
      await page.evaluate(()=>{
        window.__earlyFinishLiveCalls=[];
        pushS=window.__earlyFinishLiveOriginalPushS;
        S.sid='LIVEWIN01';S.sh='a'.repeat(64);S.ho=false;S.ended=false;
        sb.rpc=async(name,args)=>{
          if(name!=='publish_pickle_session')return {data:null,error:new Error('Unexpected RPC '+name)};
          window.__earlyFinishLiveCalls.push({name,args});
          return {data:true,error:null};
        };
      });
      dialog=await openPrompt();
      await dialog.locator('[data-w="'+pickedWinner+'"]').click();
      await dialog.waitFor({state:'detached'});
      await page.waitForFunction(()=>window.__earlyFinishLiveCalls?.length>0,null,{timeout:5000});
      const published=await page.evaluate(()=>window.__earlyFinishLiveCalls.at(-1));
      assert.equal(published.name,'publish_pickle_session');
      assert.ok(published.args.p_payload&&Array.isArray(published.args.p_payload.lb));
      assert.ok(Array.isArray(published.args.p_payload.courts));
      assert.ok(Array.isArray(published.args.p_payload.q));
      assert.ok(Array.isArray(published.args.p_payload.nx));
      const publishedWinners=published.args.p_payload.lb.filter(x=>x.w===1).map(x=>x.n).sort();
      assert.deepEqual(
        publishedWinners,
        pickedWinner===0?['Alpha','Beta']:['Delta','Gamma'],
        'The Live View RPC payload leaderboard follows the winner selected in the prompt'
      );
      await page.evaluate(()=>{
        sb.rpc=window.__earlyFinishLiveOriginalRpc;
        pushS=()=>{};
        PQ=[];PQS=0;savePublishQueue();
      });
    }

    // A selected 1-0 winner survives export, #57 import normalization, and #r=.
    await seed([1,0]);
    dialog=await openPrompt();
    await dialog.locator('[data-w="0"]').click();
    await dialog.waitFor({state:'detached'});
    const roundTrip=await page.evaluate(()=>{
      const backup=JSON.parse(expData());
      const imported=cleanState(backup);
      const state=mk();
      state.courts=state.courts.slice(0,1);
      state.log=[0,1,-1,2,null,'bad','0','1','-1',true].map((winner,i)=>({
        c:'Court '+(i+1),p:['A','B','C','D'],s:[1,0],w:winner,tg:11,t:1,d:1000
      }));
      const winnerSanitizer=cleanState({state}).log.map(x=>x.w);
      imported.log.push({mid:'EARLYFIN02',c:'Court 2',p:['Eve','Finn','Gail','Hugo'],s:[1,0],w:1,tg:11,t:2,d:1000});
      S=imported;
      const results=resultsSnapshot();
      return {
        exportedWinner:backup.state.log[0]?.w,
        importedWinner:imported.log[0]?.w,
        importedScore:imported.log[0]?.s,
        resultsWinner:results.matches[0]?.w,
        resultsScore:results.matches[0]?.s,
        resultsWinner1:results.matches[1]?.w,
        resultsPayload:results,
        winnerSanitizer
      };
    });
    assert.equal(roundTrip.exportedWinner,0);
    assert.equal(roundTrip.importedWinner,0);
    assert.deepEqual(roundTrip.importedScore,[1,0]);
    assert.equal(roundTrip.resultsWinner,0);
    assert.deepEqual(roundTrip.resultsScore,[1,0]);
    assert.equal(roundTrip.resultsWinner1,1);
    assert.deepEqual(roundTrip.winnerSanitizer,[0,1,-1,-1,-1,-1,0,1,-1,-1],
      'Backup import keeps 0, 1, -1 and normalizes every other value to -1');

    const resultsContext=await freshContext(browser,devices['Desktop Chrome']);
    try {
      await resultsContext.route(SUPABASE+'/**',route=>{
        const u=new URL(route.request().url());
        if(u.pathname.endsWith('/rest/v1/pickle_results')&&route.request().method()==='GET'){
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{
            data:roundTrip.resultsPayload,
            created_at:new Date().toISOString(),
            expires_at:new Date(Date.now()+30*86400000).toISOString()
          }])});
        }
        return route.abort();
      });
      const resultsPage=await resultsContext.newPage();
      await resultsPage.goto(APP+'#r=EARLYFIN01',{waitUntil:'networkidle'});
      await resultsPage.getByText('Session Results',{exact:true}).waitFor({state:'visible',timeout:5000});
      await resultsPage.getByText('READ-ONLY',{exact:true}).waitFor({state:'visible',timeout:5000});
      await resultsPage.locator('#viewer .p-3.text-sm.flex.items-center.gap-2').nth(1).waitFor({state:'visible',timeout:5000});
      const highlightedTeams=await resultsPage.locator('#viewer .p-3.text-sm.flex.items-center.gap-2').evaluateAll(rows=>
        rows.map(row=>{
          const team0=row.querySelectorAll('span')[1],team1=row.querySelectorAll('span')[3];
          return {
            team0:!!team0?.classList.contains('text-pickle-500'),
            team1:!!team1?.classList.contains('text-pickle-500')
          }
        })
      );
      assert.deepEqual(highlightedTeams,[{team0:true,team1:false},{team0:false,team1:true}],
        '#r= highlights Team 1 for w=0 and Team 2 for w=1');
      assert.match(await resultsPage.locator('#viewer').innerText(),/1-0/);
    } finally {
      await resultsContext.close();
    }
  } finally {
    await context.close();
  }
}

async function mobileEarlyFinishUndoRegression(browser) {
  const context=await freshContext(browser,devices['iPhone 13']);
  const page=await context.newPage();
  try {
    await page.goto(APP,{waitUntil:'networkidle'});
    await page.evaluate(()=>{
      pushS=()=>{};
      S=mk();
      Object.assign(S.courts[0],{
        id:1,name:'Court 1',isActive:true,
        players:['Alpha','Beta','Gamma','Delta'],
        score:[1,0],mid:'MOBILEUND01',t:Date.now()-60000,hold:null,stk:0
      });
      render();
    });
    assert.ok(await page.evaluate(()=>innerWidth<=430),'The Undo regression runs at phone width');
    const before=await page.evaluate(()=>JSON.stringify(S));
    await page.locator('#courts button[onclick="fin(1)"]').click();
    const dialog=page.locator('[role="dialog"]');
    await dialog.waitFor({state:'visible',timeout:3000});
    await page.waitForFunction(()=>!!document.activeElement?.closest('[role="dialog"]'),null,{timeout:3000});
    await dialog.locator('[data-w="0"]').click();
    await dialog.waitFor({state:'detached'});
    await page.getByRole('button',{name:'Undo'}).waitFor({state:'visible',timeout:3000});
    const logged=await page.evaluate(()=>({winner:S.log[0]?.w,active:S.courts[0].isActive,score:S.courts[0].score}));
    assert.deepEqual(logged,{winner:0,active:false,score:[0,0]});
    await page.getByRole('button',{name:'Undo'}).click();
    await page.waitForFunction(()=>S.log.length===0&&S.courts[0].isActive,null,{timeout:3000});
    const restored=await page.evaluate(()=>JSON.stringify(S));
    assert.equal(restored,before,'Undo restores the exact active court and pre-prompt match log');
    const state=await page.evaluate(()=>({
      active:S.courts[0].isActive,
      players:S.courts[0].players,
      score:S.courts[0].score,
      log:S.log.length,
      queue:S.queue.length
    }));
    assert.deepEqual(state,{
      active:true,players:['Alpha','Beta','Gamma','Delta'],score:[1,0],log:0,queue:0
    });
  } finally {
    await context.close();
  }
}
async function durableQueueCompactionRegression(browser) {
  const context=await freshContext(browser,devices['Desktop Chrome']);
  const page=await context.newPage();
  await page.addInitScript(()=>{
    const items=[];
    const hostKey='a'.repeat(64);
    for(let i=0;i<250;i++){
      items.push({id:'state-'+i,seq:i+1,sid:'QUEUE0001',sh:hostKey,kind:'state',attempts:0,lastError:'',payload:{marker:i}});
    }
    // Results entries are independent durable records; keep every one even beyond 200 items.
    for(let i=0;i<205;i++){
      items.push({id:'result-'+i,seq:251+i,sid:'CODE'+String(i).padStart(6,'0'),sh:String(i).padStart(64,'a'),kind:'results',rid:'RESLT'+String(i).padStart(5,'0'),attempts:0,lastError:'',payload:{v:1,marker:i,leaderboard:[],matches:[]}});
    }
    localStorage.setItem('queuezerotwo-publish-queue-v1',JSON.stringify({v:1,seq:455,items}));
  });
  await page.goto(APP,{waitUntil:'networkidle'});
  const result=await page.evaluate(()=>{
    const q=JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}');
    const states=q.items.filter(x=>x.kind==='state');
    const results=q.items.filter(x=>x.kind==='results');
    return {total:q.items.length,stateCount:states.length,latestStateMarker:states[0]?.payload?.marker,resultsCount:results.length,uniqueResults:new Set(results.map(x=>x.rid)).size};
  });
  assert.ok(result.total>200,'the test queue stays above the former cap');
  assert.equal(result.stateCount,1,'old state snapshots for the same host are coalesced');
  assert.equal(result.latestStateMarker,249,'the newest whole-state snapshot survives');
  assert.equal(result.resultsCount,205,'no results publications are trimmed');
  assert.equal(result.uniqueResults,205,'all distinct result codes remain queued');
  await context.close();
}

async function realisticStorageQuotaRegression(browser) {
  const context=await freshContext(browser,devices['Desktop Chrome']);
  const page=await context.newPage();
  await page.addInitScript(()=>{
    const queueKey='queuezerotwo-publish-queue-v1';
    const roster=Array.from({length:32},(_,i)=>'Player '+String(i+1).padStart(2,'0')+' Advanced');
    const payloadFor=seed=>({
      v:1,
      name:'Saturday open play '+seed,
      totals:{players:32,games:500,courts:8,playTo:11,winBy:2},
      leaderboard:roster.map((n,i)=>({n,w:50-(i%7),l:20+(i%5),d:10-(i%9)})),
      matches:Array.from({length:500},(_,g)=>({
        c:'Court '+(g%8+1),
        p:[roster[g%32],roster[(g+1)%32],roster[(g+2)%32],roster[(g+3)%32]],
        s:g%2?[11,8]:[8,11],w:g%2,tg:11,t:1791500000000-g*60000,d:240000
      }))
    });
    const items=Array.from({length:20},(_,i)=>({
      id:'seed-result-'+String(i).padStart(4,'0'),seq:i+1,
      sid:'QSEED'+String(i).padStart(5,'0'),sh:'a'.repeat(64),
      kind:'results',rid:'RSLT'+String(i).padStart(6,'0'),
      attempts:0,lastError:'',payload:payloadFor(i)
    }));
    // Each saved result resembles a full 500-match session snapshot, not a tiny placeholder.
    localStorage.setItem(queueKey,JSON.stringify({v:1,seq:items.length,items}));
    localStorage.setItem('__qzt_quota_padding','p'.repeat(250000));

    // Model localStorage's commonly documented ~5 MiB budget in UTF-16 storage units.
    // The initial realistic queue fits; a few additional result snapshots push it over.
    const limit=5*1024*1024;
    const nativeSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      const k=String(key),v=String(value);
      let used=0;
      for(let i=0;i<this.length;i++){
        const oldKey=this.key(i),oldValue=this.getItem(oldKey)||'';
        used+=(oldKey.length+oldValue.length)*2;
      }
      const existing=this.getItem(k);
      if(existing!==null)used-=(k.length+existing.length)*2;
      used+=(k.length+v.length)*2;
      if(used>limit)throw new DOMException('The quota has been exceeded.','QuotaExceededError');
      return nativeSetItem.call(this,k,v);
    };
  });
  await page.goto(APP,{waitUntil:'networkidle'});
  await context.setOffline(true);
  await page.waitForTimeout(150);
  const outcome=await page.evaluate(()=>{
    const key='queuezerotwo-publish-queue-v1';
    const roster=Array.from({length:32},(_,i)=>'Player '+String(i+1).padStart(2,'0')+' Advanced');
    const payloadFor=seed=>({
      v:1,name:'Additional open play '+seed,
      totals:{players:32,games:500,courts:8,playTo:11,winBy:2},
      leaderboard:roster.map((n,i)=>({n,w:49-(i%7),l:21+(i%5),d:9-(i%9)})),
      matches:Array.from({length:500},(_,g)=>({
        c:'Court '+(g%8+1),
        p:[roster[g%32],roster[(g+1)%32],roster[(g+2)%32],roster[(g+3)%32]],
        s:g%2?[11,8]:[8,11],w:g%2,tg:11,t:1791500000000-g*60000,d:240000
      }))
    });
    const initialCount=PQ.length;
    let failedAt=-1;
    for(let i=0;i<20;i++){
      const seq=++PQS;
      PQ.push({
        id:newPublishEntryId(),seq,sid:'QNEW'+String(i).padStart(5,'0'),
        sh:'b'.repeat(64),kind:'results',rid:'NRES'+String(i).padStart(6,'0'),
        attempts:0,lastError:'',payload:payloadFor(i+100)
      });
      if(!savePublishQueue()){failedAt=i;break}
    }
    const persisted=JSON.parse(localStorage.getItem(key)||'{"items":[]}');
    const latest=PQ[PQ.length-1];
    let unloadPrevented=false;
    const before=new Event('beforeunload',{cancelable:true});
    unloadPrevented=!window.dispatchEvent(before)||before.defaultPrevented;
    return {
      initialCount,memoryCount:PQ.length,persistedCount:persisted.items.length,
      failedAt,latestId:latest&&latest.id,
      latestPersistedId:persisted.items[persisted.items.length-1]?.id,
      queueFailure:StorageFailures.has('queue'),
      marker:document.getElementById('ct')?.textContent||'',
      screenReaderWarning:document.getElementById('sr')?.textContent||'',
      localStorageFailureWarning:document.getElementById('msg')?.innerText||'',
      unloadPrevented,
      persistedChars:JSON.stringify(persisted).length,
      estimatedStorageBytes:Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).reduce((sum,key)=>sum+(key.length+(localStorage.getItem(key)||'').length)*2,0)
    };
  });
  assert.ok(outcome.persistedChars>1500000,'the stored realistic result queue is over 1.5 million characters');
  assert.ok(outcome.estimatedStorageBytes>3500000,'the complete origin storage is several megabytes before failure');
  assert.ok(outcome.failedAt>=0,'writing additional realistic results eventually hits the simulated quota');
  assert.equal(outcome.queueFailure,true,'the storage failure is tracked, not swallowed');
  assert.equal(outcome.memoryCount,outcome.persistedCount+1,'the failed newest result remains in memory and is not silently removed');
  assert.notEqual(outcome.latestId,outcome.latestPersistedId,'the failed entry is visibly not yet persisted');
  assert.match(outcome.marker,/Storage error/i,'the connection status no longer claims the device is saved');
  assert.match(outcome.screenReaderWarning,/not safely saved/i,'the persistent warning is exposed to assistive technology');
  assert.match(outcome.localStorageFailureWarning,/Export a backup/i,'the user sees instructions to protect their data');
  assert.equal(outcome.unloadPrevented,true,'leaving the page is guarded while entries are not safely persisted');
  await context.close();
}

async function leaderboardPodiumRegression(browser) {
  const context = await freshContext(browser, devices['Desktop Chrome']);
  const page = await context.newPage();
  try {
    await page.goto(APP, {waitUntil:'networkidle'});
    await page.evaluate(() => {
      S = mk();
      S.log = [
        {w:0,p:['Alpha','Beta','Gamma','Delta'],s:[11,4],c:'Court 1',tg:11,t:1,d:240000},
        {w:0,p:['Alpha','Beta','Echo','Foxtrot'],s:[11,6],c:'Court 1',tg:11,t:2,d:240000},
        {w:1,p:['Golf','Hotel','Gamma','Delta'],s:[6,11],c:'Court 2',tg:11,t:3,d:240000},
      ];
      renderLB();
    });
    const rows = await page.locator('#lb tbody tr').evaluateAll(items => items.slice(0,4).map(row => ({
      classes: row.className,
      rank: row.querySelector('.lb-rank-badge')?.getAttribute('aria-label'),
      medal: row.querySelector('.lb-rank-badge')?.textContent.trim(),
      player: row.children[1]?.textContent.trim(),
    })));
    assert.equal(rows[0].player,'Alpha');
    assert.equal(rows[1].player,'Beta');
    assert.equal(rows[2].player,'Gamma');
    assert.deepEqual(rows.slice(0,3).map(row=>row.rank),['Rank 1','Rank 2','Rank 3']);
    assert.deepEqual(rows.slice(0,3).map(row=>row.medal),['🥇','🥈','🥉']);
    assert.match(rows[0].classes,/lb-podium-row.*lb-podium-1/);
    assert.match(rows[1].classes,/lb-podium-row.*lb-podium-2/);
    assert.match(rows[2].classes,/lb-podium-row.*lb-podium-3/);
    assert.doesNotMatch(rows[3].classes,/lb-podium-row/);
  } finally {
    await context.close();
  }
}


async function playerRotationFairnessRegression(browser) {
  const context=await freshContext(browser,devices['Desktop Chrome']);
  const page=await context.newPage();
  try {
    await page.goto(APP,{waitUntil:'networkidle'});
    await page.locator('button[onclick="rotationFairness()"]').click();
    const baselineDialog=page.locator('[role="dialog"]').last();
    const baselineText=await baselineDialog.innerText();
    assert.match(baselineText,/Building baseline/,'An untouched session does not show a misleading perfect score');
    await baselineDialog.getByRole('button',{name:'Close'}).click();
    const outcome=await page.evaluate(()=>{
      pushS=()=>{};
      S=mk();
      const now=Date.now();
      S.queue=['Ava','Ben','Cara','Dan','Eli','Fay','Gus','Hana','Ivy','Jules','Kai','Lena'];
      S.rest={fay:1};
      S.wt=Object.fromEntries(S.queue.map(n=>[n.toLowerCase(),now-(String(n).toLowerCase()==='lena'?35:5)*60000]));
      const first=takeNext();
      Object.assign(S.courts[0],{isActive:true,players:first,score:[4,2],mid:'FAIR001',t:now-300000});
      const second=takeNext();
      Object.assign(S.courts[1],{isActive:true,players:second,score:[3,1],mid:'FAIR002',t:now-180000});
      const records=JSON.parse(JSON.stringify(S.fair));
      const helperState=S;
      S=mk();
      S.queue=['Queue player','Resting'];
      S.rest={resting:1};
      recordRotationSelection(['Challenger 1','Challenger 2'],['Losing 1','Losing 2']);
      const winnersStay={
        losingPair:[S.fair['losing 1']?.sitouts||0,S.fair['losing 2']?.sitouts||0],
        queued:S.fair['queue player']?.sitouts||0,
        resting:S.fair.resting?.sitouts||0,
        selected:S.fair['challenger 1']?.consecutiveSitouts||0
      };
      const imported=cleanState({courts:[{id:1,name:'Court 1',isActive:false,players:[],score:[0,0]}],fair:{ava:{sitouts:7,consecutiveSitouts:2,maxConsecutiveSitouts:3,totalWaitMs:900000,waitSamples:2,lastWaitMs:300000,lastSelectedAt:now},invalid:'bad'}});
      const unsafeFair=cleanState({courts:[{id:1,name:'Court 1',isActive:false,players:[],score:[0,0]}],fair:JSON.parse('{"__proto__":{"sitouts":99},"constructor":{"sitouts":88}}')}).fair;
      S=helperState;
      render();
      return {records,winnersStay,importRoundTrip:imported.fair.ava,noInvalidImport:!Object.prototype.hasOwnProperty.call(imported.fair,'invalid'),unsafeFairKeys:Object.keys(unsafeFair),safeFairPrototype:Object.getPrototypeOf(unsafeFair)===Object.prototype};
    });
    assert.equal(outcome.records.eli.sitouts,1,'Players waiting behind the first court selection get a sit-out');
    assert.equal(outcome.records.eli.consecutiveSitouts,0,'A selected player has their consecutive sit-out streak reset');
    assert.equal(outcome.records.jules.sitouts,2,'A player left in the queue through two selections gets two sit-outs');
    assert.equal(outcome.records.jules.consecutiveSitouts,2,'Consecutive sit-outs accumulate across match starts');
    assert.equal(outcome.records.fay?.sitouts||0,0,'Players who are resting are not counted as eligible sit-outs');
    assert.ok(outcome.records.ava.waitSamples===1&&outcome.records.ava.totalWaitMs>=4*60000,'Selecting a player records their queue wait');
    assert.deepEqual(outcome.winnersStay,{losingPair:[1,1],queued:1,resting:0,selected:0},
      'A winners-stay selection counts the losing pair and idle eligible queue while excluding resting players');
    assert.equal(outcome.importRoundTrip.sitouts,7,'Fairness counters survive a validated backup import');
    assert.equal(outcome.importRoundTrip.totalWaitMs,900000);
    assert.equal(outcome.noInvalidImport,true,'Invalid fairness records are discarded during backup import');
    assert.deepEqual(outcome.unsafeFairKeys,[],'Prototype-sensitive fairness keys are discarded from imported backups');
    assert.equal(outcome.safeFairPrototype,true,'Imported fairness data retains a normal, unpolluted object prototype');
    await page.locator('button[onclick="rotationFairness()"]').click();
    const dialog=page.locator('[role="dialog"]').last();
    await dialog.getByText('Player Rotation Fairness',{exact:true}).waitFor({state:'visible',timeout:5000});
    const text=await dialog.innerText();
    assert.match(text,/Rotation balance score/i);
    assert.match(text,/Avg wait/i);
    assert.match(text,/LONG WAIT/,'The player with the unusually long current wait is flagged');
    assert.match(text,/Lena/);
    assert.match(text,/Sit-outs/);
    assert.match(text,/Best/,'The monitor shows each player’s longest sit-out streak too');
    await dialog.getByRole('button',{name:'Close'}).click();
  } finally {
    await context.close();
  }
}

async function sessionFairnessTrendsRegression(browser) {
  const context=await freshContext(browser,devices['Desktop Chrome']);
  const page=await context.newPage();
  try {
    await page.goto(APP,{waitUntil:'networkidle'});
    const outcome=await page.evaluate(()=>{
      pushS=()=>{};
      S=mk();
      const now=Date.now();
      S.name='Saturday Open Play';
      S.queue=['Eli','Fay'];
      S.rest={fay:1};
      S.log=[{p:['Ava','Ben','Cara','Dan'],s:[11,8],w:0,c:'Court 1',tg:11,t:now-300000,d:240000}];
      S.gp={ava:3,ben:2,cara:2,dan:2,eli:1};
      S.fair={
        ava:{sitouts:1,consecutiveSitouts:0,maxConsecutiveSitouts:1,totalWaitMs:600000,waitSamples:2},
        ben:{sitouts:2,consecutiveSitouts:1,maxConsecutiveSitouts:2,totalWaitMs:900000,waitSamples:3},
        cara:{sitouts:1,consecutiveSitouts:0,maxConsecutiveSitouts:1,totalWaitMs:300000,waitSamples:1},
        dan:{sitouts:1,consecutiveSitouts:0,maxConsecutiveSitouts:1,totalWaitMs:300000,waitSamples:1},
        eli:{sitouts:3,consecutiveSitouts:2,maxConsecutiveSitouts:3,totalWaitMs:1200000,waitSamples:2},
        fay:{sitouts:0,consecutiveSitouts:0,maxConsecutiveSitouts:0,totalWaitMs:0,waitSamples:0}
      };
      const saved=archive();
      const snapshot=saved[0].fairness;
      const previous=JSON.parse(JSON.stringify(saved[0]));
      previous.id='OLDER1';previous.name='Previous Saturday';previous.t=now-86400000;
      previous.fairness.score=Math.max(0,(previous.fairness.score||0)-12);
      S.hist=[saved[0],previous];
      const imported=cleanState({courts:mk().courts,hist:S.hist});
      const hostile=cleanState({courts:mk().courts,hist:[{id:'BAD1',name:'Bad',t:now,g:1,top:[],fairness:{score:150,players:[{name:'__proto__',games:99},{name:'Nia',games:-3,sitouts:-2,streak:2,maxStreak:1,totalWaitMs:-1,waitSamples:1}]}}]});
      S.hist=imported.hist;
      render();
      return {
        snapshot,archivedCount:saved.length,importedScore:imported.hist[0].fairness.score,
        importedPlayers:imported.hist[0].fairness.players.length,
        hostileScore:hostile.hist[0].fairness.score,
        hostilePlayers:hostile.hist[0].fairness.players,
        hasPrevious:imported.hist[1].fairness.score!==null
      };
    });
    assert.equal(outcome.archivedCount,1,'Archiving a completed session creates one history record');
    assert.ok(outcome.snapshot&&outcome.snapshot.version===1,'Archived session has a versioned fairness snapshot');
    assert.ok(outcome.snapshot.score>=0&&outcome.snapshot.score<=100,'The archived balance score stays within 0–100');
    assert.equal(outcome.snapshot.players.length,6,'The snapshot retains players from games, queue and fairness counters');
    assert.equal(outcome.snapshot.participants,5,'Players who opted to rest are excluded from active participant counts');
    assert.equal(outcome.snapshot.totalGamesStarted,10,'The snapshot totals player game starts');
    assert.ok(outcome.snapshot.totalSitouts>0,'The snapshot totals eligible sit-outs');
    assert.equal(outcome.importedScore,outcome.snapshot.score,'Fairness history survives validated backup import');
    assert.equal(outcome.importedPlayers,6,'Per-player fairness history survives backup import');
    assert.equal(outcome.hostileScore,100,'Imported scores are clamped to the supported range');
    assert.deepEqual(outcome.hostilePlayers.map(p=>p.name),['Nia'],'Prototype-sensitive names are rejected in imported history');
    assert.equal(outcome.hostilePlayers[0].games,0,'Negative imported player counts are normalized');
    assert.equal(outcome.hasPrevious,true,'The previous session fairness report remains available');
    await page.locator('button[onclick="fairnessTrends()"]').click();
    const dialog=page.locator('[role="dialog"]').last();
    await dialog.getByText('Session Fairness Trends',{exact:true}).waitFor({state:'visible',timeout:5000});
    const text=await dialog.innerText();
    assert.match(text,/Tracked sessions/);
    assert.match(text,/Fairness score by session/);
    assert.match(text,/Least served average/i);
    assert.match(text,/Most served average/i);
    assert.match(text,/Player comparison/);
    assert.match(text,/Eli/);
    assert.match(text,/Ava/);
    assert.doesNotMatch(text,/Fay/,'Players marked as resting are not ranked as under-served');
    assert.equal(await dialog.locator('[role="img"][aria-label^="Fairness score across"]').count(),1,
      'The chart exposes an accessible description of the archived trend');
    await dialog.getByRole('button',{name:'Close'}).click();
  } finally {
    await context.close();
  }
}

async function avatarProfileRegression(browser) {
  const context = await freshContext(browser, devices['Desktop Chrome']);
  const page = await context.newPage();
  const avatarBackupPath = path.join(os.tmpdir(), 'queuezerotwo-avatar-profile-backup.json');
  try {
    await page.addInitScript(() => {
      localStorage.setItem('pickleStackPlayers', JSON.stringify({
        alpha: {n:'Alpha',w:3,l:1,pf:44,pa:32,s:2,last:1791500000000,form:['W','L'],pt:{},lv:4}
      }));
    });
    await page.goto(APP,{waitUntil:'networkidle'});
    await openMenu(page);
    await page.locator('#qmenu button[title="Players"]').click();
    const player = page.locator('.pr[data-k="alpha"]');
    await player.waitFor({state:'visible',timeout:5000});
    await player.click();
    await page.locator('[data-avatar]').waitFor({state:'visible',timeout:5000});

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-avatar]').click()
    ]);
    await chooser.setFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
    await page.getByText('Avatar saved on this device.').waitFor({state:'visible',timeout:5000});
    const stored = await page.evaluate(()=>JSON.parse(localStorage.getItem('pickleStackPlayers')||'{}').alpha?.avatar||'');
    assert.ok(stored.startsWith('data:image/jpeg;base64,'),'A chosen image is resized and stored as local JPEG data');
    assert.equal(await page.locator('.avatar-preview img[src^="data:image/jpeg;base64,"]').count(),1);

    const [badChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-avatar]').click()
    ]);
    await badChooser.setFiles({name:'not-an-image.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')});
    await page.getByText('Choose a JPG, PNG or WebP image under 5 MB.').waitFor({state:'visible',timeout:5000});
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pickleStackPlayers')||'{}').alpha?.avatar||''),stored,
      'Rejecting an unsupported image must retain the existing avatar');

    await page.locator('button[aria-label="Close"]').last().click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.ex').click()
    ]);
    await download.saveAs(avatarBackupPath);
    const backup = JSON.parse(fs.readFileSync(avatarBackupPath,'utf8'));
    assert.ok(backup.players.alpha.avatar.startsWith('data:image/jpeg;base64,'),
      'Player backups must include the saved avatar');

    await player.click();
    await page.locator('[data-remove-avatar]').click();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pickleStackPlayers')||'{}').alpha?.avatar||''),'',
      'Removing the avatar clears it from the local profile');
  } finally {
    try { fs.unlinkSync(avatarBackupPath); } catch {}
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({headless: true});
  const desktop = await freshContext(browser, devices['Desktop Chrome']);
  const iphone = await freshContext(browser, devices['iPhone 13']);
  const pixel = await freshContext(browser, devices['Pixel 7']);

  const dp = await desktop.newPage();
  const ip = await iphone.newPage();
  const pp = await pixel.newPage();
  const debugDir=path.resolve('artifacts/playwright-debug');
  fs.mkdirSync(debugDir,{recursive:true});
  for (const [name,page] of [['desktop',dp],['iphone',ip],['pixel',pp]]) {
    page.on('pageerror',error=>console.error('[Playwright pageerror '+name+']',error.stack||error));
    page.on('console',message=>{if(message.type()==='error')console.error('[Playwright console '+name+']',message.text())});
  }
  await Promise.all([desktop,iphone,pixel].map(context=>context.tracing.start({screenshots:true,snapshots:true,sources:true})));
  const syncPublishes = [];
  const resultPublishes = [];
  for(let oldVersion=1;oldVersion<=43;oldVersion++){
    await simulateOldCacheToV44(browser,oldVersion);
  }
  await finishLogWinnerSelectionRegression(browser);
  await mobileEarlyFinishUndoRegression(browser);
  await avatarProfileRegression(browser);
  await leaderboardPodiumRegression(browser);
  await playerRotationFairnessRegression(browser);
  await sessionFairnessTrendsRegression(browser);
  await durableQueueCompactionRegression(browser);
  const sync = await syncContext(browser, devices['Pixel 7'], syncPublishes, resultPublishes);
  const sp = await sync.newPage();
  const backupPath = path.join(os.tmpdir(), 'queuezerotwo-release2b-backup.json');
  const persistencePath = path.join(os.tmpdir(), 'queuezerotwo-release1-persistence.json');
  const endBackupPath = path.join(os.tmpdir(), 'queuezerotwo-release1-end-backup.json');
  const finishedBackupPath = path.join(os.tmpdir(), 'queuezerotwo-release1-finished-backup.json');
  const hostilePath = path.join(os.tmpdir(), 'queuezerotwo-hostile-backup.json');

  try {
    await sp.goto(APP,{waitUntil:'networkidle'});
    // Release 2: identity-free viewer positions, privacy names, rough wait estimates, and compact snapshots.
    const viewerCheck = await sp.evaluate(() => {
      S=mk();
      S.queue=['Mike Reyes','Mike Rivera','Ana Lopez','Bob Chen','Cara Diaz','Dan Reed','Eli Moss','Fay Cruz'];
      S.log=[
        {p:['Mike Reyes','Ana Lopez','Bob Chen','Cara Diaz'],s:[11,9],w:0,c:'Court 1',tg:11,t:1,d:240000},
        {p:['Mike Rivera','Dan Reed','Eli Moss','Fay Cruz'],s:[9,11],w:1,c:'Court 2',tg:11,t:2,d:240000},
        {p:['Mike Reyes','Mike Rivera','Dan Reed','Eli Moss'],s:[11,8],w:0,c:'Court 1',tg:11,t:3,d:240000}
      ];
      const nameMap=displayNameMap([S.queue,S.log.flatMap(x=>x.p)]);
      return {m1:safePlayerName('Mike Reyes',nameMap),m2:safePlayerName('Mike Rivera',nameMap),a:safePlayerName('Ana Lopez',nameMap),tm:timingMeta()};
    });
    assert.equal(viewerCheck.m1,'Mike R.');
    assert.equal(viewerCheck.m2,'Mike R.');
    assert.equal(viewerCheck.a,'Ana');
    assert.ok(viewerCheck.tm&&viewerCheck.tm.a>=240000);

    const viewerWinByCheck=await sp.evaluate(()=>{
      const oldS=S,oldSV=SV,oldV=V,oldRA=RA;
      S=mk();S.wb=2;V=null;RA=null;
      SV={code:'R2WINBY001',d:{t:11,wb:1,courts:[{n:'Court 1',a:true,p:['Ana','Ben','Cara','Dan'],s:[11,10]}],nx:[],q:[],lb:[]},status:'SUBSCRIBED'};
      renderSession();
      const winByOne=[...document.querySelectorAll('#viewer span.font-sport')].map(el=>el.classList.contains('text-pickle-500'));
      SV.d.wb=2;renderSession();
      const winByTwo=[...document.querySelectorAll('#viewer span.font-sport')].map(el=>el.classList.contains('text-pickle-500'));
      S=oldS;SV=oldSV;V=oldV;RA=oldRA;render();
      return {winByOne,winByTwo};
    });
    assert.deepEqual(viewerWinByCheck.winByOne,[true,false],'win-by-1 viewer uses the host setting even if local preference differs');
    assert.deepEqual(viewerWinByCheck.winByTwo,[false,false],'win-by-2 viewer does not mark 11-10 as a win');

    await sp.evaluate(() => {
      S=mk();
      S.queue=['Mike Reyes','Mike Rivera','Ana Lopez','Bob Chen','Cara Diaz','Dan Reed','Eli Moss','Fay Cruz'];
      SV={code:'R2VIEWER01',d:{t:11,courts:[{n:'Court 1',a:true,p:['Mike Reyes','Ana Lopez','Bob Chen','Cara Diaz'],s:[5,3]}],nx:['Mike Reyes','Mike Rivera','Ana Lopez','Bob Chen'],up:[{n:'Mike Reyes',p:1},{n:'Mike Rivera',p:2},{n:'Ana Lopez',p:3},{n:'Bob Chen',p:4}],q:S.queue,lb:[{n:'Mike Reyes',w:2,l:0,d:8},{n:'Mike Rivera',w:1,l:1,d:0}],tm:{a:240000}},status:'SUBSCRIBED'};
      V=null;RA=null;render();
    });
    const liveViewerText=await sp.locator('#viewer').innerText();
    assert.match(liveViewerText,/#1/);
    assert.match(liveViewerText,/#8/);
    assert.match(liveViewerText,/about 4 min/);
    assert.match(liveViewerText,/Mike R\./);
    assert.doesNotMatch(liveViewerText,/Reyes|Rivera|Lopez|Chen|Diaz/);

    // The publish contract is exercised against payloads built by the real client helpers.
    const clientPayloadContract=await sp.evaluate(async()=>{
      const oldS=S,oldSV=SV,oldV=V,oldRA=RA,oldStored=localStorage.getItem(K);
      S=mk();
      const names=['Ari | 東京 🌱','Mika Café|星','Noah | 🥒','Zoë 北'];
      S.queue=names.slice(0,1);
      S.lv={'ari | 東京 🌱':4,'mika café|星':3,'noah | 🥒':2,'zoë 北':5};
      const empty=await sdata();
      S.queue=names.slice();
      const populated=await sdata();
      const allNames=Array.from({length:200},(_,i)=>String(i+1).padStart(3,'0')+'|東京🌱');
      S.log=Array.from({length:500},(_,i)=>({
        p:[allNames[(i*4)%200],allNames[(i*4+1)%200],allNames[(i*4+2)%200],allNames[(i*4+3)%200]],
        s:[11,9],w:0,c:'Court '+(i%8+1),tg:11,t:1760000000000+i,d:600000
      }));
      const results=resultsSnapshot(),bytes=new Blob([JSON.stringify(results)]).size;
      if(oldStored===null)localStorage.removeItem(K);else localStorage.setItem(K,oldStored);
      S=oldS;SV=oldSV;V=oldV;RA=oldRA;render();
      return {
        empty,
        populated,
        results:{players:results.leaderboard.length,games:results.matches.length,bytes,hasPipe:results.matches.some(m=>m.p.some(n=>n.includes('|'))),hasUnicode:results.matches.some(m=>m.p.some(n=>n.includes('東京')))},
        levelDataPublished:Object.hasOwn(populated,'lv')
      };
    });
    assert.equal(clientPayloadContract.empty.tm,null);
    assert.deepEqual(clientPayloadContract.empty.nx,[]);
    assert.deepEqual(clientPayloadContract.empty.up,[]);
    assert.ok(clientPayloadContract.empty.courts.every(c=>Array.isArray(c.p)&&c.p.length===0));
    assert.equal(clientPayloadContract.populated.tm,null);
    assert.equal(clientPayloadContract.populated.nx.length,4);
    assert.equal(clientPayloadContract.populated.up.length,4);
    assert.equal(clientPayloadContract.populated.q[0],'Ari | 東京 🌱');
    assert.equal(clientPayloadContract.levelDataPublished,false,'skill ratings stay local and do not change the publish payload contract');
    assert.equal(clientPayloadContract.results.players,200);
    assert.equal(clientPayloadContract.results.games,500);
    assert.ok(clientPayloadContract.results.bytes<200000);
    assert.equal(clientPayloadContract.results.hasPipe,true);
    assert.equal(clientPayloadContract.results.hasUnicode,true);

    // The database broadcasts data:null when an expired live session is deleted.
    // Exercise the exact callback registered on session_update and keep the last view intact.
    const nullBroadcastCheck = await sp.evaluate(() => {
      const oldData = JSON.stringify(SV.d);
      const oldHtml = document.getElementById('viewer').innerHTML;
      const accepted = applyLiveSessionBroadcast({
        payload: {
          code: SV.code,
          data: null,
          updated_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
        },
      });
      return {
        accepted,
        stateUnchanged: JSON.stringify(SV.d) === oldData,
        markupUnchanged: document.getElementById('viewer').innerHTML === oldHtml,
      };
    });
    assert.equal(nullBroadcastCheck.accepted, false, 'a null-data broadcast is ignored');
    assert.equal(nullBroadcastCheck.stateUnchanged, true, 'the viewer retains its previous session payload');
    assert.equal(nullBroadcastCheck.markupUnchanged, true, 'the viewer keeps rendering the previous state');

    await sp.evaluate(() => {
      RA={code:'R2RESULT01',d:{v:1,name:'Saturday open play',totals:{players:4,games:1,courts:1,playTo:11,winBy:2},leaderboard:[{n:'Mike R.',w:1,l:0,d:2},{n:'Ana',w:0,l:1,d:-2}],matches:[{c:'Court 1',p:['Mike R.','Ana','Bob','Cara'],s:[11,9],w:0,tg:11,t:1,d:240000}]}};
      SV=null;V=null;render();
    });
    const archivedText=await sp.locator('#viewer').innerText();
    assert.match(archivedText,/Saturday open play/);
    assert.match(archivedText,/READ-ONLY/);
    assert.doesNotMatch(archivedText,/R2VIEWER01|PERSISTEDSID/);

    const maliciousName='<img src=x onerror=alert(1)>';
    await sp.evaluate((maliciousName) => {
      RA={code:'R2RESULT02',d:{
        v:1,name:'Hostile name test',
        totals:{players:1,games:1,courts:1,playTo:11,winBy:2},
        leaderboard:[{n:maliciousName,w:1,l:0,d:2}],
        matches:[{c:'Court 1',p:[maliciousName,'Ana','Bob','Cara'],s:[11,9],w:0,tg:11,t:1,d:240000}]
      }};
      SV=null;V=null;render();
    },maliciousName);
    const hostileResultText=await sp.locator('#viewer').innerText();
    assert.match(hostileResultText,/Hostile name test/);
    assert.match(hostileResultText,/&lt;img|<img src=x onerror=alert\(1\)>/);
    assert.equal(await sp.locator('#viewer img').count(),0);

    await sp.evaluate(() => {
      S=mk();
      S.log=Array.from({length:100},(_,i)=>({p:[i%2?'Mike Reyes':'Mike Rivera','Player'+((i*3)%38+1),'Player'+((i*5)%38+1),'Player'+((i*7)%38+1)],s:[11,9],w:0,c:'Court '+(i%4+1),tg:11,t:i,d:240000}));
      S.queue=[];
      const p=resultsSnapshot();
      window.__r2size={bytes:new Blob([JSON.stringify(p)]).size,players:p.totals.players,games:p.totals.games,hasMike:p.leaderboard.some(x=>x.n==='Mike R.')};
    });
    const snapSize=await sp.evaluate(()=>window.__r2size);
    assert.ok(snapSize.bytes<200000);
    assert.equal(snapSize.games,100);
    assert.equal(snapSize.hasMike,true);

    // Cold-cache archived results page loads through the read-only results endpoint.
    // Exercise the client renderer with hostile text in both name and numeric fields.
    // The numeric strings must normalize to zero, never become HTML, even when the
    // server-side RPC guard is bypassed by this mocked GET response.
    const hostileResultsName='<img/src=x/onerror=alert(1)>',hostileNumeric='<svg/onload=alert(2)>';
    const xssFailures=[];
    const xssCheck=(pass,message)=>{if(!pass)xssFailures.push(message)};

    // #r=: archived-results client rendering, with the database publish guard bypassed.
    const coldContext=await browser.newContext({...devices['Desktop Chrome'],serviceWorkers:'allow',locale:'en-US'});
    await coldContext.route(SUPABASE+'/**',route=>{
      const u=new URL(route.request().url());
      if(u.pathname.endsWith('/rest/v1/pickle_results')&&route.request().method()==='GET'){
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{data:{v:1,name:'Cold cache results',totals:{players:hostileNumeric,games:hostileNumeric,courts:hostileNumeric},leaderboard:[{n:hostileResultsName,w:hostileNumeric,l:hostileNumeric,d:hostileNumeric}],matches:[{c:'Court 1',p:[hostileResultsName,'Bob','Cara','Dan'],s:[hostileNumeric,hostileNumeric],w:0}]},created_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString()}])});
      }
      return route.abort();
    });
    const coldPage=await coldContext.newPage();
    let coldAlerts=0;
    coldPage.on('dialog',async dialog=>{coldAlerts++;await dialog.dismiss()});
    await coldPage.goto(APP+'#r=COLDRESULT1',{waitUntil:'networkidle'});
    await coldPage.getByText('Cold cache results',{exact:true}).waitFor({state:'visible',timeout:5000});
    await coldPage.getByText('READ-ONLY',{exact:true}).waitFor({state:'visible',timeout:5000});
    const coldText=await coldPage.locator('#viewer').innerText();
    const coldNodes=await coldPage.locator('#viewer').evaluate(el=>({
      img:el.querySelectorAll('img').length,
      svg:el.querySelectorAll('svg').length,
      script:el.querySelectorAll('script').length
    }));
    xssCheck(coldAlerts===0,'#r= fired a JavaScript dialog');
    xssCheck(coldNodes.img===0&&coldNodes.svg===0&&coldNodes.script===0,'#r= viewer contains an injected img, svg, or script element: '+JSON.stringify(coldNodes));
    xssCheck(coldText.includes(hostileResultsName),'#r= hostile player name was not displayed as literal text');
    xssCheck(!coldText.includes(hostileNumeric),'#r= hostile numeric strings were not normalized to zero');
    xssCheck(/0 players · 0 games · 0 courts/.test(coldText),'#r= totals.players/games did not normalize to zero');
    xssCheck(/0 games played · 0% win rate/.test(coldText)&&/Point difference 0/.test(coldText),'#r= leaderboard w/l/d did not normalize to zero');
    xssCheck(/0-0/.test(coldText),'#r= archived match score did not normalize to zero');
    await coldContext.close();

    // #s=: Live View client rendering, independent of the database publish guard.
    const liveContext=await browser.newContext({...devices['Desktop Chrome'],serviceWorkers:'block',locale:'en-US'});
    const hostileName='<img/src/onerror=alert(1)>';
    const hostileLiveScore='<img src=x onerror=alert(1)>';
    const hostileLiveEvent='<svg/onload=alert(2)>';
    const livePayload={q:[],t:11,lb:[],nx:[],tm:null,up:[],wb:2,courts:[{a:true,n:'Court 1',p:[hostileName,'Bob','Cara','Dan'],s:[hostileLiveScore,9]},{a:true,n:'Court 2',p:[hostileLiveEvent,'Eve','Fox','Gray'],s:[7,5]}]};
    await liveContext.route(SUPABASE+'/**',route=>{
      const u=new URL(route.request().url());
      if(u.pathname.endsWith('/rest/v1/live_sessions')&&route.request().method()==='GET'){
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{code:'SAFELIVE01',data:livePayload,updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()}])});
      }
      return route.abort();
    });
    const livePage=await liveContext.newPage();
    const liveDialogs=[];
    livePage.on('dialog',async dialog=>{liveDialogs.push(dialog.message());await dialog.dismiss()});
    await livePage.goto(APP+'#s=NYXSSBASE2',{waitUntil:'domcontentloaded'});
    await livePage.getByRole('heading',{name:'Live Session'}).waitFor({state:'visible',timeout:10000});
    await livePage.waitForFunction(()=>document.querySelector('#viewer')?.innerText.includes('Cara & Dan')&&document.querySelector('#viewer')?.innerText.includes('9'),null,{timeout:10000});
    await livePage.waitForFunction(()=>{const images=[...document.querySelectorAll('#viewer img')];return images.length===0||images.every(image=>image.complete)},null,{timeout:5000});
    await livePage.waitForTimeout(50);
    const nyxssViewer=await livePage.locator('#viewer').evaluate(el=>({
      text:el.innerText,
      images:el.querySelectorAll('img').length,
      imageDetails:[...el.querySelectorAll('img')].map(image=>({html:image.outerHTML,complete:image.complete,naturalWidth:image.naturalWidth,onerrorType:typeof image.onerror})),
      svgs:el.querySelectorAll('svg').length,
      scripts:el.querySelectorAll('script').length
    }));
    console.log('[NYXSSBASE2 viewer DOM check] '+JSON.stringify({...nyxssViewer,dialogs:liveDialogs}));
    xssCheck(liveDialogs.length===0,'#s= NYXSSBASE2 fired a JavaScript dialog: '+JSON.stringify(liveDialogs));
    xssCheck(nyxssViewer.images===0&&nyxssViewer.svgs===0&&nyxssViewer.scripts===0,'#s= NYXSSBASE2 viewer contains an injected img, svg, or script element: '+JSON.stringify(nyxssViewer));
    xssCheck(nyxssViewer.text.includes(hostileName),'#s= hostile player name was not displayed as literal text');
    xssCheck(nyxssViewer.text.includes(hostileLiveEvent+' & Eve\n7\nFox & Gray\n5'),'#s= hostile SVG player name was not displayed as literal text');
    xssCheck(!nyxssViewer.text.includes(hostileLiveScore),'#s= hostile score was not normalized to zero');
    xssCheck(nyxssViewer.text.includes(hostileName+' & Bob\n0\nCara & Dan\n9'),'#s= hostile player name and hostile score did not render as literal text and zero');
    await liveContext.close();

    assert.deepEqual(xssFailures,[],'Client-side viewer XSS checks failed:\n'+xssFailures.join('\n'));

    // Results codes are crypto-random 10-character strings from the full 32-character alphabet.
    const codeCheck=await sp.evaluate(() => ({
      source:randResultCode.toString(),
      alphabet:LIVE_ALPH,
      samples:Array.from({length:200},() => randResultCode())
    }));
    assert.match(codeCheck.source,/crypto\.getRandomValues/);
    assert.match(codeCheck.source,/LIVE_ALPH/);
    assert.equal(codeCheck.alphabet,'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    assert.equal(codeCheck.samples.every(x=>new RegExp('^['+codeCheck.alphabet+']{10}$').test(x)),true);
    // Release 1: three offline state snapshots for one host coalesce to the newest
    // durable item, then reconnect sends exactly one RPC with the highest sequence.
    await setupFour(sp);
    await sp.evaluate(async () => {
      if ('serviceWorker' in navigator) await navigator.serviceWorker.ready;
    });
    await sp.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {timeout: 5000});
    await sp.evaluate(() => document.getElementById('nvs')?.click());
    await sleep(700);
    syncPublishes.length = 0;
    await sync.setOffline(true);
    await sp.locator('#go').click();
    await sp.evaluate(() => document.getElementById('nvp')?.click());
    const offlineStateBatch = await sp.evaluate(async () => {
      if (st) { clearTimeout(st); st = null; }
      PQ = [];
      PQS = 0;
      savePublishQueue();
      const seqs = [];
      for (let i = 0; i < 3; i++) {
        S.courts[0].score = [i + 1, 4];
        const payload = await sdata();
        if (!queuePublishPayload(payload, S.sid, S.sh, 'state')) {
          throw new Error('Offline state snapshot was not queued');
        }
        seqs.push(payload.seq);
      }
      const items = JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1') || '{"items":[]}').items;
      return {
        online: navigator.onLine,
        seqs,
        liveSeq: S.liveSeq,
        queueLength: items.length,
        queued: items.map(x => ({seq:x.payload?.seq,score:x.payload?.courts?.find(c => c.a)?.s?.[0]}))
      };
    });
    assert.equal(offlineStateBatch.online, false);
    assert.equal(offlineStateBatch.queueLength, 1, 'Three offline state snapshots leave one pending item');
    assert.deepEqual(offlineStateBatch.seqs, [...offlineStateBatch.seqs].sort((a,b)=>a-b));
    assert.equal(offlineStateBatch.seqs.length, 3);
    assert.equal(offlineStateBatch.liveSeq, offlineStateBatch.seqs[2]);
    assert.deepEqual(offlineStateBatch.queued, [{seq:offlineStateBatch.seqs[2],score:3}],
      'The newest full-state snapshot replaces the two older pending snapshots');
    assert.match(await sp.locator('#ct').innerText(), /Offline/);
    await sync.setOffline(false);
    await sp.waitForFunction(
      () => JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items.length === 0,
      null,
      {timeout:5000},
    );
    assert.match(await sp.locator('#ct').innerText(), /Saved on this device/);
    assert.equal(syncPublishes.length, 1, 'Reconnect sends exactly one state RPC after three offline snapshots');
    assert.equal(syncPublishes[0].p_payload.seq, offlineStateBatch.seqs[2],
      'The one reconnect RPC carries the highest persisted sequence');
    assert.equal((syncPublishes[0].p_payload.courts||[]).find(v => v.a)?.s?.[0], 3,
      'The one reconnect RPC carries the newest score');
    
    // Expired active sessions return the same combined RPC error. Without a
    // recent local handoff, rotate the identity and retry rather than retrying forever.
    await sp.evaluate(()=>{
      const oldSid='EXPIRED01',oldSh='e'.repeat(64);
      S.ho=false;S.hoff=0;S.ended=false;S.sid=oldSid;S.sh=oldSh;S.lpf=false;
      PQ=[{id:'expired-host-entry-98',seq:98,sid:oldSid,sh:oldSh,kind:'state',attempts:0,lastError:'',payload:{t:11,wb:2,courts:[],nx:[],up:[],tm:null,q:[],lb:[]}}];
      PQS=98;savePublishQueue();clearTimeout(PQRetry);PQRetry=null;
      window.__expiredSessionRpcCalls=[];
      sb.rpc=async(name,args)=>{
        window.__expiredSessionRpcCalls.push({name,code:args.p_code,key:args.p_host_key});
        if(args.p_code===oldSid)return {error:new Error('Invalid host key or expired session.')};
        return {data:true,error:null};
      };
    });
    await sp.evaluate(()=>flushPublishQueue());
    const expiredRecovery=await sp.evaluate(()=>({
      sid:S.sid,sh:S.sh,queueLength:PQ.length,
      calls:window.__expiredSessionRpcCalls.slice(),
      notice:[...document.querySelectorAll('#msg .mb')].map(x=>x.textContent).find(x=>/previous Live View expired/i.test(x))||''
    }));
    assert.notEqual(expiredRecovery.sid,'EXPIRED01','Expired session recovery creates a new Live View code');
    assert.match(expiredRecovery.sid,/^[A-Z2-9]{10}$/);
    assert.notEqual(expiredRecovery.sh,'e'.repeat(64),'Expired session recovery creates a new host key');
    assert.equal(expiredRecovery.queueLength,0,'A successfully recovered expired publish leaves no queued item');
    assert.equal(expiredRecovery.calls.length,2,'The expired code is attempted once, followed by one fresh-session retry');
    assert.equal(expiredRecovery.calls[0].code,'EXPIRED01');
    assert.equal(expiredRecovery.calls[1].code,expiredRecovery.sid);
    assert.equal(expiredRecovery.calls[1].key,expiredRecovery.sh);
    assert.match(expiredRecovery.notice,/new link is ready to share/i);

    // Regression: the server intentionally folds a stale host-key rejection into the
    // message "Invalid host key or expired session". A recent local handoff must demote
    // the old host rather than creating a replacement session.
    await sp.evaluate(() => {
      const oldSid='OLDHANDOFF',oldSh='a'.repeat(64);
      S.sid=oldSid;S.sh=oldSh;S.ho=false;S.hoff=Date.now();
      PQ=[{id:'old-host-entry-99',seq:99,sid:oldSid,sh:oldSh,kind:'state',attempts:1,lastError:'',payload:{t:11,wb:2,courts:[],nx:[],up:[],tm:null,q:[],lb:[]}}];
      PQS=99;savePublishQueue();clearTimeout(PQRetry);PQRetry=null;
      window.__handoffRpcCalls=[];
      sb.rpc=async(name,args)=>{
        if(name!=='publish_pickle_session')return {error:new Error('Unexpected RPC '+name)};
        window.__handoffRpcCalls.push({isOldCode:args.p_code===oldSid,isOldHostKey:args.p_host_key===oldSh});
        if(args.p_code===oldSid&&args.p_host_key===oldSh)return {error:new Error('Invalid host key or expired session.')};
        return {data:true,error:null};
      };
      syncMarker();
    });
    await sp.evaluate(() => flushPublishQueue());
    const staleHostResult=await sp.evaluate(()=>({
      demoted:S.ho===true,
      sessionCleared:!S.sid&&!S.sh,
      queueLength:JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items.length,
      status:document.getElementById('ct')?.textContent||'',
      rpcCalls:window.__handoffRpcCalls.slice()
    }));
    assert.equal(staleHostResult.demoted,true,'the previous host is demoted after the server rejects its old key');
    assert.equal(staleHostResult.sessionCleared,true,'the previous host no longer owns a live identity');
    assert.equal(staleHostResult.queueLength,0,'stale writes are removed after handoff');
    assert.match(staleHostResult.status,/No longer host/);
    assert.equal(staleHostResult.rpcCalls.length,1,'a rejected old host key must not create a replacement session');
    assert.deepEqual(staleHostResult.rpcCalls[0],{isOldCode:true,isOldHostKey:true});

    // Regression: after demotion, starting a fresh session clears the old marker and queued writes.
    await sp.evaluate(() => {
      S.ended = true;
      S.name = 'Demoted host fresh session';
      S.rid = '';
      S.rr = false;
      S.lr = false;
      PQ = [{id:'stale-session-entry-101',seq:101,sid:'STALESESSION',sh:'c'.repeat(64),kind:'state',attempts:0,lastError:'',payload:{t:11,wb:2,courts:[],nx:[],up:[],tm:null,q:[],lb:[]}}];
      PQS = 101;
      savePublishQueue();
      window.__freshSessionPublish = null;
      sb.rpc = async (name,args) => {
        if (name === 'publish_pickle_session') {
          window.__freshSessionPublish = {name,args};
          return {data:true,error:null};
        }
        return {data:'R2RES1234',error:null};
      };
      showRes();
    });
    await sp.locator('[role="dialog"] .nw').click();
    await sp.getByRole('button',{name:'Confirm'}).click();
    await sp.waitForFunction(() => !S.ended && S.ho !== true);
    assert.doesNotMatch(await sp.locator('#ct').innerText(), /No longer host/);
    await sp.locator('button[onclick="live()"]').click();
    await sp.waitForFunction(() => !!window.__freshSessionPublish);
    const freshPublish = await sp.evaluate(() => ({
      ...window.__freshSessionPublish,
      sid:S.sid,
      sh:S.sh,
      staleQueue:JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items
        .some(x=>x.sid==='STALESESSION'||x.sh==='c'.repeat(64))
    }));
    assert.equal(freshPublish.name,'publish_pickle_session');
    assert.equal(freshPublish.args.p_code,freshPublish.sid);
    assert.equal(freshPublish.args.p_host_key,freshPublish.sh);
    assert.notEqual(freshPublish.args.p_code,'STALESESSION');
    assert.notEqual(freshPublish.args.p_host_key,'c'.repeat(64));
    assert.equal(freshPublish.staleQueue,false);
    assert.doesNotMatch(await sp.locator('#ct').innerText(), /No longer host/);

    // Regression: an old in-flight publish failure must not poison or stall a fresh session.
    await sp.locator('[role="dialog"] [data-x]').click();
    await sp.evaluate(() => {
      S = mk();
      S.ended = true;
      S.name = 'Old in-flight session';
      S.sid = 'OLDINFLIGHT';
      S.sh = 'd'.repeat(64);
      S.ho = false;
      S.hoff = Date.now();
      window.__oldPublishStarted = false;
      window.__resolveOldPublish = null;
      window.__freshWrites = [];
      sb.rpc = (name,args) => {
        if (name === 'publish_pickle_session' && args.p_code === 'OLDINFLIGHT') {
          window.__oldPublishStarted = true;
          return new Promise(resolve => {
            window.__resolveOldPublish = () => resolve({data:null,error:new Error('Server unavailable.')});
          });
        }
        if (name === 'publish_pickle_session') window.__freshWrites.push(args.p_code);
        return Promise.resolve({data:true,error:null});
      };
      PQ = [{id:'old-inflight-entry-150',seq:150,sid:S.sid,sh:S.sh,kind:'state',attempts:2,lastError:'',payload:{t:11,wb:2,courts:[],nx:[],up:[],tm:null,q:[],lb:[]}}];
      PQS = 150;
      savePublishQueue();
      void flushPublishQueue();
      showRes();
    });
    await sp.waitForFunction(() => window.__oldPublishStarted === true);
    await sp.locator('[role="dialog"] .nw').click();
    await sp.getByRole('button',{name:'Confirm'}).click();
    await sp.waitForFunction(() => !S.ended && S.ho !== true);
    const freshIdentity = await sp.evaluate(async () => {
      clearTimeout(st);
      ensureLiveIdentity();
      const identity = {sid:S.sid,sh:S.sh,oldEntryId:'old-inflight-entry-150'};
      queuePublishPayload(await sdata(),S.sid,S.sh);
      return {...identity,freshEntryId:PQ[0]?.id,freshEntryPosition:PQ.findIndex(x=>x.sid===S.sid&&x.sh===S.sh)};
    });
    assert.notEqual(freshIdentity.sid,'OLDINFLIGHT');
    assert.ok(freshIdentity.freshEntryId);
    assert.notEqual(freshIdentity.freshEntryId,freshIdentity.oldEntryId);
    assert.equal(freshIdentity.freshEntryPosition,0,'the fresh entry occupies the old request\'s former queue position');
    await sp.evaluate(() => window.__resolveOldPublish());
    await sp.waitForFunction(() => PQ.length === 0, null, {timeout:5000});
    const staleCompletion = await sp.evaluate(() => ({
      host:S.ho,
      marker:document.getElementById('ct').textContent,
      oldStillQueued:PQ.some(x=>x.sid==='OLDINFLIGHT'),
      freshWrites:window.__freshWrites.slice(),
      sid:S.sid,
      sh:S.sh
    }));
    assert.equal(staleCompletion.host,false);
    assert.doesNotMatch(staleCompletion.marker,/Sync stuck|No longer host/);
    assert.equal(staleCompletion.oldStillQueued,false);
    assert.ok(staleCompletion.freshWrites.includes(staleCompletion.sid));
    assert.equal(staleCompletion.marker,'Saved on this device');

    // Release 1 edge case: repeated non-network failures are visibly marked as stuck,
    // while still retaining the queue for a later recovery.
    await sp.evaluate(() => {
      const sid='STUCKSYNC',sh='b'.repeat(64);
      S.ho=false;S.sid=sid;S.sh=sh;S.hoff=0;
      PQ=[{id:'stuck-entry-100',seq:100,sid,sh,kind:'state',attempts:2,lastError:'',payload:{t:11,wb:2,courts:[],nx:[],up:[],tm:null,q:[],lb:[]}}];
      PQS=100;savePublishQueue();clearTimeout(PQRetry);PQRetry=null;
      sb.rpc=async()=>({error:new Error('Server unavailable.')});
      syncMarker();
    });
    await sp.evaluate(() => flushPublishQueue());
    assert.equal(await sp.evaluate(() => JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items[0].attempts), 3);
    assert.equal(await sp.evaluate(() => PQ.length), 1);
    assert.match(await sp.locator('#ct').innerText(), /Sync stuck/);
    await sp.evaluate(() => {clearTimeout(PQRetry);PQRetry=null});

    // Deterministic rejection-state regression tests run in a dedicated 1280px desktop profile.
    const queueContext=await freshContext(browser,devices['Desktop Chrome']);
    const queuePage=await queueContext.newPage();
    await setupFour(queuePage);
    assert.equal(await queuePage.evaluate(()=>innerWidth),1280,'queue failure regression runs at desktop width');

    const startupGuards=await queuePage.evaluate(()=>{
      const previous={S,V,SV,RA,pushS};
      let calls=0;
      pushS=()=>{calls++};
      const check=(patch,navigationType='reload')=>{
        S=Object.assign(mk(),{sid:'STARTUP01',sh:'f'.repeat(64),ended:false,ho:false},patch);
        return resumeHostStateOnStartup({type:navigationType})
      };
      const ended=check({ended:true});
      const handedOff=check({ho:true});
      const missingSid=check({sid:''});
      const missingHostKey=check({sh:''});
      const newTab=check({},'navigate');
      const normalReload=check({},'reload');
      const count=calls;
      S=previous.S;V=previous.V;SV=previous.SV;RA=previous.RA;pushS=previous.pushS;
      return {ended,handedOff,missingSid,missingHostKey,newTab,normalReload,count};
    });
    assert.equal(startupGuards.ended,false,'Ended sessions never auto-publish on startup');
    assert.equal(startupGuards.handedOff,false,'A host that handed off never auto-publishes on startup');
    assert.equal(startupGuards.missingSid,false,'An imported backup without a session ID never auto-publishes');
    assert.equal(startupGuards.missingHostKey,false,'A session without a host key never auto-publishes');
    assert.equal(startupGuards.newTab,false,'A newly opened host tab does not auto-publish a competing snapshot');
    assert.equal(startupGuards.normalReload,true,'An active owned session resumes publishing after a reload');
    assert.equal(startupGuards.count,1,'Only an active owned reload schedules startup publishing');

    await queuePage.evaluate(() => {
      const sid='VALIDATIONQ1',sh='d'.repeat(64);
      S.ho=false;S.sid=sid;S.sh=sh;S.hoff=0;S.ended=false;S.lpf=false;S.rpf=false;
      PublishRejected='';PublishRejectedNotified.clear();
      PQ=[
        {id:'invalid-live-101',seq:101,sid,sh,kind:'state',attempts:0,lastError:'',payload:{testTag:'bad-live-a'}},
        {id:'invalid-live-102',seq:102,sid,sh,kind:'state',attempts:0,lastError:'',payload:{testTag:'bad-live-b'}}
      ];
      PQS=102;savePublishQueue();clearTimeout(PQRetry);PQRetry=null;
      window.__validationQueueCalls=[];
      sb.rpc=async(name,args)=>{
        const tag=args.p_payload?.testTag;
        window.__validationQueueCalls.push({name,tag});
        if(tag==='bad-live-a'||tag==='bad-live-b')return {error:new Error('Invalid Live View payload values.')};
        return {data:true,error:null};
      };
      syncMarker();
    });
    await queuePage.evaluate(() => flushPublishQueue());
    const liveRejected=await queuePage.evaluate(()=>({
      queue:JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items,
      calls:window.__validationQueueCalls.slice(),
      notices:[...document.querySelectorAll('#msg .mb')].map(x=>x.textContent).filter(x=>/Live View update was rejected/i.test(x)),
      status:document.getElementById('ct').textContent,
      icon:document.getElementById('ci').className,
      rejected:PublishRejected,lpf:S.lpf
    }));
    assert.equal(liveRejected.queue.length,0,'both deterministic Live View failures are dropped');
    assert.deepEqual(liveRejected.calls,[
      {name:'publish_pickle_session',tag:'bad-live-a'},
      {name:'publish_pickle_session',tag:'bad-live-b'}
    ]);
    assert.equal(liveRejected.notices.length,1,'repeated state rejections produce only one toast per failure type');
    assert.match(liveRejected.status,/Live View rejected · saved here/);
    assert.match(liveRejected.icon,/text-red-500/);
    assert.equal(liveRejected.rejected,'live');
    assert.equal(liveRejected.lpf,true);

    // A successful publish clears the Live View error marker and re-arms one notice for the next failure.
    await queuePage.evaluate(() => {
      PQ=[{id:'valid-live-103',seq:103,sid:S.sid,sh:S.sh,kind:'state',attempts:0,lastError:'',payload:{testTag:'valid-live'}}];
      PQS=103;savePublishQueue();
      sb.rpc=async()=>({data:true,error:null});
    });
    await queuePage.evaluate(() => flushPublishQueue());
    const liveRecovered=await queuePage.evaluate(()=>({
      status:document.getElementById('ct').textContent,
      rejected:PublishRejected,lpf:S.lpf,queue:PQ.length
    }));
    assert.equal(liveRecovered.queue,0);
    assert.equal(liveRecovered.lpf,false);
    assert.equal(liveRecovered.rejected,'');
    assert.match(liveRecovered.status,/Saved on this device/);

    // Results rejection is distinct: keep the local session and replace the impossible
    // "will appear when sync completes" copy with a truthful failure message.
    await queuePage.evaluate(() => {
      S.ended=true;S.rr=false;S.lr=false;S.rpf=false;S.rid='RESULTQ102';
      PQ=[
        {id:'invalid-results-102',seq:104,sid:S.sid,sh:S.sh,kind:'results',rid:'RESULTQ102',attempts:0,lastError:'',payload:{testTag:'bad-results-a'}},
        {id:'invalid-results-103',seq:105,sid:S.sid,sh:S.sh,kind:'results',rid:'RESULTQ103',attempts:0,lastError:'',payload:{testTag:'bad-results-b'}}
      ];
      PQS=105;savePublishQueue();
      sb.rpc=async(name,args)=>{
        const tag=args.p_payload?.testTag;
        window.__validationQueueCalls.push({name,tag});
        if(tag==='bad-results-a'||tag==='bad-results-b')return {error:new Error('Invalid results match values.')};
        return {data:'GOODRES123',error:null};
      };
    });
    await queuePage.evaluate(() => flushPublishQueue());
    const resultsRejected=await queuePage.evaluate(()=>({
      queue:PQ.length,
      notices:[...document.querySelectorAll('#msg .mb')].map(x=>x.textContent).filter(x=>/Results couldn't be published/i.test(x)),
      status:document.getElementById('ct').textContent,
      rejected:PublishRejected,rpf:S.rpf,rr:S.rr,
      dialog:document.querySelector('[role="dialog"]')?.innerText||''
    }));
    assert.equal(resultsRejected.queue,0,'both invalid results items are dropped');
    assert.equal(resultsRejected.notices.length,1,'repeated results rejections produce one toast per failure type');
    assert.match(resultsRejected.notices[0],/Results couldn't be published\. Your session is saved on this device\./);
    assert.match(resultsRejected.status,/Results not published · saved here/);
    assert.equal(resultsRejected.rejected,'results');
    assert.equal(resultsRejected.rpf,true);
    assert.equal(resultsRejected.rr,false);
    assert.match(resultsRejected.dialog,/Results link couldn't be published\. Your session is saved on this device\./);
    assert.doesNotMatch(resultsRejected.dialog,/Results link will appear when sync completes/);

    // A successful results publish restores the link and clears the durable results-failure state.
    await queuePage.evaluate(() => {
      PQ=[{id:'valid-results-104',seq:106,sid:S.sid,sh:S.sh,kind:'results',rid:'RESULTQ102',attempts:0,lastError:'',payload:{testTag:'valid-results'}}];
      PQS=106;savePublishQueue();
    });
    await queuePage.evaluate(() => flushPublishQueue());
    const resultsRecovered=await queuePage.evaluate(()=>({
      status:document.getElementById('ct').textContent,
      rejected:PublishRejected,rpf:S.rpf,rr:S.rr,rid:S.rid,queue:PQ.length,
      dialog:document.querySelector('[role="dialog"]')?.innerText||''
    }));
    assert.equal(resultsRecovered.queue,0);
    assert.equal(resultsRecovered.rpf,false);
    assert.equal(resultsRecovered.rr,true);
    assert.equal(resultsRecovered.rid,'GOODRES123');
    assert.equal(resultsRecovered.rejected,'');
    assert.match(resultsRecovered.status,/Saved on this device/);
    assert.match(resultsRecovered.dialog,/#r=GOODRES123/);
    await queueContext.close();

    // Release 2: offline End session queues one results snapshot and only exposes its link after publish succeeds.
    await setupFour(sp);
    await sp.evaluate(() => {
      S.name='Offline results test';S.ended=false;S.rr=false;S.lr=false;S.rid='';
      S.ho=false;S.hoff=0;S.sid='';S.sh='';ensureLiveIdentity();persistStateOnly();
      PQ=[];PQS=0;savePublishQueue();render();
    });
    resultPublishes.length=0;
    await sync.setOffline(true);
    await sp.locator('#rs').click();
    const endOfflineDialog=sp.locator('[role="dialog"]');
    await endOfflineDialog.getByRole('button',{name:'Confirm'}).click();
    await sp.waitForFunction(() => {
      const q=JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items;
      return !!q.find(x=>x.kind==='results'&&x.rid&&x.rid.length===10) && S.rr===false;
    },null,{timeout:5000});
    assert.match(await sp.locator('[role="dialog"]').innerText(),/Results link will appear when sync completes/);
    const queuedResult=await sp.evaluate(()=>JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items.find(x=>x.kind==='results'));
    assert.equal(queuedResult.rid.length,10);
    await sync.setOffline(false);
    await sp.waitForFunction(() => S.rr===true && JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items.filter(x=>x.kind==='results').length===0,null,{timeout:5000});
    assert.equal(resultPublishes.length,1);
    assert.equal(resultPublishes[0].p_results_code.length,10);
    const readyUrlText=await sp.locator('[role="dialog"]').innerText();
    assert.match(readyUrlText,/#r=/);
    assert.doesNotMatch(readyUrlText,/PERSISTEDSID/);

    // Release 1 regression: End Session preserves an import-compatible JSON backup payload.
    await dp.goto(APP, {waitUntil: 'networkidle'});
    await dp.locator('#tg').selectOption('15');
    await dp.locator('#wbs').selectOption('1');
    await dp.locator('#ncs').selectOption('6');
    await dp.waitForFunction(() => S.target === 15 && S.wb === 1 && S.courts.length === 6, null, {timeout: 5000});
    const [persistenceDownload] = await Promise.all([
      dp.waitForEvent('download'),
      (await openMenu(dp), dp.locator('#qmenu #exp').click()),
    ]);
    await persistenceDownload.saveAs(persistencePath);
    const persistedBackup = JSON.parse(fs.readFileSync(persistencePath, 'utf8'));
    assert.equal(persistedBackup.state.target, 15);
    assert.equal(persistedBackup.state.wb, 1);
    assert.equal(persistedBackup.state.courts.length, 6);

    const endDialog = dp.locator('[role="dialog"]');
    await dp.locator('#rs').click();
    await endDialog.getByRole('button', {name: 'Confirm'}).click();
    await dp.waitForFunction(() => S.ended === true, null, {timeout: 5000});

    // End Session no longer auto-downloads. Exercise the serializer directly here;
    // the desktop Export button is covered separately by the real-click test above.
    await dp.locator('#sn').waitFor({state:'visible',timeout:10000});
    const endBackupJson = await dp.evaluate(() => expData());
    fs.writeFileSync(endBackupPath,endBackupJson,'utf8');
    const endBackup = JSON.parse(endBackupJson);
    assert.equal(endBackup.app, 'QueueZeroTwo');
    assert.equal(endBackup.version, 1);
    assert.equal(endBackup.state.ended, true);

    // Exercise the intended New session flow to dismiss the locked Results dialog
    // before reusing this desktop page for unrelated queue and scoring fixtures.
    await dp.locator('[role="dialog"]').last().getByRole('button', {name: 'New session'}).click();
    await dp.locator('[role="dialog"]').last().getByRole('button', {name: 'Confirm'}).click();
    await dp.locator('[role="dialog"]').waitFor({state: 'detached'});

    // Restore the manually exported end-session backup to prove it remains compatible with Import.
    await ip.goto(APP, {waitUntil: 'networkidle'});
    await ip.evaluate(() => localStorage.clear());
    await ip.reload({waitUntil: 'networkidle'});
    await ip.locator('#imp').setInputFiles(endBackupPath);
    const restoreDialog = ip.locator('[role="dialog"]');
    assert.match(await restoreDialog.innerText(), /discards any unsent Live View updates/i);
    assert.match(await restoreDialog.innerText(), /Export a backup first/i);
    await restoreDialog.getByRole('button', {name: 'Confirm'}).click();
    await ip.waitForFunction(() => !S.ended && S.target === 15 && S.wb === 1 && S.courts.length === 6, null, {timeout: 5000});
    assert.equal(await ip.locator('#tg').inputValue(), '15');
    assert.equal(await ip.locator('#wbs').inputValue(), '1');
    assert.equal(await ip.locator('#ncs').inputValue(), '6');

    // Mobile: End Session creates the same import-compatible ended-state payload.
    await ip.evaluate(() => { localStorage.clear(); S=mk(); S.ended=false; sb.rpc=async()=>({data:true,error:null}); render(); });
    const mobileEndDialog=ip.locator('[role="dialog"]');
    await ip.locator('#rs').click();
    await mobileEndDialog.getByRole('button', {name: 'Confirm'}).click();
    await ip.locator('#sn').waitFor({state:'visible',timeout:10000});
    const mobileBackupJsonText=await ip.evaluate(() => expData());
    const mobileManualBackupPath=path.join(os.tmpdir(), 'queuezerotwo-release1-mobile-manual.json');
    fs.writeFileSync(mobileManualBackupPath,mobileBackupJsonText,'utf8');
    const mobileBackupJson=JSON.parse(mobileBackupJsonText);
    assert.equal(mobileBackupJson.app, 'QueueZeroTwo');
    assert.equal(mobileBackupJson.state.ended, true);
    await ip.evaluate(() => localStorage.clear());
    await ip.reload({waitUntil: 'networkidle'});

    // Context 2: restore the Release 1 settings backup on a clean device.
    await ip.goto(APP, {waitUntil: 'networkidle'});
    await ip.evaluate(() => localStorage.clear());
    await ip.reload({waitUntil: 'networkidle'});
    await ip.locator('#imp').setInputFiles(persistencePath);
    await ip.getByRole('button', {name: 'Confirm'}).click();
    await ip.waitForFunction(() => S.target === 15 && S.wb === 1 && S.courts.length === 6, null, {timeout: 5000});
    assert.equal(await ip.locator('#tg').inputValue(), '15');
    assert.equal(await ip.locator('#wbs').inputValue(), '1');
    assert.equal(await ip.locator('#ncs').inputValue(), '6');
    await ip.evaluate(() => localStorage.clear());
    await ip.reload({waitUntil: 'networkidle'});

    // Context 3: hostile backup must remain inert and render as text.
    const hostile='<img src=x onerror=alert(1)>';
    const hostileSessionName='<img/src=x/onerror=alert(1)>';
    fs.writeFileSync(hostilePath, JSON.stringify({
      app:'QueueZeroTwo',
      version:1,
      exportedAt:new Date().toISOString(),
      state:{
        name:hostileSessionName,
        courts:[
          {id:1,name:hostile,isActive:false,players:[],score:[0,0],mid:'',t:0},
          ...Array.from({length:11},(_,i)=>({id:i+2,name:'Court '+(i+2),isActive:false,players:[],score:[0,0],mid:'',t:0}))
        ],
        log:[{mid:'hostile1',c:hostile,p:['Alice','Bob','Carol','Dave'],s:[11,9],t:Date.now(),d:600000,tg:11}]
      }
    }), 'utf8');
    let alerts=0;
    pp.on('dialog', async d => { alerts++; await d.dismiss(); });
    await pp.goto(APP, {waitUntil: 'networkidle'});
    await pp.evaluate(() => localStorage.clear());
    await pp.reload({waitUntil: 'networkidle'});
    await pp.locator('#imp').setInputFiles(hostilePath);
    await pp.getByRole('button', {name: 'Confirm'}).click();
    await pp.waitForFunction(() => S.log.length === 1 && S.courts.length === 8 && S.log[0].w === -1 && S.courts[0].name.includes('<img'), null, {timeout: 5000});
    assert.equal(await pp.locator('#ncs').inputValue(), '8');
    assert.deepEqual(await pp.evaluate(() => stats()), []);
    assert.equal(alerts, 0);
    assert.equal(await pp.locator('#log img').count(), 0);
    assert.equal(await pp.locator('#courts img').count(), 0);
    assert.match(await pp.locator('#log').innerText(), /<img src=x onerror=/);
    await pp.waitForFunction(name=>S.name===name,hostileSessionName,{timeout:5000});
    await pp.locator('#rs').click();
    const hostileEndDialog=pp.locator('[role="dialog"]').last();
    await hostileEndDialog.getByRole('button',{name:'Confirm'}).click();
    await pp.locator('#sn').waitFor({state:'visible',timeout:5000});
    assert.equal(await pp.locator('#sn').inputValue(),hostileSessionName,'Restored hostile name stays literal in the Results dialog');
    await pp.waitForTimeout(100);
    assert.equal(await pp.locator('img[onerror],img[src="x"],svg[onload]').count(),0,'Hostile session name creates no injected elements');
    assert.equal(alerts,0,'Hostile session name triggers no JavaScript dialog');
    await pp.evaluate(() => localStorage.clear());
    await pp.reload({waitUntil: 'networkidle'});

    // Restore the normal 11-point fixture before the named-session flow.
    await dp.locator('#tg').selectOption('11');
    await dp.locator('#wbs').selectOption('2');
    await dp.waitForFunction(() => S.target === 11 && S.wb === 2, null, {timeout: 5000});

    // Release 11: Equal Sit-outs uses fewest games, then longest wait, then queue order.
    await dp.evaluate(() => {
      S = mk();
      S.eq = true;
      S.queue = ['Alpha','Beta','Gamma','Delta','Epsilon'];
      S.gp = {alpha:2,beta:2,gamma:2,delta:2,epsilon:2};
      const now = Date.now();
      S.wt = {
        alpha: now - 1000,
        beta: now - 4000,
        gamma: now - 3000,
        delta: now - 2000,
        epsilon: now - 5000,
      };
      render();
    });
    assert.deepEqual(
      await dp.evaluate(() => pick4().map(i => S.queue[i])),
      ['Beta','Gamma','Delta','Epsilon'],
    );

    await dp.evaluate(() => {
      const same = Date.now() - 10000;
      S.wt = {alpha:same,beta:same,gamma:same,delta:same,epsilon:same};
      render();
    });
    assert.deepEqual(
      await dp.evaluate(() => pick4().map(i => S.queue[i])),
      ['Alpha','Beta','Gamma','Delta'],
    );

    // Wait timestamps are created when players check in, cleared when they go to court,
    // and restarted when they return to the waiting stack.
    await dp.evaluate(() => {
      S = mk();
      S.waiting = ['One','Two','Three','Four'];
      render();
    });
    await dp.getByRole('button', {name:'Check in all'}).click();
    assert.equal(await dp.evaluate(() => Object.keys(S.wt).length), 4);
    await dp.locator('#go').click();
    await dp.waitForFunction(
      () => S.courts.some(c => c.isActive) && S.queue.length === 0 && Object.keys(S.wt).length === 0,
      null,
      {timeout:5000},
    );
    await finishAndChoose(dp,-1);
    await dp.waitForFunction(
      () => !S.courts.some(c => c.isActive) && S.queue.length === 4 && Object.keys(S.wt).length === 4,
      null,
      {timeout:5000},
    );

    // Return to a clean device state before the existing session regressions.
    await dp.evaluate(() => localStorage.clear());
    await dp.reload({waitUntil:'networkidle'});

    // Context 1: full named-session/history flow.
    await setupFour(dp);
    await dp.locator('#go').click();
    await dp.locator('#courts .sbg[aria-label="Plus point, Team 1"]').first().waitFor({state:'visible', timeout:5000});

    for (let i = 0; i < 11; i++) {
      await dp.locator('button[aria-label="Plus point, Team 1"]').first().click();
    }

    await finishAndChoose(dp,0);
    await dp.locator('#msg').getByText('Match logged.').waitFor({state:'visible', timeout:5000});

    // A finished session can be serialized into a full backup for restore.
    await dp.locator('#rs').click();
    const finishDialog = dp.locator('[role="dialog"]');
    await finishDialog.getByRole('button', {name: 'Confirm'}).click();
    await dp.locator('#sn').waitFor({state:'visible',timeout:10000});
    const resultsDialog=dp.locator('[role="dialog"]').last();
    await resultsDialog.locator('#sn').fill('Sat 6pm');
    const exportButton=resultsDialog.getByRole('button',{name:'Export backup'});
    assert.equal(await exportButton.count(),1,'The Results dialog exposes one Export backup action');
    let resultsExportPublishCalls=0;
    const trackResultsExportPublish=request=>{
      if(request.url().includes('/rpc/publish_pickle_'))resultsExportPublishCalls++;
    };
    dp.on('request',trackResultsExportPublish);
    const [resultsDownload]=await Promise.all([
      dp.waitForEvent('download'),
      exportButton.click(),
    ]);
    dp.off('request',trackResultsExportPublish);
    assert.equal(resultsExportPublishCalls,0,'Exporting from Results must not call a publish RPC');
    assert.match(resultsDownload.suggestedFilename(),/^queuezerotwo-sat-6pm-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await dp.locator('#msg').getByText('Backup exported. Live View control key excluded.').waitFor({state:'visible',timeout:5000});
    await resultsDownload.saveAs(finishedBackupPath);

    // User-controlled names must never become unsafe path segments in downloaded filenames.
    for (const [inputName,expectedPrefix] of [
      ['a/b:c*?"<>|','queuezerotwo-abc-backup-'],
      ['a\\b','queuezerotwo-ab-backup-'],
      ['😀🔥','queuezerotwo-session-backup-'],
      ['','queuezerotwo-session-backup-'],
    ]) {
      await resultsDialog.locator('#sn').fill(inputName);
      const [caseDownload]=await Promise.all([
        dp.waitForEvent('download'),
        exportButton.click(),
      ]);
      assert.ok(caseDownload.suggestedFilename().startsWith(expectedPrefix),'Unsafe session name gets a safe filename: '+inputName);
      assert.match(caseDownload.suggestedFilename(),/backup-\d{4}-\d{2}-\d{2}\.json$/);
    }
    const slugChecks=await dp.evaluate(()=>({
      leadingDotsAndControls:backupNameSlug(String.fromCharCode(0)+'.. / '+String.fromCharCode(127)),
      collapsedWhitespace:backupNameSlug('   Weekly   Saturday   '),
      backslashRemoved:backupNameSlug('a'+String.fromCharCode(92)+'b'),
    }));
    assert.deepEqual(slugChecks,{leadingDotsAndControls:'session',collapsedWhitespace:'weekly-saturday',backslashRemoved:'ab'});
    await resultsDialog.locator('#sn').fill('Sat 6pm');
    const finishedBackup=JSON.parse(fs.readFileSync(finishedBackupPath,'utf8'));
    assert.equal(finishedBackup.app, 'QueueZeroTwo');
    assert.equal(finishedBackup.version, 1);
    assert.equal(finishedBackup.state.ended, true);
    assert.equal(finishedBackup.state.log.length, 1);
    assert.equal(finishedBackup.state.log[0].p.length, 4);
    assert.equal(Object.hasOwn(finishedBackup.state,'sid'),false,'Export excludes the live session ID');
    assert.equal(Object.hasOwn(finishedBackup.state,'sh'),false,'Export excludes the host key');
    assert.equal(Object.hasOwn(finishedBackup.state,'rid'),false,'Export excludes the results publication code');

    // Supply a local-only results code so the QR branch exists without making a publish RPC.
    await dp.evaluate(()=>{S.rr=true;S.lr=false;S.rid='QRTEST1234';showRes()});
    await dp.locator('[role="dialog"]').last().locator('.qrb').waitFor({state:'attached',timeout:5000});

    // The locked Results dialog stays usable on a narrow phone viewport.
    await dp.setViewportSize({width:320,height:640});
    assert.equal(await resultsDialog.locator('.qrb').evaluate(el=>getComputedStyle(el).display),'none','QR is hidden at phone width');
    // The result sections are intentionally arranged in a horizontal swipe track.
    // Bring the action section into view before checking its controls against the viewport.
    const resultsTrack=resultsDialog.locator('.session-results-track');
    await resultsTrack.evaluate(el=>{el.scrollLeft=el.scrollWidth});
    await dp.waitForTimeout(100);
    const actionPanel=resultsDialog.locator('.session-results-action-panel');
    const actionRect=await actionPanel.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right}});
    assert.ok(actionRect.x>=0&&actionRect.right<=320,'Session actions panel is reachable within the 320px viewport after horizontal swipe');
    for (const [selector,label] of [['.sh','Share results image'],['.rb','Export backup'],['.nw','New session']]) {
      const button=resultsDialog.locator(selector);
      await button.waitFor({state:'visible',timeout:5000});
      assert.equal(await button.isVisible(),true,label+' remains visible at 320px');
      const rect=await button.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height}});
      assert.ok(rect.x>=0&&rect.right<=320&&rect.y>=0&&rect.bottom<=640,label+' stays inside the 320px viewport');
      assert.ok(rect.height>=44,label+' meets the 44px touch target');
    }
    const firstFocus=resultsDialog.locator('#sn');
    const lastFocus=resultsDialog.locator('.nw');
    await firstFocus.focus();
    await dp.keyboard.press('Shift+Tab');
    assert.equal(await lastFocus.evaluate(el=>el===document.activeElement),true,'Shift+Tab from the first control wraps to New session');
    await dp.keyboard.press('Tab');
    assert.equal(await firstFocus.evaluate(el=>el===document.activeElement),true,'Tab from New session wraps to the first control');
    let exportReached=false;
    for(let i=0;i<8;i++){
      await dp.keyboard.press('Tab');
      if(await exportButton.evaluate(el=>el===document.activeElement)){exportReached=true;break}
    }
    assert.equal(exportReached,true,'Export backup is included in the modal focus trap');
    await dp.setViewportSize({width:639,height:800});
    assert.equal(await resultsDialog.locator('.qrb').evaluate(el=>getComputedStyle(el).display),'none','QR stays hidden below the sm breakpoint');
    await dp.setViewportSize({width:640,height:800});
    assert.notEqual(await resultsDialog.locator('.qrb').evaluate(el=>getComputedStyle(el).display),'none','QR appears at the sm breakpoint');
    await dp.setViewportSize({width:1280,height:800});
    assert.notEqual(await resultsDialog.locator('.qrb').evaluate(el=>getComputedStyle(el).display),'none','Projector/desktop Results dialog keeps the QR visible');

    // Share results image is drawn to canvas, not copied from the dialog DOM or QR element.
    await dp.waitForFunction(()=>!!RF,null,{timeout:5000});
    await dp.evaluate(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));
    const [imageDownload]=await Promise.all([
      dp.waitForEvent('download'),
      resultsDialog.locator('.sh').click(),
    ]);
    assert.equal(imageDownload.suggestedFilename(),'queuezerotwo-results.png');
    const resultsImagePath=path.join(os.tmpdir(),'queuezerotwo-results.png');
    await imageDownload.saveAs(resultsImagePath);
    const resultsImage=fs.readFileSync(resultsImagePath);
    assert.equal(resultsImage.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Share results produces a valid PNG');
    assert.equal(resultsImage.readUInt32BE(16),1080,'Share image retains its expected 1080px canvas width');
    assert.ok(resultsImage.readUInt32BE(20)>0,'Share image has a non-zero canvas height');
    await dp.locator('#msg').getByText('Results image saved').waitFor({state:'visible',timeout:5000});


    // Context 2: clean mobile device imports the same end-of-session backup and restores the scored log.
    await ip.goto(APP, {waitUntil:'networkidle'});
    await ip.evaluate(() => localStorage.clear());
    await ip.reload({waitUntil:'networkidle'});
    await ip.locator('#imp').setInputFiles(finishedBackupPath);
    await ip.getByRole('button', {name: 'Confirm'}).click();
    await ip.waitForFunction(() => S.name === 'Sat 6pm' && S.log.length === 1 && S.log[0].p.length === 4, null, {timeout:5000});
    assert.equal(await ip.evaluate(() => S.name),'Sat 6pm','Import restores the session name');
    assert.equal(await ip.evaluate(() => S.log.length),1,'Import restores the match log');
    assert.deepEqual(await ip.evaluate(() => S.log[0].p),['Alpha','Beta','Gamma','Delta']);

    // Avoid creating persistent production/Supabase test sessions. The release-2b
    // history behavior is local-device functionality, so the test blocks Supabase.
    await dp.locator('#sn').waitFor({state:'visible', timeout:5000});
    await dp.locator('#sn').fill('Sat 6pm');
    assert.equal(await dp.evaluate(() => S.name), 'Sat 6pm');

    await dp.locator('.nw').click();
    await dp.getByRole('button', {name: 'Confirm'}).click();

    await openMenu(dp);
    await dp.locator('#qmenu button[title="Past sessions"]').click();
    const history = dp.locator('[role="dialog"]');
    await history.getByText('Sat 6pm', {exact:true}).waitFor({state:'visible', timeout:5000});
    assert.match(await history.innerText(), /1 games/);
    assert.match(await history.innerText(), /Alpha|Beta|Gamma|Delta/);
    await history.getByRole('button', {name: 'Close'}).click();

    // The backup serializer must include archived history. The actual app Export
    // button/download interaction is covered once above to avoid duplicate download timing.
    const backupJson=await dp.evaluate(() => expData());
    fs.writeFileSync(backupPath,backupJson,'utf8');
    const backup=JSON.parse(backupJson);
    assert.equal(backup.app, 'QueueZeroTwo');
    assert.equal(backup.state.hist[0].name, 'Sat 6pm');
    assert.equal(backup.state.hist[0].g, 1);
    assert.equal(backup.state.hist[0].top.length <= 10, true);

    // Delete the saved session, then verify the list is empty.
    await openMenu(dp);
    await dp.locator('#qmenu button[title="Past sessions"]').click();
    await dp.getByRole('button', {name: 'Delete this session'}).click();
    await dp.getByRole('button', {name: 'Confirm'}).click();
    const emptyHistory = dp.locator('[role="dialog"]');
    await emptyHistory.getByText('No past sessions yet.', {exact:false}).waitFor({state:'visible', timeout:5000});
    await emptyHistory.getByRole('button', {name: 'Close'}).click();

    // Context 2: clean mobile device imports the same backup and restores history.
    await ip.goto(APP, {waitUntil:'networkidle'});
    await ip.locator('#imp').setInputFiles(backupPath);
    await ip.getByRole('button', {name: 'Confirm'}).click();
    await openMenu(ip);
    await ip.locator('#qmenu button[title="Past sessions"]').click();
    const imported = ip.locator('[role="dialog"]');
    await imported.getByText('Sat 6pm', {exact:true}).waitFor({state:'visible', timeout:5000});
    await imported.getByRole('button', {name: 'Close'}).click();

    // Release 3 regression: Undo a finished match, then finish it again. All-time Players must count one game.
    await dp.evaluate(() => localStorage.clear());
    await dp.reload({waitUntil: 'networkidle'});
    await dp.evaluate(() => S.ended = false);
    await dp.locator('#pn').fill('Alpha,Beta,Gamma,Delta');
    await dp.locator('#f button').click();
    await dp.getByRole('button', {name: 'Check in all'}).click();
    await dp.locator('#go').click();
    for (let i = 0; i < 11; i++) {
      await dp.locator('button[aria-label="Plus point, Team 1"]').first().click();
    }
    const liveSeqBeforeFinish=await dp.evaluate(()=>Number(S.liveSeq)||0);
    await finishAndChoose(dp,0);
    await dp.locator('#msg').getByText('Match logged.').waitFor({state:'visible', timeout:5000});
    // Let the debounced Live View snapshot advance persisted seq before Undo.
    // Sequence-only metadata must not make an otherwise untouched match "too late".
    await dp.waitForFunction(seq=>(Number(S.liveSeq)||0)>seq,liveSeqBeforeFinish,{timeout:5000});
    await dp.locator('#msg').getByRole('button', {name:'Undo'}).click();
    await dp.waitForFunction(() => S.log.length === 0 && S.courts.some(c => c.isActive), null, {timeout:5000});
    await dp.locator('button[aria-label="Plus point, Team 1"]').first().waitFor({state:'visible', timeout:5000});
    for (let i = 0; i < 11; i++) {
      await dp.locator('button[aria-label="Plus point, Team 1"]').first().click();
    }
    await finishAndChoose(dp,0);
    await dp.locator('#msg').getByText('Match logged.').waitFor({state:'visible', timeout:5000});
    await openMenu(dp);
    await dp.locator('#qmenu button[title="Players"]').click();
    const players = dp.locator('[role="dialog"]').last();
    await players.locator('button.pr[data-k="alpha"]').waitFor({state:'visible', timeout:5000});
    await players.locator('button.pr[data-k="alpha"]').click();
    const profile = dp.locator('[role="dialog"]').last();
    const gamesCard = profile.getByText('Games', {exact:true}).locator('..');
    assert.match(await gamesCard.innerText(), /^1\s*Games$/);
    await profile.getByRole('button', {name:'Close'}).click();
    await dp.evaluate(() => localStorage.clear());
    await dp.reload({waitUntil:'networkidle'});

    // Release 4/5/6/8 responsive header + sidebar regression.
    await ip.goto(APP, {waitUntil:'networkidle'});
    await ip.evaluate(() => localStorage.clear());
    await ip.reload({waitUntil:'networkidle'});
    const header = ip.locator('header .container');
    const headerBar = ip.locator('header .container>div:nth-child(2)');
    assert.equal(await header.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await headerBar.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await ip.locator('#mnw').count(), 0);
    assert.equal(await ip.locator('#mnb').count(), 1);
    assert.equal(await ip.locator('#mnb').isVisible(), true);
    assert.equal(await headerBar.locator('> button[onclick="live()"]').count(), 1);
    for (const id of ['snb','hpb','thb','tsb']) {
      assert.equal(await headerBar.locator('#'+id).count(), 1);
    }
    const faqHeader = headerBar.locator('> button[onclick="openFaq()"][title="How it works"]');
    assert.equal(await faqHeader.count(), 1);
    assert.equal(await headerBar.locator('> button[onclick="hist()"]').count(), 0);
    assert.equal(await headerBar.locator('> button[onclick="stand()"]').count(), 0);
    assert.equal(await headerBar.locator('#exp').count(), 0);
    assert.equal(await headerBar.locator('#impbtn').count(), 0);

    // The moved utility controls work directly from the header.
    await headerBar.locator('#snb').click();
    if (await headerBar.locator('#hpb').isVisible()) await headerBar.locator('#hpb').click();
    await headerBar.locator('#tsb').click();
    await headerBar.locator('#thb').click();
    assert.equal(await ip.locator('html[data-theme="light"]').count(), 1);
    await headerBar.locator('#thb').click();
    assert.equal(await ip.locator('html[data-theme="light"]').count(), 0);
    await faqHeader.click();
    const faqDialog = ip.locator('#faq');
    await faqDialog.waitFor({state:'visible', timeout:5000});
    assert.equal(await faqDialog.evaluate(d => d.open), true);
    await ip.keyboard.press('Escape');
    await faqDialog.waitFor({state:'hidden', timeout:5000});

    // Only the remaining five items live in the phone drawer.
    await openMenu(ip);
    const menu = ip.locator('#qmenu');
    await menu.waitFor({state:'visible', timeout:5000});
    await assertMenuToggleTopmost(ip);
    await ip.locator('#mnb').click();
    assert.equal(await menu.isVisible(), false);
    await openMenu(ip);
    const menuBox = await menu.boundingBox();
    assert.ok(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= (await ip.evaluate(() => innerWidth)));
    assert.equal(await menu.locator('button').count(), 5);
    for (const title of ['Players','Standings','Past sessions','Export backup','Import backup']) {
      await menu.locator('button[title="'+title+'"]').waitFor({state:'visible', timeout:5000});
    }
    assert.equal(await menu.locator('#snb,#hpb,#thb,#tsb').count(), 0);
    assert.equal(await menu.locator('button[title="How it works"]').count(), 0);

    await menu.locator('button[title="Standings"]').click();
    await ip.getByRole('heading', {name:'Live Standings'}).waitFor({state:'visible', timeout:5000});
    await ip.getByRole('button', {name:'Back to game'}).click();

    await openMenu(ip);
    assert.equal(await menu.isVisible(), true);
    await ip.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false);
    await openMenu(ip);
    const scrimBox = await ip.locator('#qscrim').boundingBox();
    const drawerBox = await menu.boundingBox();
    assert.ok(scrimBox && drawerBox);
    await ip.mouse.click(Math.min(scrimBox.x + scrimBox.width - 6, drawerBox.x + drawerBox.width + 20), 80);
    assert.equal(await menu.isVisible(), false);

    // Release 11: menu starts hidden and opens on demand at every breakpoint.
    await dp.goto(APP, {waitUntil:'networkidle'});
    await dp.evaluate(() => localStorage.clear());
    await dp.setViewportSize({width:1280,height:800});
    await dp.reload({waitUntil:'networkidle'});
    const dmenu = dp.locator('#qmenu');
    assert.equal(await dmenu.isVisible(), false);
    assert.equal(await dp.locator('#mnw').count(), 0);
    assert.equal(await dp.locator('header button[onclick="live()"]').count(), 1);
    assert.equal(await dp.locator('#mnb').isVisible(), true);
    assert.equal(await dp.locator('#mnb').getAttribute('aria-label'), 'Open menu');
    assert.equal(await dp.evaluate(() => document.body.classList.contains('qw')), false);

    await dp.locator('#mnb').click();
    await dmenu.waitFor({state:'visible', timeout:5000});
    await assertMenuToggleTopmost(dp);
    assert.ok((await dmenu.boundingBox())?.width >= 220);
    assert.equal(await dp.locator('#mnb').getAttribute('aria-label'), 'Close menu');
    assert.equal(await dp.locator('#mnb').getAttribute('aria-expanded'), 'true');
    assert.equal(await dp.evaluate(() => document.body.classList.contains('qw')), true);
    const open1280 = await dmenu.boundingBox();
    const stackOpen1280 = await dp.locator('#sstk').boundingBox();
    assert.ok(open1280 && stackOpen1280 && stackOpen1280.x >= open1280.x + open1280.width + 4);
    assert.equal(await dmenu.locator('button').count(), 5);
    for (const title of ['Players','Standings','Past sessions','Export backup','Import backup']) {
      await dmenu.locator('button[title="'+title+'"]').waitFor({state:'visible', timeout:5000});
    }

    // At 1280px+ choosing an item leaves the docked menu open.
    await dmenu.locator('button[title="Standings"]').click();
    await dp.getByRole('heading', {name:'Live Standings'}).waitFor({state:'visible', timeout:5000});
    await dp.getByRole('button', {name:'Back to game'}).click();
    assert.equal(await dmenu.isVisible(), true);
    assert.equal(await dp.locator('#mnb').getAttribute('aria-label'), 'Close menu');
    await dp.keyboard.press('Escape');
    assert.equal(await dmenu.isVisible(), false);
    assert.equal(await dp.locator('#mnb').getAttribute('aria-label'), 'Open menu');
    assert.equal(await dp.evaluate(() => document.body.classList.contains('qw')), false);

    // A reload always returns the menu to closed.
    await dp.locator('#mnb').click();
    assert.equal(await dmenu.isVisible(), true);
    await dp.reload({waitUntil:'networkidle'});
    assert.equal(await dmenu.isVisible(), false);
    assert.equal(await dp.locator('#mnb').getAttribute('aria-label'), 'Open menu');

    // The wide desktop dock works at 1800px too.
    await dp.setViewportSize({width:1800,height:900});
    await dp.reload({waitUntil:'networkidle'});
    assert.equal(await dmenu.isVisible(), false);
    await dp.locator('#mnb').click();
    assert.equal(await dmenu.isVisible(), true);
    await assertMenuToggleTopmost(dp);
    const dockWide = await dmenu.boundingBox();
    const stackWide = await dp.locator('#sstk').boundingBox();
    assert.ok(dockWide && stackWide && stackWide.x >= dockWide.x + dockWide.width + 4);
    assert.equal(await dp.evaluate(() => document.body.classList.contains('qw')), true);
    await dp.keyboard.press('Escape');
    assert.equal(await dmenu.isVisible(), false);

    // The 1024px tablet layout uses a temporary overlay, not a rail.
    await dp.setViewportSize({width:1024,height:800});
    await dp.reload({waitUntil:'networkidle'});
    assert.equal(await dmenu.isVisible(), false);
    assert.equal(await dp.locator('#mnb').isVisible(), true);
    const stackClosed1024 = await dp.locator('#sstk').boundingBox();
    await dp.locator('#mnb').click();
    await dmenu.waitFor({state:'visible', timeout:5000});
    await assertMenuToggleTopmost(dp);
    assert.ok((await dmenu.boundingBox())?.width >= 220);
    assert.equal(await dp.evaluate(() => document.body.classList.contains('qw')), false);
    const stackOpen1024 = await dp.locator('#sstk').boundingBox();
    assert.ok(stackClosed1024 && stackOpen1024 && Math.abs(stackOpen1024.x - stackClosed1024.x) < 2);

    await dmenu.locator('button[title="Standings"]').click();
    assert.equal(await dmenu.isVisible(), false);
    await dp.getByRole('heading', {name:'Live Standings'}).waitFor({state:'visible', timeout:5000});
    await dp.getByRole('button', {name:'Back to game'}).click();

    await dp.locator('#mnb').click();
    assert.equal(await dmenu.isVisible(), true);
    await dp.mouse.click(900, 120);
    await dmenu.waitFor({state:'hidden', timeout:1000});

    // The 1279px tablet layout is still an overlay, not the docked rail.
    await dp.setViewportSize({width:1279,height:800});
    await dp.reload({waitUntil:'networkidle'});
    assert.equal(await dmenu.isVisible(), false);
    await dp.locator('#mnb').click();
    await dmenu.waitFor({state:'visible', timeout:5000});
    await assertMenuToggleTopmost(dp);
    assert.equal(await dp.evaluate(() => document.body.classList.contains('qw')), false);
    await dp.keyboard.press('Escape');

    // Context 3: mobile scoring regression using the current production selectors.
    await setupFour(pp);
    await pp.evaluate(() => document.getElementById('nvs')?.click());
    await pp.locator('#go').click();
    await pp.evaluate(() => document.getElementById('nvp')?.click());
    await pp.locator('button[aria-label="Plus point, Team 1"]').first().click();
    await assert.equal(await pp.locator('.sbn').first().innerText(), '1');

    // Large, realistic result records must fail loudly at a simulated 5 MiB localStorage budget.
    await realisticStorageQuotaRegression(browser);

    console.log(JSON.stringify({
      pass: true,
      namedSession: true,
      nullSessionUpdateIgnored: true,
      archivedHistory: true,
      topThreeStored: true,
      exportContainsHistory: true,
      manualExportButton: true,
      resultsDialogExportButton: true,
      resultsDialogExport320pxAndFocusTrap: true,
      resultsFilenameSanitized: true,
      hostileImportedSessionNameSafe: true,
      resultsQrResponsiveAndShareImage: true,
      resultsBackupRestoresNameAndMatchLog: true,
      serviceWorkerV1ToV43UpgradeToV44: true,
      finishLogWinnerSelection: true,
      mobileEarlyFinishUndo: true,
      deleteWorks: true,
      importRestoresHistory: true,
      mobileScoring: true,
      equalSitoutWaitTieBreak: true,
      waitTimestampLifecycle: true,
      durableQueueCompaction: true,
      profilesPrecached: true,
      liveViewHostWinBy: true,
      realisticQueueQuotaWarning: true,
    }, null, 2));
  } finally {
    // Preserve trace snapshots and final screenshots so a failed CI run can be debugged
    // without needing access to the live Actions log.
    for (const [name,page] of [['desktop',dp],['iphone',ip],['pixel',pp]]) {
      try { await page.screenshot({path:path.join(debugDir,name+'-final.png'),fullPage:true}); } catch {}
    }
    for (const [name,context] of [['desktop',desktop],['iphone',iphone],['pixel',pixel]]) {
      try { await context.tracing.stop({path:path.join(debugDir,name+'-trace.zip')}); } catch {}
    }
    for (const p of [backupPath, persistencePath, endBackupPath, finishedBackupPath, hostilePath, path.join(os.tmpdir(),'queuezerotwo-results.png'), path.join(os.tmpdir(), 'queuezerotwo-release1-mobile-auto.json'),path.join(os.tmpdir(), 'queuezerotwo-release1-mobile-manual.json')]) {
      try { fs.unlinkSync(p); } catch {}
    }
    await browser.close();
  }
}

main().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
