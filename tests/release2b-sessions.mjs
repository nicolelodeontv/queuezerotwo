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
  await page.goto(APP, {waitUntil: 'networkidle'});
  await page.evaluate(() => {
    if (innerWidth < 1024) document.getElementById('nvs')?.click();
  });
  await page.locator('#pn').fill('Alpha,Beta,Gamma,Delta');
  await page.locator('#f button').click();
  await page.waitForFunction(() => document.getElementById('wc')?.textContent === '4', null, {timeout: 5000});
  await page.getByRole('button', {name: 'Check in all'}).click();
  await page.waitForFunction(() => document.getElementById('wc')?.textContent === '0', null, {timeout: 5000});
  await page.evaluate(() => document.getElementById('nvp')?.click());
  assert.equal(await page.locator('#qc').innerText(), '4');
}

async function simulateV24ToV25(browser) {
  const context = await browser.newContext({...devices['Desktop Chrome'],serviceWorkers:'allow',locale:'en-US'});
  const page = await context.newPage();
  let swFetch = 0;
  const currentSw = fs.readFileSync(path.resolve('sw.js'), 'utf8');
  assert.match(currentSw,/queuezerotwo-v25/);
  const oldV24 = `const V='queuezerotwo-v24';self.addEventListener('install',e=>e.waitUntil(caches.open(V).then(c=>c.put('/__queuezerotwo_v24_sentinel__',new Response('v24'))).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`;
  await context.route('**/sw.js', async route => {
    swFetch++;
    await route.fulfill({status:200,contentType:'application/javascript',body:swFetch===1?oldV24:currentSw});
  });
  await page.goto(APP,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!navigator.serviceWorker?.controller,null,{timeout:5000});
  await page.evaluate(()=>{
    localStorage.setItem('pickleStackState',JSON.stringify({courts:[{id:1,name:'Court 1',isActive:false,players:[],score:[0,0],mid:'',t:0}],queue:['Persisted player'],waiting:[],rest:{},log:[],target:11,lv:{},md:'bal',sd:0,gp:{},wt:{},ws:false,wl:2,eq:false,tts:false,hap:true,sid:'PERSISTEDSID',sh:'a'.repeat(64)}));
    localStorage.setItem('queuezerotwo-publish-queue-v1',JSON.stringify({v:1,seq:1,items:[{seq:1,sid:'PERSISTEDSID',sh:'a'.repeat(64),kind:'state',attempts:0,lastError:'',payload:{t:11,q:['Persisted player'],courts:[],nx:[],lb:[]}}]}));
  });
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
  await page.waitForFunction(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    return !!r?.waiting || await caches.has('queuezerotwo-v25');
  },null,{timeout:10000});
  await page.evaluate(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    if(r?.waiting)r.waiting.postMessage('SKIP_WAITING');
  });
  await page.waitForFunction(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    return !!r && !r.waiting && r.active?.state==='activated' && await caches.has('queuezerotwo-v25');
  },null,{timeout:10000});
  await page.reload({waitUntil:'networkidle'});
  const out=await page.evaluate(async()=>{
    const cache=await caches.open('queuezerotwo-v25');
    return {
      queue:JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items,
      state:JSON.parse(localStorage.getItem('pickleStackState')||'{}'),
      oldCache:await caches.has('queuezerotwo-v24'),
      profilesCached:!!(await cache.match('/profiles.js'))
    };
  });
  assert.equal(out.oldCache,false);
  assert.equal(out.profilesCached,true,'profiles.js is present in the offline shell cache');
  assert.equal(out.queue.length,1);
  assert.equal(out.queue[0].sid,'PERSISTEDSID');
  assert.match(out.queue[0].id,/^[0-9a-f]{32}$/);
  assert.equal(out.state.queue[0],'Persisted player');
  assert.equal(out.state.sid,'PERSISTEDSID');
  await context.close();
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

async function main() {
  const browser = await chromium.launch({headless: true});
  const desktop = await freshContext(browser, devices['Desktop Chrome']);
  const iphone = await freshContext(browser, devices['iPhone 13']);
  const pixel = await freshContext(browser, devices['Pixel 7']);

  const dp = await desktop.newPage();
  const ip = await iphone.newPage();
  const pp = await pixel.newPage();
  const syncPublishes = [];
  const resultPublishes = [];
  await simulateV24ToV25(browser);
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
    const coldContext=await browser.newContext({...devices['Desktop Chrome'],serviceWorkers:'allow',locale:'en-US'});
    await coldContext.route(SUPABASE+'/**',route=>{
      const u=new URL(route.request().url());
      if(u.pathname.endsWith('/rest/v1/pickle_results')&&route.request().method()==='GET'){
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{data:{v:1,name:'Cold cache results',totals:{players:1,games:1,courts:1},leaderboard:[{n:'Ana',w:1,l:0,d:2}],matches:[]},created_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString()}])});
      }
      return route.abort();
    });
    const coldPage=await coldContext.newPage();
    await coldPage.goto(APP+'#r=COLDRESULT1',{waitUntil:'networkidle'});
    await coldPage.getByText('Cold cache results',{exact:true}).waitFor({state:'visible',timeout:5000});
    await coldPage.getByText('READ-ONLY',{exact:true}).waitFor({state:'visible',timeout:5000});
    await coldContext.close();

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
    // Release 1: failed whole-state publishes queue locally and drain FIFO after reconnect.
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
    await sp.locator('button[aria-label="Plus point, Team 1"]').first().click();
    await sleep(700);
    assert.equal(await sp.evaluate(() => navigator.onLine), false);
    assert.match(await sp.locator('#ct').innerText(), /Offline/);
    assert.equal(await sp.evaluate(() => JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items.length), 1);
    await sp.locator('button[aria-label="Plus point, Team 1"]').first().click();
    await sleep(700);
    assert.equal(await sp.evaluate(() => JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items.length), 1);
    // Superseded whole-state snapshots are coalesced; the newest remains durable until reconnect.
    // Offline page-reload behavior remains part of the physical PWA pass because browser network emulation can bypass SW navigation.
    const persistedQueue = await sp.evaluate(() => JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items);
    assert.equal(persistedQueue.length, 1);
    assert.equal((persistedQueue[0].payload.courts||[]).find(v=>v.a)?.s?.[0], 2);
    await sync.setOffline(false);
    await sp.waitForFunction(
      () => JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items.length === 0,
      null,
      {timeout:5000},
    );
    assert.match(await sp.locator('#ct').innerText(), /Saved on this device/);
    const queuedScores = syncPublishes.slice(-1).map(x => {
      const c = (x.p_payload?.courts || []).find(v => v.a);
      return c?.s?.[0];
    });
    assert.deepEqual(queuedScores, [2], 'the latest queued whole-state snapshot is published after reconnect');

    // Regression: the server intentionally folds a stale host-key rejection into the
    // message "Invalid host key or expired session". It must demote the old host rather
    // than mistake the combined message for an expired code and create a fresh session.
    await sp.evaluate(() => {
      const oldSid='OLDHANDOFF',oldSh='a'.repeat(64);
      S.sid=oldSid;S.sh=oldSh;S.ho=false;S.hoff=Date.now();
      PQ=[{id:'old-host-entry-99',seq:99,sid:oldSid,sh:oldSh,kind:'state',attempts:1,lastError:'',payload:sdata()}];
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
      PQ = [{id:'stale-session-entry-101',seq:101,sid:'STALESESSION',sh:'c'.repeat(64),kind:'state',attempts:0,lastError:'',payload:sdata()}];
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
      PQ = [{id:'old-inflight-entry-150',seq:150,sid:S.sid,sh:S.sh,kind:'state',attempts:2,lastError:'',payload:sdata()}];
      PQS = 150;
      savePublishQueue();
      void flushPublishQueue();
      showRes();
    });
    await sp.waitForFunction(() => window.__oldPublishStarted === true);
    await sp.locator('[role="dialog"] .nw').click();
    await sp.getByRole('button',{name:'Confirm'}).click();
    await sp.waitForFunction(() => !S.ended && S.ho !== true);
    const freshIdentity = await sp.evaluate(() => {
      clearTimeout(st);
      ensureLiveIdentity();
      const identity = {sid:S.sid,sh:S.sh,oldEntryId:'old-inflight-entry-150'};
      queuePublishPayload(sdata(),S.sid,S.sh);
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
      PQ=[{id:'stuck-entry-100',seq:100,sid,sh,kind:'state',attempts:2,lastError:'',payload:sdata()}];
      PQS=100;savePublishQueue();clearTimeout(PQRetry);PQRetry=null;
      sb.rpc=async()=>({error:new Error('Server unavailable.')});
      syncMarker();
    });
    await sp.evaluate(() => flushPublishQueue());
    assert.equal(await sp.evaluate(() => JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1')||'{"items":[]}').items[0].attempts), 3);
    assert.equal(await sp.evaluate(() => PQ.length), 1);
    assert.match(await sp.locator('#ct').innerText(), /Sync stuck/);
    await sp.evaluate(() => {clearTimeout(PQRetry);PQRetry=null});

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
    const [offlineResultBackup]=await Promise.all([sp.waitForEvent('download'),endOfflineDialog.getByRole('button',{name:'Confirm'}).click()]);
    await offlineResultBackup.delete();
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

    // Release 1 regression: End session immediately downloads an import-compatible JSON backup.
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
    const [endBackupDownload] = await Promise.all([
      dp.waitForEvent('download'),
      endDialog.getByRole('button', {name: 'Confirm'}).click(),
    ]);
    await endBackupDownload.saveAs(endBackupPath);
    const endBackup = JSON.parse(fs.readFileSync(endBackupPath, 'utf8'));
    assert.equal(endBackup.app, 'QueueZeroTwo');
    assert.equal(endBackup.version, 1);
    assert.equal(endBackup.state.ended, true);

    // Close the results modal so subsequent fixture resets are not covered by it.
    await dp.locator('.nw').click();
    await dp.getByRole('button', {name: 'Confirm'}).click();

    // Restore the end-session backup to prove it remains compatible with Import.
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

    // Mobile-sized fallback: ending a session downloads automatically and leaves a visible Save backup action.
    await ip.evaluate(() => { localStorage.clear(); S=mk(); S.ended=false; sb.rpc=async()=>({data:true,error:null}); render(); });
    const mobileEndDialog=ip.locator('[role="dialog"]');
    await ip.locator('#rs').click();
    const [mobileAutoBackup] = await Promise.all([
      ip.waitForEvent('download'),
      mobileEndDialog.getByRole('button', {name: 'Confirm'}).click(),
    ]);
    await mobileAutoBackup.saveAs(path.join(os.tmpdir(), 'queuezerotwo-release1-mobile-auto.json'));
    await ip.locator('[role="dialog"] .bk').waitFor({state:'visible', timeout:5000});
    assert.equal(await ip.locator('[role="dialog"] .bk').isVisible(), true);
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
    fs.writeFileSync(hostilePath, JSON.stringify({
      app:'QueueZeroTwo',
      version:1,
      exportedAt:new Date().toISOString(),
      state:{
        courts:[
          {id:1,name:hostile,isActive:false,players:[],score:[0,0],mid:'',t:0},
          {id:2,name:'Court 2',isActive:false,players:[],score:[0,0],mid:'',t:0},
          {id:3,name:'Court 3',isActive:false,players:[],score:[0,0],mid:'',t:0},
          {id:4,name:'Court 4',isActive:false,players:[],score:[0,0],mid:'',t:0}
        ],
        log:[{mid:'hostile1',c:hostile,p:['Alice','Bob','Carol','Dave'],s:[11,9],w:0,t:Date.now(),d:600000,tg:11}]
      }
    }), 'utf8');
    let alerts=0;
    pp.on('dialog', async d => { alerts++; await d.dismiss(); });
    await pp.goto(APP, {waitUntil: 'networkidle'});
    await pp.evaluate(() => localStorage.clear());
    await pp.reload({waitUntil: 'networkidle'});
    await pp.locator('#imp').setInputFiles(hostilePath);
    await pp.getByRole('button', {name: 'Confirm'}).click();
    await pp.waitForFunction(() => S.log.length === 1 && S.courts[0].name.includes('<img'), null, {timeout: 5000});
    assert.equal(alerts, 0);
    assert.equal(await pp.locator('#log img').count(), 0);
    assert.equal(await pp.locator('#courts img').count(), 0);
    assert.match(await pp.locator('#log').innerText(), /<img src=x onerror=/);
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
    await dp.getByRole('button', {name:'FINISH & LOG'}).click();
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

    await dp.getByRole('button', {name: 'FINISH & LOG'}).click();
    await dp.locator('#msg').getByText('Match logged.').waitFor({state:'visible', timeout:5000});

    // Release 1 regression: named finished sessions auto-download a backup containing the scored log.
    await dp.locator('#rs').click();
    const finishDialog = dp.locator('[role="dialog"]');
    const [finishedDownload] = await Promise.all([
      dp.waitForEvent('download'),
      finishDialog.getByRole('button', {name: 'Confirm'}).click(),
    ]);
    await finishedDownload.saveAs(finishedBackupPath);
    const finishedBackup = JSON.parse(fs.readFileSync(finishedBackupPath, 'utf8'));
    assert.equal(finishedBackup.app, 'QueueZeroTwo');
    assert.equal(finishedBackup.state.log.length, 1);
    assert.equal(finishedBackup.state.log[0].p.length, 4);

    // Context 2: clean mobile device imports the same end-of-session backup and restores the scored log.
    await ip.goto(APP, {waitUntil:'networkidle'});
    await ip.evaluate(() => localStorage.clear());
    await ip.reload({waitUntil:'networkidle'});
    await ip.locator('#imp').setInputFiles(finishedBackupPath);
    await ip.getByRole('button', {name: 'Confirm'}).click();
    await ip.waitForFunction(() => S.log.length === 1 && S.log[0].p.length === 4, null, {timeout:5000});

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

    // Export must contain the archived history.
    const [download] = await Promise.all([
      dp.waitForEvent('download'),
      (await openMenu(dp), dp.locator('#qmenu #exp').click()),
    ]);
    await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
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
    await dp.getByRole('button', {name: 'FINISH & LOG'}).click();
    await dp.locator('#msg').getByText('Match logged.').waitFor({state:'visible', timeout:5000});
    await dp.locator('#msg').getByRole('button', {name:'Undo'}).click();
    await dp.waitForFunction(() => S.log.length === 0 && S.courts.some(c => c.isActive), null, {timeout:5000});
    await dp.locator('button[aria-label="Plus point, Team 1"]').first().waitFor({state:'visible', timeout:5000});
    for (let i = 0; i < 11; i++) {
      await dp.locator('button[aria-label="Plus point, Team 1"]').first().click();
    }
    await dp.getByRole('button', {name: 'FINISH & LOG'}).click();
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
    for (const p of [backupPath, persistencePath, endBackupPath, finishedBackupPath, hostilePath, path.join(os.tmpdir(), 'queuezerotwo-release1-mobile-auto.json')]) {
      try { fs.unlinkSync(p); } catch {}
    }
    await browser.close();
  }
}

main().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
