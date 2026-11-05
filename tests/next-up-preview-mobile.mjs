import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const VIEWPORTS = [
  [320, 740], [360, 780], [390, 844], [430, 932],
  [768, 1024], [1023, 900], [1024, 800], [1440, 900],
];
const browser = await chromium.launch({headless:true});
const results = [];

try {
  for (const theme of ['dark','light']) {
    const context = await browser.newContext({
      viewport:{width:320,height:740},
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
      await page.locator('#qpreview').waitFor({state:'visible',timeout:10000});
      await page.evaluate(()=>{
        const longName='AlexandriaVeryLongPickleballPlayerName';
        S.queue=Array.from({length:24},(_,i)=>i===0?longName:'Player '+String(i+1).padStart(2,'0'));
        S.waiting=[];
        S.rest={'player 06':1,'player 13':1,'player 20':1};
        S.eq=false;
        S.ws=false;
        S.md='soc';
        S.log=[];
        S.gp={};
        S.wt=normalizeWaitTimes(S.queue,{});
        S.lv={};
        render();
      });

      const content=await page.evaluate(()=>({
        groupCards:document.querySelectorAll('#qpreviewGroups .qpreview-group').length,
        restingText:document.querySelector('#qpreviewRest')?.innerText||'',
        reason:document.querySelector('#qpreviewReason')?.innerText||'',
        previewText:document.querySelector('#qpreviewGroups')?.innerText||'',
        firstGroup:document.querySelector('#unxb')?.innerText||'',
      }));
      assert.equal(content.groupCards,2,'two following groups should be previewed');
      assert.match(content.restingText,/Resting · skipped \(3\)/);
      assert.match(content.restingText,/Player 06/);
      assert.match(content.restingText,/Player 13/);
      assert.match(content.restingText,/Player 20/);
      assert.match(content.reason,/Why this pick\?/);
      for(const resting of ['Player 06','Player 13','Player 20']){
        assert.ok(!content.previewText.includes(resting),resting+' must not appear in an upcoming group');
      }
      assert.ok(content.firstGroup.includes('Team 1')&&content.firstGroup.includes('Team 2'));

      // The preview helper must be read-only: building future groups must not
      // remove players, alter rest flags, or change the host's selected queue.
      const stateBefore=await page.evaluate(()=>JSON.stringify(S));
      await page.evaluate(()=>previewFollowingGroups(3));
      const stateAfter=await page.evaluate(()=>JSON.stringify(S));
      assert.equal(stateAfter,stateBefore,'queue preview must not mutate live session state');

      // Exercise Equal Sit-outs explanation and its real picker ordering.
      await page.evaluate(()=>{
        S.eq=true;
        S.gp['player 01']=9;
        S.gp['player 02']=8;
        S.gp['player 03']=0;
        S.gp['player 04']=0;
        render();
      });
      const equalReason=await page.locator('#qpreviewReason').innerText();
      assert.match(equalReason,/Equal sit-outs is on/);

      // Exercise the actual Stack and Stats tabs at the narrowest supported width.
      await page.setViewportSize({width:320,height:740});
      await page.locator('#nvs').click();
      await page.locator('#sstk').waitFor({state:'visible'});
      const stackMetrics=await page.evaluate(()=>({
        root:document.documentElement.scrollWidth,
        body:document.body.scrollWidth,
        panel:document.querySelector('#sstk').getBoundingClientRect().right,
        rows:[...document.querySelectorAll('#ql li')].map(el=>el.getBoundingClientRect().right),
      }));
      assert.ok(stackMetrics.root<=321&&stackMetrics.body<=321,'320px Stack tab overflow: '+JSON.stringify(stackMetrics));
      assert.ok(stackMetrics.panel<=321,'320px Stack panel extends beyond viewport');
      assert.ok(stackMetrics.rows.every(right=>right<=321),'320px player row extends beyond viewport');
      await page.locator('#nvt').click();
      const statsMetrics=await page.evaluate(()=>({
        root:document.documentElement.scrollWidth,
        body:document.body.scrollWidth,
      }));
      assert.ok(statsMetrics.root<=321&&statsMetrics.body<=321,'320px Stats tab overflow: '+JSON.stringify(statsMetrics));
      await page.locator('#nvp').click();
      await page.locator('#qpreview').waitFor({state:'visible'});

      for(const [width,height] of VIEWPORTS){
        await page.setViewportSize({width,height});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const metrics=await page.evaluate(()=>{
          const rect=el=>{
            if(!el)return null;
            const r=el.getBoundingClientRect();
            return {left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)};
          };
          const panel=document.querySelector('#sun');
          const preview=document.querySelector('#qpreview');
          const cards=[...document.querySelectorAll('#qpreviewGroups .qpreview-group')];
          const actionButtons=[...document.querySelectorAll('#sun button')].filter(b=>getComputedStyle(b).display!=='none');
          return {
            width:innerWidth,
            rootScrollWidth:document.documentElement.scrollWidth,
            bodyScrollWidth:document.body.scrollWidth,
            panel:rect(panel),
            preview:rect(preview),
            previewClientWidth:preview?.clientWidth??0,
            previewScrollWidth:preview?.scrollWidth??0,
            cards:cards.map(rect),
            buttonMinHeights:actionButtons.map(b=>Math.round(b.getBoundingClientRect().height)),
            navVisible:getComputedStyle(document.querySelector('#nav')).display!=='none',
          };
        });
        assert.ok(metrics.rootScrollWidth<=width+1,theme+' '+width+'px root horizontal overflow: '+JSON.stringify(metrics));
        assert.ok(metrics.bodyScrollWidth<=width+1,theme+' '+width+'px body horizontal overflow: '+JSON.stringify(metrics));
        assert.ok(metrics.previewScrollWidth<=metrics.previewClientWidth+1,theme+' '+width+'px preview content overflow: '+JSON.stringify(metrics));
        assert.ok(metrics.panel.left>=-1&&metrics.panel.right<=width+1,theme+' '+width+'px Up Next panel outside viewport');
        assert.ok(metrics.cards.every(r=>r.left>=-1&&r.right<=width+1),theme+' '+width+'px a preview card extends outside viewport');
        if(width<=639){
          assert.ok(metrics.buttonMinHeights.every(h=>h>=44),theme+' '+width+'px Up Next action button below 44px');
          assert.equal(metrics.navVisible,true,'phone bottom navigation should be visible');
        }
        if(width>=1024)assert.equal(metrics.navVisible,false,'desktop should use full layout instead of bottom tabs');
        results.push({theme,viewport:width+'x'+height,pass:true,metrics});
      }

      // Confirm the preview stays accessible when switching among mobile tabs.
      await page.setViewportSize({width:390,height:844});
      await page.locator('#nvs').click();
      await page.locator('#sstk').waitFor({state:'visible'});
      await page.locator('#nvp').click();
      await page.locator('#qpreview').waitFor({state:'visible'});
      assert.ok(await page.locator('#qpreviewGroups .qpreview-group').count()===2);
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({test:'Next-Up preview and mobile layout',checked:results.length,results},null,2));
  console.log('PASS: preview is read-only, rest-aware, and fits all tested viewports in both themes.');
} finally {
  await browser.close();
}
