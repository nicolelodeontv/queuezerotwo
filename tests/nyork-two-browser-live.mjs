import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:4173/';
const SUPABASE_URL = process.env.NYORK_SUPABASE_URL;
const SUPABASE_KEY = process.env.NYORK_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('NYORK_SUPABASE_URL and NYORK_SUPABASE_PUBLISHABLE_KEY are required.');
}

const html = fs.readFileSync('index.html', 'utf8');
const configPattern = /const SB_URL='[^']*',SB_KEY='[^']*';/;
assert.match(html, configPattern, 'Supabase app configuration was not found in index.html');
const testHtml = html.replace(
  configPattern,
  `const SB_URL=${JSON.stringify(SUPABASE_URL)};const SB_KEY=${JSON.stringify(SUPABASE_KEY)};`,
);
const appOrigin = new URL(APP).origin;

async function useNyorkApp(context) {
  await context.route(appOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest() && (url.pathname === '/' || url.pathname === '/index.html')) {
      await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: testHtml});
      return;
    }
    await route.continue();
  });
}

async function runNyorkOnce(iteration) {
  const browser = await chromium.launch({headless: true});
  const hostContext = await browser.newContext({...devices['Desktop Chrome'], serviceWorkers: 'block', locale: 'en-US'});
  const viewerContext = await browser.newContext({...devices['iPhone 13'], serviceWorkers: 'block', locale: 'en-US'});
  const host = await hostContext.newPage();
  const viewer = await viewerContext.newPage();
  await viewer.addInitScript(() => { window.__Q2_TEST_BROADCAST_DIAGNOSTICS__ = true; });
  let liveCode = '';
  let resultsCode = '';

  try {
    await Promise.all([useNyorkApp(hostContext), useNyorkApp(viewerContext)]);
    await host.goto(APP, {waitUntil: 'domcontentloaded'});
    await host.waitForFunction(() => typeof sb !== 'undefined' && !!sb, null, {timeout: 15000});

    const published = await host.evaluate(async () => {
      S = mk();
      S.ho = false;
      S.hoff = 0;
      S.ended = false;
      S.sid = '';
      S.sh = '';
      ensureLiveIdentity();
      S.liveSeq = 1;
      S.courts[0].isActive = true;
      S.courts[0].players = ['Alice', 'Bob', 'Cara', 'Dan'];
      S.courts[0].score = [6, 4];
      const payload = await sdata();
      window.__Q2_INITIAL_RETRY_PAYLOAD__=JSON.parse(JSON.stringify(payload));
      const q = await publishSession(payload);
      return {code: S.sid, seq: payload.seq, success: !q.error && q.data === true, error: q.error?.message || null};
    });
    liveCode = published.code;
    console.log('[NYORK LIVE CONTROL] ' + JSON.stringify(published));
    assert.match(liveCode, /^[A-Z2-9]{10}$/);
    assert.equal(published.success, true, 'Nyork Live View host publish must succeed');
    const initialHostDiagnostics=await host.evaluate(()=>readHostDiagnostics(S.sid));
    assert.ok(initialHostDiagnostics.attempts>=1,'Host monitor records the Live View RPC attempt');
    assert.ok(initialHostDiagnostics.successes>=1,'Host monitor records the successful publish');
    assert.equal(initialHostDiagnostics.failures,0,'Successful first publish has no failure');

    await viewer.goto(APP + '#s=' + liveCode, {waitUntil: 'domcontentloaded'});
    let viewerDialogs = [];
    let viewerPageErrors = [];
    let viewerMainNavigations = 0;
    viewer.on('dialog',async dialog=>{viewerDialogs.push(dialog.message());await dialog.dismiss()});
    viewer.on('pageerror',error=>viewerPageErrors.push(error.message));
    viewer.on('framenavigated',frame=>{if(frame===viewer.mainFrame())viewerMainNavigations++});
    await viewer.waitForFunction(({seq}) => {
      const text = document.querySelector('#viewer')?.innerText || '';
      return text.includes('LIVE · CONNECTED') && text.includes('Alice & Bob') && text.includes('Cara & Dan') && /\b6\b/.test(text) && /\b4\b/.test(text) && SV?.d?.seq === seq;
    }, {seq: published.seq}, {timeout: 15000});
    const firstViewerText = await viewer.locator('#viewer').innerText();
    assert.match(firstViewerText, /LIVE · CONNECTED/);
    assert.match(firstViewerText, /Alice & Bob/);
    assert.match(firstViewerText, /Cara & Dan/);
    assert.equal(await viewer.evaluate(()=>SV.d.seq),published.seq,'The RPC accepts and persists numeric seq');
    const initialViewerDiagnostics=await viewer.evaluate(()=>viewerDiagnostics());
    assert.ok(initialViewerDiagnostics.snapshotsLoaded>=1,'Viewer monitor records its initial database snapshot');
    assert.ok(initialViewerDiagnostics.acceptedUpdates>=1,'Viewer monitor records the initial accepted update');
    await viewer.locator('#vdiag').click();
    const viewerDiagDialog=viewer.locator('[role="dialog"]').last();
    await viewerDiagDialog.getByText('Live View diagnostics',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.match(await viewerDiagDialog.innerText(),/Average arrival age/);
    assert.match(await viewerDiagDialog.innerText(),/Stale updates ignored/);
    await viewerDiagDialog.getByRole('button',{name:'Close'}).click();
    await host.locator('#ct').click();
    const hostDiagDialog=host.locator('[role="dialog"]').last();
    await hostDiagDialog.getByText('Live View diagnostics',{exact:true}).waitFor({state:'visible',timeout:5000});
    assert.match(await hostDiagDialog.innerText(),/Publish attempts/);
    await hostDiagDialog.getByRole('button',{name:'Close'}).click();

    // Simulate an RPC that reached the database but whose response was lost:
    // retry the exact same payload/seq. Verify persistence separately from the
    // viewer's duplicate guard; a repeated identical UPDATE need not be observed
    // by Realtime within the same timing window as the original insert.
    const storedBeforeRetry=await host.evaluate(async()=>{
      const q=await viewerClient(S.sid).from('live_sessions').select('data,updated_at').eq('code',S.sid).maybeSingle();
      return {seq:q.data?.data?.seq??null,updatedAt:q.data?.updated_at??null,error:q.error?.message||null};
    });
    assert.equal(storedBeforeRetry.error,null,'The initial Live View row is readable before retry');
    assert.equal(storedBeforeRetry.seq,published.seq);
    const duplicateRetry=await host.evaluate(async()=>{
      const payload=JSON.parse(JSON.stringify(window.__Q2_INITIAL_RETRY_PAYLOAD__));
      const q=await publishSession(payload);
      return {seq:payload.seq,payload,success:!q.error&&q.data===true,error:q.error?.message||null,hostSeq:S.liveSeq};
    });
    assert.equal(duplicateRetry.success,true,'Retrying an already-applied sequence succeeds idempotently');
    assert.equal(duplicateRetry.hostSeq,duplicateRetry.seq,'A duplicate retry does not increment the host sequence');
    const storedAfterRetry=await host.evaluate(async()=>{
      const q=await viewerClient(S.sid).from('live_sessions').select('data,updated_at').eq('code',S.sid).maybeSingle();
      return {seq:q.data?.data?.seq??null,updatedAt:q.data?.updated_at??null,error:q.error?.message||null};
    });
    assert.equal(storedAfterRetry.error,null,'The duplicate retry leaves a readable Live View row');
    assert.equal(storedAfterRetry.seq,duplicateRetry.seq,'The database retains the duplicate sequence');
    assert.ok(Date.parse(storedAfterRetry.updatedAt)>Date.parse(storedBeforeRetry.updatedAt),'The retry request reached the database as a newer row update');
    const duplicateGuard=await viewer.evaluate(({payload,updatedAt})=>{
      const before=SV.d,beforeSeq=SV?.d?.seq??null,beforeScore=SV?.d?.courts?.[0]?.s?.[0]??null;
      const accepted=applyLiveSessionData(payload,updatedAt);
      return {
        accepted,dataPreserved:SV.d===before,
        visibleSeq:SV?.d?.seq??null,visibleScore:SV?.d?.courts?.[0]?.s?.[0]??null,
        receivedSeqs:SV?.receivedBroadcastSeqs||[],channelState:SV?.status??null,
        beforeSeq,beforeScore
      };
    },{payload:duplicateRetry.payload,updatedAt:storedAfterRetry.updatedAt});
    assert.equal(duplicateGuard.accepted,false,'The viewer rejects an already-applied duplicate sequence');
    assert.equal(duplicateGuard.dataPreserved,true,'Rejecting a duplicate preserves the last good viewer object');
    assert.equal(duplicateGuard.visibleSeq,duplicateRetry.seq,'The viewer retains the already-applied sequence');
    assert.equal(duplicateGuard.visibleScore,6,'A duplicate payload does not change the visible score');
    assert.equal(duplicateGuard.beforeSeq,duplicateRetry.seq);
    assert.equal(duplicateGuard.beforeScore,6);

    const staleSnapshotGuard = await viewer.evaluate(() => {
      const previousData = SV.d;
      const previousSeq = SV.d.seq;
      const accepted = applyLiveSessionData({...SV.d,seq:previousSeq-1},new Date().toISOString());
      return {accepted,dataPreserved:SV.d===previousData,sequencePreserved:SV.d.seq===previousSeq};
    });
    assert.equal(staleSnapshotGuard.accepted,false,'A lower sequence must not replace newer state');
    assert.equal(staleSnapshotGuard.dataPreserved,true);
    assert.equal(staleSnapshotGuard.sequencePreserved,true);
    const staleMonitor=await viewer.evaluate(()=>viewerDiagnostics().staleUpdates);
    assert.ok(staleMonitor>=2,'Viewer monitor counts duplicate and lower-sequence snapshots rejected by the guard');

    // A score save schedules the normal 400ms publish. Simulate an immediate
    // reload before that timer fires; startup must publish the persisted state.
    const reloadRpcRequests=[];
    const reloadRequestPredicate=request=>{
      if(!request.url().includes('/rest/v1/rpc/publish_pickle_session'))return false;
      try{
        const body=JSON.parse(request.postData()||'{}');
        return body.p_payload?.courts?.[0]?.s?.[0]===12;
      }catch{return false}
    };
    const reloadRequestPromise=host.waitForRequest(reloadRequestPredicate,{timeout:15000});
    const stateBeforeReload=await host.evaluate(()=>{
      const previousSeq=S.liveSeq;
      S.courts[0].score=[12,4];
      save();
      // The browser would discard this debounced timer when the page reloads.
      clearTimeout(st);st=null;
      return {
        previousSeq,
        persistedScore:JSON.parse(localStorage.getItem(K)||'{}').courts?.[0]?.score||null
      };
    });
    assert.deepEqual(stateBeforeReload.persistedScore,[12,4],'The pending score is persisted before reload');
    host.on('request',request=>{
      if(!reloadRequestPredicate(request))return;
      try{
        const body=JSON.parse(request.postData()||'{}');
        reloadRpcRequests.push({seq:body.p_payload?.seq??null,score:body.p_payload?.courts?.[0]?.s?.[0]??null});
      }catch{}
    });
    await host.reload({waitUntil:'domcontentloaded'});
    await host.waitForFunction(() => typeof sb !== 'undefined' && !!sb && !!S?.sid, null, {timeout:15000});
    const reloadRequest=await reloadRequestPromise;
    const reloadBody=JSON.parse(reloadRequest.postData()||'{}');
    const reloadSentSeq=reloadBody.p_payload?.seq??null;
    const reloadResponse=await reloadRequest.response();
    const reloadResponseText=reloadResponse?await reloadResponse.text().catch(()=>null):null;
    const reloadRpcStatus=reloadResponse?.status()??null;
    await host.waitForFunction(()=>!PQBusy&&PQ.length===0,null,{timeout:10000});
    const reloadHostState=await host.evaluate(()=>({
      liveSeq:S.liveSeq,
      publishQueueLength:PQ.length,
      publishQueueBusy:PQBusy
    }));
    const reloadViewerWaitError=await viewer.waitForFunction(({seq})=>{
      const d=SV?.d;
      const received=SV?.receivedBroadcastSeqs||[];
      const outcome=d?.courts?.[0]?.s?.[0]===12&&Number.isSafeInteger(d.seq)&&d.seq>=seq;
      return received.includes(seq)||outcome;
    },{seq:reloadSentSeq},{timeout:10000}).then(()=>null).catch(error=>error.message);
    const reloadViewerState=await viewer.evaluate(()=>({
      channelState:SV?.status??null,
      lastSeq:SV?.d?.seq??null,
      receivedSeqs:SV?.receivedBroadcastSeqs||[],
      visibleScore:SV?.d?.courts?.[0]?.s?.[0]??null,
      visibleText:document.querySelector('#viewer')?.innerText||''
    }));
    const reloadDelivery={
      scoreVisible:reloadViewerState.visibleScore===12,
      broadcastReceived:reloadViewerState.receivedSeqs.includes(reloadSentSeq),
      ordered:Number.isSafeInteger(reloadViewerState.lastSeq)&&reloadViewerState.lastSeq>=reloadSentSeq
    };
    const reloadRpcReturnedError=reloadRpcStatus===null||reloadRpcStatus>=400||
      (reloadResponseText!==null&&(()=>{try{const parsed=JSON.parse(reloadResponseText);return !!(parsed&&typeof parsed==='object'&&(parsed.message||parsed.error))}catch{return false}})());
    const reloadDiagnostics={
      iteration,
      sentSeq:reloadSentSeq,
      hostRpc:{status:reloadRpcStatus,returnedError:reloadRpcReturnedError,response:reloadResponseText},
      host:{...reloadHostState,requestCount:reloadRpcRequests.length},
      viewer:reloadViewerState,
      delivery:reloadDelivery,
      waitError:reloadViewerWaitError
    };
    if(reloadRpcReturnedError||!reloadDelivery.scoreVisible||!reloadDelivery.broadcastReceived||!reloadDelivery.ordered){
      console.error('[NYORK HOST RELOAD BROADCAST FAIL] '+JSON.stringify(reloadDiagnostics));
    }
    assert.equal(reloadRpcReturnedError,false,'Reload state RPC must succeed');
    assert.equal(reloadRpcRequests.length,1,'Reload publishes the persisted host state exactly once');
    assert.ok(Number.isSafeInteger(reloadSentSeq),'The sent RPC payload contains a numeric sequence');
    assert.ok(reloadSentSeq>published.seq,'Host reload sends a sequence above the earlier value');
    assert.equal(reloadHostState.liveSeq,reloadSentSeq,'The sequence in the RPC body matches the host persisted sequence');
    assert.equal(reloadDelivery.scoreVisible,true,'Viewer shows the state saved before reload');
    assert.equal(reloadDelivery.broadcastReceived,true,'Viewer received a Broadcast carrying the sent sequence');
    assert.equal(reloadDelivery.ordered,true,'Viewer ordering is at or beyond the sent sequence');

    // Two host tabs share a persisted sequence; Web Locks serialize concurrent allocations.
    const secondHost=await hostContext.newPage();
    await secondHost.goto(APP,{waitUntil:'domcontentloaded'});
    await secondHost.waitForFunction(()=>typeof sb!=='undefined'&&!!sb&&!!S?.sid,null,{timeout:15000});
    const firstTabUpdate=await host.evaluate(async()=>{
      S.courts[0].score=[13,4];
      const payload=await sdata();
      const q=await publishSession(payload);
      return {seq:payload.seq,success:!q.error&&q.data===true,error:q.error?.message||null};
    });
    assert.equal(firstTabUpdate.success,true);
    await viewer.waitForFunction(({seq})=>SV?.lastBroadcastSeq===seq&&SV?.d?.courts?.[0]?.s?.[0]===13,{seq:firstTabUpdate.seq},{timeout:10000});
    await secondHost.waitForFunction(({seq})=>S.liveSeq>=seq,{seq:firstTabUpdate.seq},{timeout:5000});
    const secondTabUpdate=await secondHost.evaluate(async()=>{
      S.courts[0].score=[14,4];
      const payload=await sdata();
      const q=await publishSession(payload);
      return {seq:payload.seq,success:!q.error&&q.data===true,error:q.error?.message||null};
    });
    assert.equal(secondTabUpdate.success,true);
    assert.ok(secondTabUpdate.seq>firstTabUpdate.seq,'Second host tab allocates a higher sequence');
    const secondTabViewerWaitError=await viewer.waitForFunction(({seq})=>
      SV?.lastBroadcastSeq===seq&&SV?.d?.courts?.[0]?.s?.[0]===14,
      {seq:secondTabUpdate.seq},{timeout:10000}
    ).then(()=>null).catch(error=>error.message);
    if(secondTabViewerWaitError){
      const [firstHostState,secondHostState,viewerState]=await Promise.all([
        host.evaluate(()=>({
          sid:S.sid,liveSeq:S.liveSeq,score:S.courts?.[0]?.score||null,
          queueLength:PQ.length,queueBusy:PQBusy,inflightId:PQInflightId||null,
          queued:PQ.map(x=>({id:x.id,seq:x.payload?.seq,score:x.payload?.courts?.[0]?.s?.[0],kind:x.kind}))
        })),
        secondHost.evaluate(()=>({
          sid:S.sid,liveSeq:S.liveSeq,score:S.courts?.[0]?.score||null,
          queueLength:PQ.length,queueBusy:PQBusy,inflightId:PQInflightId||null,
          queued:PQ.map(x=>({id:x.id,seq:x.payload?.seq,score:x.payload?.courts?.[0]?.s?.[0],kind:x.kind}))
        })),
        viewer.evaluate(async()=>{
          let persisted=null,persistedError=null;
          try{
            const q=await viewerClient(SV.code).from('live_sessions').select('data,updated_at').eq('code',SV.code).maybeSingle();
            persisted=q.data?{seq:q.data.data?.seq??null,score:q.data.data?.courts?.[0]?.s?.[0]??null,updatedAt:q.data.updated_at}:null;
            persistedError=q.error?.message||null
          }catch(e){persistedError=e.message}
          return {
            channelState:SV?.status??null,visibleSeq:SV?.d?.seq??null,
            lastBroadcastSeq:SV?.lastBroadcastSeq??null,
            receivedBroadcastSeqs:SV?.receivedBroadcastSeqs||[],
            visibleScore:SV?.d?.courts?.[0]?.s?.[0]??null,
            visibleText:document.querySelector('#viewer')?.innerText||'',
            persisted,persistedError
          }
        })
      ]);
      console.error('[NYORK SECOND HOST BROADCAST FAIL] '+JSON.stringify({
        iteration,firstTabUpdate,secondTabUpdate,
        firstHostState,secondHostState,viewerState,pageErrors:viewerPageErrors,
        waitError:secondTabViewerWaitError
      }));
    }
    assert.equal(secondTabViewerWaitError,null,'Viewer receives the second host tab snapshot');

    // Restoring a stale backup intentionally creates a new Live View identity (host key is excluded).
    const restored=await host.evaluate(async()=>{
      const backup=JSON.parse(expData());
      backup.state.liveSeq=1;
      const baseline=Date.now();
      S=cleanState(backup);
      S.ho=false;S.hoff=0;S.sid='';S.sh='';S.rid='';
      clearPublishQueue();
      resumeLiveSequence();
      ensureLiveIdentity();
      S.courts[0].score=[20,4];
      const payload=await sdata();
      const q=await publishSession(payload);
      return {code:S.sid,seq:payload.seq,baseline,success:!q.error&&q.data===true,error:q.error?.message||null};
    });
    assert.equal(restored.success,true,'Restored backup can publish a new Live View session');
    assert.notEqual(restored.code,liveCode,'Backup restore deliberately issues a new Live View code');
    assert.ok(restored.seq>=restored.baseline,'Stale imported sequence resumes from the clock baseline');
    liveCode=restored.code;
    await viewer.goto(APP+'#s='+liveCode,{waitUntil:'domcontentloaded'});
    await viewer.waitForFunction(({seq})=>SV?.status==='SUBSCRIBED'&&SV?.d?.seq===seq&&SV?.d?.courts?.[0]?.s?.[0]===20,{seq:restored.seq},{timeout:15000});
    const restoredFollowup=await host.evaluate(async()=>{
      S.courts[0].score=[21,4];
      const payload=await sdata();
      const q=await publishSession(payload);
      return {seq:payload.seq,success:!q.error&&q.data===true,error:q.error?.message||null};
    });
    assert.equal(restoredFollowup.success,true);
    assert.ok(restoredFollowup.seq>restored.seq,'Restored host continues with a higher sequence');
    await viewer.waitForFunction(({seq})=>SV?.lastBroadcastSeq===seq&&SV?.d?.courts?.[0]?.s?.[0]===21,{seq:restoredFollowup.seq},{timeout:10000});

    // Two state publishes happen back-to-back without waiting for the viewer.
    // The final state must win even if the first Broadcast arrives late.
    const rapidUpdates=await host.evaluate(async()=>{
      S.courts[0].score=[40,4];
      const firstPayload=await sdata();
      const firstResult=await publishSession(firstPayload);
      S.courts[0].score=[41,4];
      const secondPayload=await sdata();
      const secondResult=await publishSession(secondPayload);
      return {
        first:{seq:firstPayload.seq,success:!firstResult.error&&firstResult.data===true,error:firstResult.error?.message||null},
        second:{seq:secondPayload.seq,success:!secondResult.error&&secondResult.data===true,error:secondResult.error?.message||null}
      };
    });
    assert.equal(rapidUpdates.first.success,true,'First rapid publish succeeds');
    assert.equal(rapidUpdates.second.success,true,'Second rapid publish succeeds');
    assert.ok(rapidUpdates.second.seq>rapidUpdates.first.seq,'Rapid publishes receive increasing sequences');
    await viewer.waitForFunction(({seq,score})=>{
      const d=SV?.d;
      const received=SV?.receivedBroadcastSeqs||[];
      return received.includes(seq)||(d?.courts?.[0]?.s?.[0]===score&&Number.isSafeInteger(d.seq)&&d.seq>=seq);
    },{seq:rapidUpdates.second.seq,score:41},{timeout:10000});
    const rapidViewerState=await viewer.evaluate(()=>({
      lastSeq:SV?.d?.seq??null,
      receivedSeqs:SV?.receivedBroadcastSeqs||[],
      visibleScore:SV?.d?.courts?.[0]?.s?.[0]??null,
      channelState:SV?.status??null
    }));
    assert.equal(rapidViewerState.visibleScore,41,'Viewer ends on the second rapid state');
    assert.ok(rapidViewerState.receivedSeqs.includes(rapidUpdates.second.seq),'Viewer received the second rapid Broadcast');
    assert.ok(Number.isSafeInteger(rapidViewerState.lastSeq)&&rapidViewerState.lastSeq>=rapidUpdates.second.seq,'Viewer sequence does not regress after rapid publishes');

    let lastSequence=rapidUpdates.second.seq;

    const broadcastIterations = Math.max(2,Math.min(5,Number(process.env.NYORK_BROADCAST_ITERATIONS)||2));
    const broadcastLatencies=[];
    let realtimeUpdate=false;
    for(let i=0;i<broadcastIterations;i++){
      const score=i+22;
      const updated=await host.evaluate(async ({score})=>{
        S.courts[0].score=[score,4];
        const payload=await sdata();
        const q=await publishSession(payload);
        return {seq:payload.seq,success:!q.error&&q.data===true,error:q.error?.message||null};
      },{score});
      assert.equal(updated.success,true,'Nyork sequence publish '+updated.seq+' must succeed');
      const seq=updated.seq,startedAt=Date.now();
      try{
        await viewer.waitForFunction(({seq,score})=>{
          const text=document.querySelector('#viewer')?.innerText||'';
          return SV?.lastBroadcastSeq===seq&&SV?.d?.seq===seq&&SV?.d?.courts?.[0]?.s?.[0]===score&&text.includes(String(score));
        },{seq,score},{timeout:10000});
      }catch(error){
        const viewerText=await viewer.locator('#viewer').innerText().catch(()=>'');
        console.error('[NYORK BROADCAST FAIL] '+JSON.stringify({
          iteration,sequence:seq,score,hostUpdateSucceeded:updated.success,
          viewerConnected:viewerText.includes('LIVE · CONNECTED'),viewerText,error:error.message
        }));
        throw error;
      }
      lastSequence=seq;
      broadcastLatencies.push(Date.now()-startedAt);
      await viewer.waitForTimeout(200);
    }
    const liveViewerMetrics=await viewer.evaluate(()=>viewerDiagnostics());
    assert.ok(liveViewerMetrics.broadcastsReceived>=broadcastIterations,'Viewer monitor counts incoming Realtime Broadcast messages');
    assert.ok(liveViewerMetrics.broadcastsAccepted>=broadcastIterations,'Viewer monitor counts accepted Realtime updates');
    assert.ok(liveViewerMetrics.arrivalAges.length>=1,'Viewer monitor samples arrival age from database update timestamps');
    realtimeUpdate=true;

    // Simulate a sleeping/offline viewer: host publishes while the viewer is disconnected.
    const navigationsBeforeReconnect=viewerMainNavigations;
    await viewerContext.setOffline(true);
    await viewer.waitForFunction(()=>navigator.onLine===false,null,{timeout:5000});
    const reconnectScore=31;
    const offlinePublish=await host.evaluate(async ({score})=>{
      S.courts[0].score=[score,4];
      const payload=await sdata();
      const q=await publishSession(payload);
      return {seq:payload.seq,success:!q.error&&q.data===true,error:q.error?.message||null};
    },{score:reconnectScore});
    assert.equal(offlinePublish.success,true,'The host publishes while the viewer is offline');
    const reconnectSeq=offlinePublish.seq;
    await viewerContext.setOffline(false);
    await viewer.waitForFunction(({seq,score})=>{
      const text=document.querySelector('#viewer')?.innerText||'';
      return navigator.onLine&&SV?.status==='SUBSCRIBED'&&SV?.d?.seq===seq&&SV?.d?.courts?.[0]?.s?.[0]===score&&text.includes('LIVE · CONNECTED');
    },{seq:reconnectSeq,score:reconnectScore},{timeout:15000});
    assert.equal(viewerMainNavigations,navigationsBeforeReconnect,'Reconnect must recover without a page reload');
    const reconnectMetrics=await viewer.evaluate(()=>viewerDiagnostics());
    assert.ok(reconnectMetrics.reconnectAttempts>=1,'Viewer monitor counts connection recovery attempts');
    const reconnectUpdate=true;

    // Hostile strings pass the RPC's string-type validation and are delivered by the DB trigger.
    const hostilePlayer='<img src=x onerror=alert(1)>';
    const hostileCourt='<svg/onload=alert(2)>';
    const hostilePublish=await host.evaluate(async ({hostilePlayer,hostileCourt})=>{
      S.courts[0].name=hostileCourt;
      S.courts[0].isActive=true;
      S.courts[0].players=[hostilePlayer,'Bob','Cara','Dan'];
      S.courts[0].score=[5,4];
      const payload=await sdata();
      const q=await publishSession(payload);
      return {seq:payload.seq,success:!q.error&&q.data===true,error:q.error?.message||null};
    },{hostilePlayer,hostileCourt});
    const hostileSeq=hostilePublish.seq;
    assert.equal(hostilePublish.success,true,'The DB guard accepts hostile text values without changing their JSON types');
    try{
      await viewer.waitForFunction(({seq,hostileCourt})=>{
        const text=(document.querySelector('#viewer')?.innerText||'').toLowerCase();
        return SV?.lastBroadcastSeq===seq&&SV?.d?.seq===seq&&SV?.d?.courts?.[0]?.n===hostileCourt&&text.includes(hostileCourt.toLowerCase());
      },{seq:hostileSeq,hostileCourt},{timeout:10000});
    }catch(error){
      const diagnostic=await viewer.evaluate(async({seq})=>{
        let persisted=null,persistedError=null;
        try{
          const q=await viewerClient(SV.code).from('live_sessions').select('data,updated_at').eq('code',SV.code).maybeSingle();
          persisted=q.data?.data?.seq??null;
          persistedError=q.error?.message||null;
        }catch(e){persistedError=e.message}
        return {
          status:SV?.status||null,
          visibleSequence:SV?.d?.seq??null,
          lastBroadcastSequence:SV?.lastBroadcastSeq??null,
          persistedSequence:persisted,
          persistedError,
          visibleText:document.querySelector('#viewer')?.innerText||''
        };
      },{seq:hostileSeq});
      console.error('[NYORK HOSTILE BROADCAST FAIL] '+JSON.stringify({iteration,hostileSeq,hostilePublish,diagnostic,error:error.message}));
      throw error;
    }
    await viewer.waitForTimeout(100);
    const hostileBroadcastDom=await viewer.locator('#viewer').evaluate(el=>({
      text:el.innerText,
      images:el.querySelectorAll('img').length,
      svgs:el.querySelectorAll('svg').length,
      scripts:el.querySelectorAll('script').length
    }));
    assert.ok(hostileBroadcastDom.text.toLowerCase().includes(hostileCourt.toLowerCase()),'The hostile court name remains literal visible text, regardless of CSS text-transform');
    assert.equal(hostileBroadcastDom.images,0,'A hostile Broadcast player name cannot create an img element');
    assert.equal(hostileBroadcastDom.svgs,0,'A hostile Broadcast court name cannot create an SVG element');
    assert.equal(hostileBroadcastDom.scripts,0,'A hostile Broadcast cannot create a script element');
    assert.equal(viewerDialogs.length,0,'A hostile Broadcast cannot trigger a JavaScript dialog');
    assert.equal(viewerPageErrors.length,0,'A hostile Broadcast cannot create a page error');

    // Exercise client-side coercion and size limits even for malformed callback input.
    const clientBoundary=await viewer.evaluate(({seq,hostilePlayer})=>{
      const malformed={
        code:SV.code,updated_at:new Date().toISOString(),
        data:{
          seq,t:'99',wb:'2',
          courts:[{n:'Court 1',a:true,p:[hostilePlayer,'Bob','Cara','Dan'],s:['<img src=x onerror=alert(9)>','9']}],
          nx:[],up:[],tm:null,q:[],lb:[]
        }
      };
      const accepted=applyLiveSessionBroadcast({payload:malformed});
      const coercedScore=SV.d.courts[0].s[0];
      const afterCoercion=SV.d;
      const lastGoodCourt=SV.d.courts[0].n;
      const oversized={
        code:SV.code,updated_at:new Date().toISOString(),
        data:{...SV.d,seq:seq+1,q:['x'.repeat(200001)]}
      };
      const oversizedAccepted=applyLiveSessionBroadcast({payload:oversized});
      const visibleText=document.querySelector('#viewer')?.innerText||'';
      return {
        accepted,coercedScore,
        images:document.querySelectorAll('#viewer img').length,
        svgs:document.querySelectorAll('#viewer svg').length,
        scripts:document.querySelectorAll('#viewer script').length,
        oversizedAccepted,
        statePreserved:SV.d===afterCoercion,
        lastGoodVisible:visibleText.toLowerCase().includes(String(lastGoodCourt).toLowerCase()),
        rejectionNotice:visibleText.includes('update was rejected')
      };
    },{seq:hostileSeq+1,hostilePlayer});
    assert.equal(clientBoundary.accepted,true);
    assert.equal(clientBoundary.coercedScore,0,'Invalid numeric strings become zero at the client boundary');
    assert.equal(clientBoundary.images,0);
    assert.equal(clientBoundary.svgs,0);
    assert.equal(clientBoundary.scripts,0);
    assert.equal(clientBoundary.oversizedAccepted,false,'Payloads above 200 KB are rejected by the client handler');
    assert.equal(clientBoundary.statePreserved,true);
    assert.equal(clientBoundary.lastGoodVisible,true,'Last good court remains visible');
    assert.equal(clientBoundary.rejectionNotice,true,'Viewer displays the rejected-update notice');
    assert.equal(viewerDialogs.length,0);

    const broadcastAverageLatencyMs=Math.round(broadcastLatencies.reduce((a,b)=>a+b,0)/Math.max(1,broadcastLatencies.length));
    const broadcastMaxLatencyMs=Math.max(...broadcastLatencies);

    const ended = await host.evaluate(async () => {
      S.ended = false;
      S.rr = false;
      S.lr = false;
      S.rpf = false;
      S.rid = '';
      S.name = 'Nyork two-browser QA';
      S.target = 11;
      S.wb = 2;
      S.queue = [];
      S.log = [{
        p: ['Alice', 'Bob', 'Cara', 'Dan'],
        s: [11, 9], w: 0, c: 'Court 1', tg: 11, t: Date.now(), d: 2
      }];
      S.courts = [{id: 1, name: 'Court 1', isActive: false, players: [], score: [0, 0], mid: '', t: 0}];
      await endS();
      return {code: S.rid, success: S.rr, error: S.rpf ? 'results publish rejected' : null};
    });
    resultsCode = ended.code;
    console.log('[NYORK RESULTS CONTROL] ' + JSON.stringify({...ended, liveCode}));
    assert.match(resultsCode, /^[A-Z2-9]{10}$/);
    assert.equal(ended.success, true, 'Nyork Results publish must succeed');

    // Use a fresh viewer page rather than switching hashes in the Live View page:
    // the app reloads on hashchange, so a separate page avoids racing the reload.
    const resultsViewer = await viewerContext.newPage();
    const resultsApiResponses = [];
    resultsViewer.on('response', async response => {
      if (!response.url().includes('/rest/v1/pickle_results')) return;
      let body = '';
      try { body = (await response.text()).slice(0, 1200); } catch {}
      resultsApiResponses.push({status:response.status(),body});
    });
    resultsViewer.on('requestfailed', request => {
      if (request.url().includes('/rest/v1/pickle_results')) {
        resultsApiResponses.push({failed:request.failure()?.errorText || 'request failed'});
      }
    });
    await resultsViewer.goto(APP + '#r=' + resultsCode, {waitUntil: 'domcontentloaded'});
    await resultsViewer.waitForFunction(() => !!(RA?.d || RA?.missing), null, {timeout: 15000});
    const archivedPageState = await resultsViewer.evaluate(() => ({
      code: RA?.code || null,
      missing: !!RA?.missing,
      data: RA?.d || null,
      text: document.querySelector('#viewer')?.innerText || ''
    }));
    console.log('[NYORK ARCHIVED VIEWER] ' + JSON.stringify({
      pageState:archivedPageState,
      responses:resultsApiResponses
    }));
    assert.equal(archivedPageState.code, resultsCode);
    assert.equal(archivedPageState.missing, false, 'Results row must be readable to the anonymous viewer');
    assert.ok(archivedPageState.data, 'Archived viewer must receive a saved Results object');
    assert.match(archivedPageState.text, /Nyork two-browser QA/i);
    assert.match(archivedPageState.text, /11-9/);

    console.log('[NYORK TWO-BROWSER PASS] ' + JSON.stringify({
      iteration,
      hostBrowser: 'Desktop Chrome',
      viewerBrowser: 'iPhone 13 isolated profile',
      liveCode,
      initialViewerLoaded: true,
      hostUpdateSucceeded: true,
      realtimeUpdate,
      broadcastIterations,
      broadcastAverageLatencyMs,
      broadcastMaxLatencyMs,
      staleSnapshotGuard: true,
      hostReloadSequence: true,
      backupRestoreSequence: true,
      secondHostTabSequence: true,
      rejectedMessageKeepsLastGoodState: true,
      reconnectUpdate,
      reconnectWithoutReload: true,
      hostileBroadcastSafe: true,
      clientBoundaryChecks: true,
      resultsCode,
      resultsViewerLoaded: true,
      hostPublishDiagnostics: true,
      viewerConnectionDiagnostics: true,
      viewerStaleUpdateCounters: true,
      viewerArrivalAgeMetrics: true,
      viewerReconnectMetrics: true
    }));
  } finally {
    await Promise.all([hostContext.close(), viewerContext.close()]);
    await browser.close();
  }
}

async function main(){
  const repeatCount=Math.max(1,Math.min(15,Number(process.env.NYORK_REPEAT_COUNT)||1));
  for(let iteration=1;iteration<=repeatCount;iteration++){
    console.log('[NYORK REPEAT START] '+iteration+'/'+repeatCount);
    await runNyorkOnce(iteration);
  }
  console.log('[NYORK REPEAT COMPLETE] '+JSON.stringify({runs:repeatCount,success:true}));
}
main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
