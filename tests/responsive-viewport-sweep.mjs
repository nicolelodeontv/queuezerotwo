import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const VIEWPORTS = [
  [320, 740], [360, 780], [375, 812], [390, 844], [402, 874], [430, 932],
  [540, 900], [639, 900], [640, 900], [767, 900], [768, 1024], [820, 1180],
  [1023, 900], [1024, 800], [1279, 800], [1280, 800], [1440, 900],
  [1536, 960], [1800, 900], [1920, 1080],
];
const ONLY_320 = process.argv.includes('--only-320');
const FONT_MODE = process.argv.find(arg => arg.startsWith('--font-mode='))?.split('=')[1] || 'enabled';
if (!['blocked', 'enabled'].includes(FONT_MODE)) throw new Error('Use --font-mode=blocked or --font-mode=enabled.');
const TARGET_VIEWPORTS = ONLY_320 ? [[320, 740]] : VIEWPORTS;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: ONLY_320 ? { width: 320, height: 740 } : { width: 1280, height: 800 },
  serviceWorkers: 'block',
  locale: 'en-US',
});
const page = await context.newPage();

// This is a layout-only test. Prevent database access and deliberately control Google Fonts.
const fontResponses = [];
page.on('response', response => {
  const url = new URL(response.url());
  if (url.pathname === '/fonts.css' || url.pathname.startsWith('/fonts/')) {
    fontResponses.push({ host: url.pathname, status: response.status() });
  }
});
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname.endsWith('.supabase.co')) return route.abort();
  if (FONT_MODE === 'blocked' &&
      (url.pathname === '/fonts.css' || url.pathname.startsWith('/fonts/'))) return route.abort();
  return route.continue();
});

try {
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 30000 });
  await page.locator('#app').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#mnb').waitFor({ state: 'attached', timeout: 5000 });
  // initMenu runs on a zero-delay timer and moves the export/import controls into #qmenu.
  await page.locator('#qmenu #exp').waitFor({ state: 'attached', timeout: 10000 });
  await page.locator('#qmenu #impbtn').waitFor({ state: 'attached', timeout: 10000 });

  // Explicitly resolve the actual Oswald face rather than assuming the CSS request succeeded.
  const fontProbe = await page.evaluate(async () => {
    let faces = [];
    let error = null;
    try {
      faces = await document.fonts.load('700 24px Oswald');
    } catch (e) {
      error = String(e && e.message || e);
    }
    await document.fonts.ready;
    return {
      requested: '700 24px Oswald',
      faces: faces.map(face => ({ family: face.family, weight: face.weight, status: face.status })),
      declaredOswaldFaces: Array.from(document.fonts)
        .filter(face => /Oswald/i.test(face.family))
        .map(face => ({ family: face.family, weight: face.weight, status: face.status })),
      check: document.fonts.check('700 24px Oswald'),
      error,
    };
  });

  const failures = [];
  const results = [];

  if (FONT_MODE === 'blocked') {
    if (fontResponses.length) failures.push({ font: 'blocked mode unexpectedly received self-hosted font responses', fontResponses });
  } else {
    const cssLoaded = fontResponses.some(r => r.host === '/fonts.css' && r.status >= 200 && r.status < 300);
    const binaryLoaded = fontResponses.some(r => r.host.startsWith('/fonts/') && r.host.endsWith('.woff') && r.status >= 200 && r.status < 300);
    const oswaldLoaded = fontProbe.faces.some(face => /Oswald/i.test(face.family) && face.status === 'loaded');
    if (!cssLoaded) failures.push({ font: 'Font stylesheet was not fetched successfully', fontResponses, fontProbe });
    if (!binaryLoaded || !oswaldLoaded) failures.push({ font: 'Oswald web font did not load; enabled mode must exercise the web-font layout', fontResponses, fontProbe });
  }

  for (const [width, height] of TARGET_VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      // Wait for web fonts/icons and two paint frames after the resize before measuring.
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.scrollTo(0, 0);
    });

    const metrics = await page.evaluate(() => {
      const rect = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
      };
      const header = document.querySelector('header .container');
      const menuButton = document.querySelector('#mnb');
      const nav = document.querySelector('#nav');
      const visible = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
      const firstOverflowingElement = [...document.querySelectorAll('body *')].find(el => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || el.getClientRects().length === 0) return false;
        return el.getBoundingClientRect().right > innerWidth + 1;
      });
      const firstOverflowingElementInfo = firstOverflowingElement ? {
        tag: firstOverflowingElement.tagName.toLowerCase(),
        id: firstOverflowingElement.id || null,
        class: firstOverflowingElement.getAttribute('class') || '',
        rect: rect(firstOverflowingElement),
        text: (firstOverflowingElement.innerText || firstOverflowingElement.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        children: [...firstOverflowingElement.children].map(child => ({
          tag: child.tagName.toLowerCase(),
          id: child.id || null,
          class: child.getAttribute('class') || '',
          rect: rect(child),
          text: (child.innerText || child.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        })),
      } : null;
      return {
        width: innerWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        headerClientWidth: header?.clientWidth ?? null,
        headerScrollWidth: header?.scrollWidth ?? null,
        menuButtonVisible: visible(menuButton),
        menuButtonRect: rect(menuButton),
        navVisible: visible(nav),
        navRect: rect(nav),
        appRect: rect(document.querySelector('#app')),
        firstOverflowingElement: firstOverflowingElementInfo,
      };
    });

    const problems = [];
    if (metrics.rootScrollWidth > width + 1) {
      problems.push('document horizontal overflow ' + metrics.rootScrollWidth + 'px > viewport ' + width + 'px');
    }
    if (metrics.bodyScrollWidth > width + 1) {
      problems.push('body horizontal overflow ' + metrics.bodyScrollWidth + 'px > viewport ' + width + 'px');
    }
    if (!metrics.menuButtonVisible) problems.push('menu button is not visible');
    if (metrics.menuButtonRect &&
        (metrics.menuButtonRect.left < -1 || metrics.menuButtonRect.right > width + 1)) {
      problems.push('menu button extends outside the viewport');
    }
    if (width <= 639 && metrics.headerClientWidth !== null &&
        metrics.headerScrollWidth > metrics.headerClientWidth + 1) {
      problems.push('mobile header contents overflow their container');
    }
    if (metrics.navVisible !== (width < 1024)) {
      problems.push('bottom navigation visibility does not match the 1024px breakpoint');
    }
    if (metrics.navVisible && metrics.navRect &&
        (metrics.navRect.left < -1 || metrics.navRect.right > width + 1)) {
      problems.push('bottom navigation extends outside the viewport');
    }

    results.push({ viewport: width + 'x' + height, pass: problems.length === 0, metrics, problems });
    if (problems.length) failures.push({ viewport: width + 'x' + height, problems, metrics });
  }

  console.log(JSON.stringify({
    test: 'responsive viewport sweep',
    fontMode: FONT_MODE,
    fontResponses,
    fontProbe,
    checked: results.length,
    results
  }, null, 2));
  assert.deepEqual(failures, [], 'Responsive layout failed at one or more viewport sizes.');
  console.log('PASS: all responsive viewport checks passed; Supabase requests were blocked.');
} finally {
  await browser.close();
}
