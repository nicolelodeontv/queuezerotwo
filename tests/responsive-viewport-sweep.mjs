import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const VIEWPORTS = [
  [320, 740], [360, 780], [375, 812], [390, 844], [402, 874], [430, 932],
  [540, 900], [639, 900], [640, 900], [767, 900], [768, 1024], [820, 1180],
  [1023, 900], [1024, 800], [1279, 800], [1280, 800], [1440, 900],
  [1536, 960], [1800, 900], [1920, 1080],
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  serviceWorkers: 'block',
  locale: 'en-US',
});
const page = await context.newPage();

// This is a layout-only test. Prevent any accidental remote database reads or writes.
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname.endsWith('.supabase.co')) return route.abort();
  return route.continue();
});

try {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('#app').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#mnb').waitFor({ state: 'attached', timeout: 5000 });

  const failures = [];
  const results = [];

  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));

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

  console.log(JSON.stringify({ test: 'responsive viewport sweep', checked: results.length, results }, null, 2));
  assert.deepEqual(failures, [], 'Responsive layout failed at one or more viewport sizes.');
  console.log('PASS: all responsive viewport checks passed; Supabase requests were blocked.');
} finally {
  await browser.close();
}
