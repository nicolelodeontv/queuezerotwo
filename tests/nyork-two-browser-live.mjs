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

async function main() {
  const browser = await chromium.launch({headless: true});
  const hostContext = await browser.newContext({...devices['Desktop Chrome'], serviceWorkers: 'block', locale: 'en-US'});
  const viewerContext = await browser.newContext({...devices['iPhone 13'], serviceWorkers: 'block', locale: 'en-US'});
  const host = await hostContext.newPage();
  const viewer = await viewerContext.newPage();
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
      const payload = {
        t: 11, wb: 2,
        courts: [{n: 'Court 1', a: true, p: ['Alice', 'Bob', 'Cara', 'Dan'], s: [6, 4]}],
        nx: [], up: [], tm: null, q: [], lb: []
      };
      const q = await publishSession(payload);
      return {code: S.sid, success: !q.error && q.data === true, error: q.error?.message || null};
    });
    liveCode = published.code;
    console.log('[NYORK LIVE CONTROL] ' + JSON.stringify(published));
    assert.match(liveCode, /^[A-Z2-9]{10}$/);
    assert.equal(published.success, true, 'Nyork Live View host publish must succeed');

    await viewer.goto(APP + '#s=' + liveCode, {waitUntil: 'domcontentloaded'});
    await viewer.waitForFunction(() => {
      const text = document.querySelector('#viewer')?.innerText || '';
      return text.includes('Alice & Bob') && text.includes('Cara & Dan') && /\b6\b/.test(text) && /\b4\b/.test(text);
    }, null, {timeout: 15000});
    const firstViewerText = await viewer.locator('#viewer').innerText();
    assert.match(firstViewerText, /Alice & Bob/);
    assert.match(firstViewerText, /Cara & Dan/);

    const updated = await host.evaluate(async () => {
      const payload = {
        t: 11, wb: 2,
        courts: [{n: 'Court 1', a: true, p: ['Alice', 'Bob', 'Cara', 'Dan'], s: [7, 4]}],
        nx: [], up: [], tm: null, q: [], lb: []
      };
      const q = await publishSession(payload);
      return {success: !q.error && q.data === true, error: q.error?.message || null};
    });
    assert.equal(updated.success, true, 'Nyork Live View update must succeed');

    let realtimeUpdate = true;
    try {
      await viewer.waitForFunction(() => /\b7\b/.test(document.querySelector('#viewer')?.innerText || ''), null, {timeout: 8000});
    } catch {
      realtimeUpdate = false;
      await viewer.reload({waitUntil: 'domcontentloaded'});
      await viewer.waitForFunction(() => /\b7\b/.test(document.querySelector('#viewer')?.innerText || ''), null, {timeout: 15000});
    }

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
    assert.match(archivedPageState.text, /Nyork two-browser QA/);
    assert.match(archivedPageState.text, /11-9/);

    console.log('[NYORK TWO-BROWSER PASS] ' + JSON.stringify({
      hostBrowser: 'Desktop Chrome',
      viewerBrowser: 'iPhone 13 isolated profile',
      liveCode: liveCode,
      initialViewerLoaded: true,
      hostUpdateSucceeded: true,
      realtimeUpdate,
      resultsCode,
      resultsViewerLoaded: true
    }));
  } finally {
    await Promise.all([hostContext.close(), viewerContext.close()]);
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
