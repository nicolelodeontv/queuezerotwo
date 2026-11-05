import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const VIEWPORTS = [320, 390, 768, 1024, 1440];
const browser = await chromium.launch({headless:true});
const results = [];

try {
  for (const theme of ['dark','light']) {
    const context = await browser.newContext({
      viewport:{width:390,height:844},
      serviceWorkers:'block',
      locale:'en-US',
      hasTouch:true,
    });
    await context.addInitScript(value => {
      try { localStorage.setItem('qzt_theme',value); } catch {}
    },theme);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname.endsWith('.supabase.co'))return route.abort();
      return route.continue();
    });
    const page=await context.newPage();
    try {
      await page.goto(APP_URL,{waitUntil:'load',timeout:30000});
      await page.waitForFunction(()=>typeof buildLiveSessionData==='function'&&typeof previewFollowingGroups==='function');

      const setup=await page.evaluate(()=>{
        localStorage.clear();
        S=mk();
        S.queue=['Ava','Ben','Cara','Drew','AlexandriaVeryLongPickleballPlayerName','Finn','Gia','Hugo','Iris','Jude','Kai','Luna','Milo','Nina','Omar','Pia','Quinn','Rae','Sage','Theo','Uma','Vik','Wren','Zane'];
        S.waiting=[];
        S.rest={finn:1,nina:1,uma:1};
        S.wt=normalizeWaitTimes(S.queue,{});
        S.eq=false;
        S.ws=false;
        S.md='soc';
        S.sd=7;
        S.gp={};
        S.fair={};
        S.lv={};
        S.log=[];
        S.target=11;
        S.wb=2;
        S.name='Live View preview regression';
        S.courts=[
          {id:1,name:'Court 1',isActive:true,players:['Court A','Court B','Court C','Court D'],score:[6,4],mid:'preview-court-1',t:Date.now()-5*60_000,hold:null,stk:0},
          {id:2,name:'Court 2',isActive:false,players:[],score:[0,0],mid:'',t:0,hold:null,stk:0},
        ];
        const protectedState=()=>JSON.stringify({
          queue:S.queue,waiting:S.waiting,rest:S.rest,wt:S.wt,eq:S.eq,ws:S.ws,md:S.md,sd:S.sd,
          gp:S.gp,fair:S.fair,lv:S.lv,log:S.log,courts:S.courts,
        });
        const before=protectedState();
        const expected=previewFollowingGroups(3);
        const afterPreview=protectedState();
        const payload=buildLiveSessionData();
        const afterBuild=protectedState();
        SV={code:'LOCAL-TEST',d:normalizeLiveSessionPayload(payload),status:'SUBSCRIBED',ts:Date.now()};
        $('app').classList.add('hidden');
        $('viewer').classList.remove('hidden','max-w-xl');
        $('viewer').classList.add('max-w-3xl');
        $('nav').classList.add('hidden');
        render();
        return {before,afterPreview,afterBuild,expected,payload};
      });

      assert.equal(setup.afterPreview,setup.before,'following-group preview must not mutate host state');
      assert.equal(setup.afterBuild,setup.before,'publishing a Live View forecast must not change queue, rest, fairness, or picker state');
      assert.equal(setup.payload.ws,false);
      assert.equal(setup.payload.fg.length,2,'two future groups should be included when enough players are eligible');
      assert.deepEqual(
        setup.payload.fg.map(g=>g.t),
        setup.expected.map(g=>g.teams),
        'Live View must publish the same future teams calculated by the host picker',
      );
      assert.deepEqual(setup.payload.fg.map(g=>g.n),[2,3]);
      assert.equal(setup.payload.nx.length,4,'the current Up Next group remains separate from future groups');
      for(const resting of ['Finn','Nina','Uma']){
        assert.ok(!setup.payload.fg.some(g=>g.t.includes(resting)),resting+' must be skipped from every future group');
      }

      const normalized=await page.evaluate(data=>normalizeLiveSessionPayload(data),setup.payload);
      assert.equal(normalized.fg.length,2);
      assert.deepEqual(normalized.fg.map(g=>g.n),[2,3]);
      assert.equal(normalized.ws,false);

      const cards=page.locator('#liveFollowingGroups .live-following-group');
      assert.equal(await cards.count(),2,'shared Live View should render two following-group cards');
      const cardTexts=await cards.allInnerTexts();
      for(const group of setup.payload.fg){
        const card=cardTexts.find(text=>text.includes('Group '+group.n));
        assert.ok(card,'Group '+group.n+' should have a rendered card');
        assert.match(card,/Team 1/);
        assert.match(card,/Team 2/);
        for(const player of group.t)assert.ok(card.includes(player),'rendered group should show '+player);
      }
      const restNote=await page.locator('#liveFollowingGroups').innerText();
      assert.match(restNote,/Resting · skipped \(3\)/);
      for(const resting of ['Finn','Nina','Uma'])assert.ok(restNote.includes(resting));

      // Check narrow and wide layouts, with long names in the forecast.
      for(const width of VIEWPORTS){
        await page.setViewportSize({width,height:900});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const metrics=await page.evaluate(()=>({
          viewport:innerWidth,
          root:document.documentElement.scrollWidth,
          body:document.body.scrollWidth,
          viewer:(()=>{const r=document.querySelector('#viewer').getBoundingClientRect();return {left:r.left,right:r.right}})(),
          cards:[...document.querySelectorAll('#liveFollowingGroups .live-following-group')].map(el=>{
            const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:el.scrollWidth,client:el.clientWidth};
          }),
          longNameVisible:document.querySelector('#liveFollowingGroups')?.innerText.includes('AlexandriaVeryLongPickleballPlayerName')||false,
        }));
        assert.ok(metrics.root<=width+1&&metrics.body<=width+1,theme+' '+width+'px Live View horizontal overflow: '+JSON.stringify(metrics));
        assert.ok(metrics.viewer.left>=-1&&metrics.viewer.right<=width+1,theme+' '+width+'px Live View content is outside viewport: '+JSON.stringify(metrics));
        assert.ok(metrics.cards.every(card=>card.left>=-1&&card.right<=width+1&&card.scroll<=card.client+1),theme+' '+width+'px following-group card overflow: '+JSON.stringify(metrics));
        assert.equal(metrics.longNameVisible,true,'long player name should remain visible in the future-group forecast');
        results.push({theme,viewport:width,pass:true});
      }

      // Equal Sit-outs and Balanced mode use the exact same host picker/splitter.
      const equal=await page.evaluate(()=>{
        S.eq=true;
        S.md='bal';
        S.gp=Object.fromEntries(S.queue.map((name,i)=>[name.toLowerCase(),i<4?20:0]));
        S.lv=Object.fromEntries(S.queue.map((name,i)=>[name.toLowerCase(),i%6]));
        S.wt=Object.fromEntries(S.queue.map((name,i)=>[name.toLowerCase(),Date.now()-(S.queue.length-i)*1000]));
        const payload=buildLiveSessionData();
        const expected=previewFollowingGroups(3);
        SV.d=normalizeLiveSessionPayload(payload);
        render();
        return {payload,expected};
      });
      assert.ok(!equal.payload.nx.includes('Ava'),'Equal Sit-outs should prioritize players with fewer games for the current call');
      assert.deepEqual(equal.payload.fg.map(g=>g.t),equal.expected.map(g=>g.teams));
      assert.equal(await cards.count(),2);

      // Winners Stay cannot publish misleading four-player forecasts.
      const winners=await page.evaluate(()=>{
        S.ws=true;
        const payload=buildLiveSessionData();
        SV.d=normalizeLiveSessionPayload(payload);
        render();
        return {ws:payload.ws,fg:payload.fg,text:document.querySelector('#liveFollowingGroups')?.innerText||''};
      });
      assert.equal(winners.ws,true);
      assert.deepEqual(winners.fg,[]);
      assert.equal(await page.locator('#liveFollowingGroups .live-following-group').count(),0);
      assert.match(winners.text,/Winners Stay is on/);
      assert.match(winners.text,/next two eligible players challenge/i);

      // Older snapshots remain readable and clearly explain why no forecast appears.
      const legacy=await page.evaluate(()=>{
        const old={...SV.d};
        delete old.fg;
        delete old.ws;
        SV.d=normalizeLiveSessionPayload(old);
        render();
        return {fg:SV.d.fg,text:document.querySelector('#liveFollowingGroups')?.innerText||''};
      });
      assert.equal(legacy.fg,null);
      assert.match(legacy.text,/predates the following-group preview/i);

      // Malformed groups are discarded by payload normalization.
      const malformed=await page.evaluate(()=>{
        const safe=normalizeLiveSessionPayload({q:['A','B','C','D'],fg:[
          {t:['One','Two','Three','Four']},
          {t:['Only one']},
          null,
        ]});
        return safe.fg;
      });
      assert.deepEqual(malformed,[{n:2,t:['One','Two','Three','Four']}]);
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({test:'Live View following groups',checked:results.length,results},null,2));
  console.log('PASS: shared Live View forecasts use the host picker, skip resting players, and do not mutate host state.');
} finally {
  await browser.close();
}
