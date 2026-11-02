import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP = process.env.APP_URL || 'http://127.0.0.1:4173/';
const OUT = path.resolve('artifacts/320-theme-check');
fs.mkdirSync(OUT, {recursive:true});

const browser = await chromium.launch({headless:true});
const results = [];

try {
  for (const theme of ['dark','light']) {
    const context = await browser.newContext({
      viewport:{width:320,height:640},
      serviceWorkers:'block',
      locale:'en-US'
    });
    await context.addInitScript(value => {
      try { localStorage.setItem('qzt_theme',value); } catch {}
    },theme);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname.endsWith('.supabase.co')) return route.abort();
      return route.continue();
    });
    const page=await context.newPage();
    try {
      await page.goto(APP,{waitUntil:'load',timeout:30000});
      await page.locator('#app').waitFor({state:'visible',timeout:10000});
      await page.locator('#mnb').waitFor({state:'visible',timeout:10000});
      await page.evaluate(async()=>{
        await document.fonts.ready;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      });
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme||'dark'),theme,theme+' theme applied');

      const closed=await page.evaluate(()=>({
        width:innerWidth,
        rootScrollWidth:document.documentElement.scrollWidth,
        bodyScrollWidth:document.body.scrollWidth,
        menuVisible:!!document.querySelector('#mnb')&&getComputedStyle(document.querySelector('#mnb')).display!=='none',
        liveButtonVisible:(()=>{const e=document.querySelector('button[onclick="live()"]');return !!e&&e.getClientRects().length>0})(),
        navVisible:!!document.querySelector('#nav')&&getComputedStyle(document.querySelector('#nav')).display!=='none'
      }));
      assert.ok(closed.rootScrollWidth<=321,'closed '+theme+' document horizontal overflow: '+JSON.stringify(closed));
      assert.ok(closed.bodyScrollWidth<=321,'closed '+theme+' body horizontal overflow: '+JSON.stringify(closed));
      assert.equal(closed.menuVisible,true);
      assert.equal(closed.liveButtonVisible,true);
      assert.equal(closed.navVisible,true);
      await page.screenshot({path:path.join(OUT,theme+'-closed.png'),fullPage:true});

      await page.locator('#mnb').click();
      await page.locator('#qmenu').waitFor({state:'visible',timeout:5000});
      await page.locator('#qmenu #exp').waitFor({state:'visible',timeout:5000});
      await page.locator('#qmenu #impbtn').waitFor({state:'visible',timeout:5000});
      const open=await page.evaluate(()=>{
        const menu=document.querySelector('#qmenu'),r=menu.getBoundingClientRect();
        return {
          width:innerWidth,
          rootScrollWidth:document.documentElement.scrollWidth,
          bodyScrollWidth:document.body.scrollWidth,
          menuVisible:getComputedStyle(menu).display!=='none',
          menuRect:{left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)},
          exportVisible:document.querySelector('#qmenu #exp')?.getClientRects().length>0,
          importVisible:document.querySelector('#qmenu #impbtn')?.getClientRects().length>0,
          liveButtonVisible:(()=>{const e=document.querySelector('button[onclick="live()"]');return !!e&&e.getClientRects().length>0})()
        };
      });
      assert.ok(open.rootScrollWidth<=321,'open '+theme+' document horizontal overflow: '+JSON.stringify(open));
      assert.ok(open.bodyScrollWidth<=321,'open '+theme+' body horizontal overflow: '+JSON.stringify(open));
      assert.equal(open.menuVisible,true);
      assert.ok(open.menuRect.left>=-1&&open.menuRect.right<=321,'menu panel outside viewport: '+JSON.stringify(open));
      assert.equal(open.exportVisible,true);
      assert.equal(open.importVisible,true);
      assert.equal(open.liveButtonVisible,true);
      await page.screenshot({path:path.join(OUT,theme+'-open.png'),fullPage:true});

      await page.locator('#qscrim').click({position:{x:310,y:300}});
      await page.locator('#qmenu').waitFor({state:'hidden',timeout:5000});
      const afterClose=await page.evaluate(()=>({
        rootScrollWidth:document.documentElement.scrollWidth,
        bodyScrollWidth:document.body.scrollWidth,
        menuVisible:getComputedStyle(document.querySelector('#qmenu')).display!=='none'
      }));
      assert.ok(afterClose.rootScrollWidth<=321);
      assert.ok(afterClose.bodyScrollWidth<=321);
      assert.equal(afterClose.menuVisible,false);
      results.push({theme,closed,open,afterClose,pass:true});
    } finally {
      await context.close();
    }
  }
  console.log('[320PX LIGHT/DARK VISUAL CHECK] '+JSON.stringify({viewports:['320x640'],themes:['dark','light'],results,screenshots:OUT}));
  console.log('PASS: 320px light/dark menu open/closed checks passed.');
} finally {
  await browser.close();
}
