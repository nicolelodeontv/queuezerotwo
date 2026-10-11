import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const productionHosts = '^(queuezerotwo\\.vercel\\.app|pickleball-queue-app-meow-7e9e\\.vercel\\.app|pickleball-queue-app-git-main-meow-7e9e\\.vercel\\.app)$';
const hostMatches = (rule, field) => (rule[field] ?? []).some(condition =>
  condition.type === 'host' && condition.value === productionHosts
);
const cspRule = rule => (rule.headers ?? []).find(header => header.key.toLowerCase() === 'content-security-policy');

assert.ok(Array.isArray(config.headers), 'vercel.json must define response headers');
const productionRule = config.headers.find(rule => hostMatches(rule, 'has') && cspRule(rule));
const previewRule = config.headers.find(rule => hostMatches(rule, 'missing') && cspRule(rule));
assert.ok(productionRule, 'Production host must have a dedicated CSP rule');
assert.ok(previewRule, 'Non-Production hosts must have the Preview CSP rule');

const productionCsp = cspRule(productionRule).value;
const previewCsp = cspRule(previewRule).value;
assert.ok(productionCsp.includes('https://wochetemsnrysnjrgoed.supabase.co'), 'Production CSP must allow Production Supabase');
assert.ok(!productionCsp.includes('yeytqiyhosoyuassjcef'), 'Production CSP must not allow the test Supabase project');
assert.ok(previewCsp.includes('https://yeytqiyhosoyuassjcef.supabase.co'), 'Preview CSP must allow the test Supabase HTTPS endpoint');
assert.ok(previewCsp.includes('wss://yeytqiyhosoyuassjcef.supabase.co'), 'Preview CSP must allow the test Supabase Realtime endpoint');
assert.ok(!productionCsp.includes('unsafe-eval'), 'Production CSP must not enable unsafe-eval');

const sharedRule = config.headers.find(rule =>
  !cspRule(rule) && (rule.headers ?? []).some(header => header.key === 'X-Content-Type-Options')
);
assert.ok(sharedRule, 'Shared security headers must remain enabled');
for (const name of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  assert.ok(sharedRule.headers.some(header => header.key === name), `Missing shared security header: ${name}`);
}

console.log('Vercel header policy passed: Production excludes test Supabase; Preview keeps optional isolated test access.');
