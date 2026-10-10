import { readFile, writeFile } from 'node:fs/promises';

const productionUrl = 'https://wochetemsnrysnjrgoed.supabase.co';
const testProjectRef = 'yeytqiyhosoyuassjcef';
const expectedTestUrl = 'https://' + testProjectRef + '.supabase.co';

if (process.env.VERCEL_ENV !== 'preview') {
  console.log('Preview-only Supabase substitution skipped outside Vercel Preview.');
  process.exit(0);
}

const url = process.env.SB_URL;
const key = process.env.SB_KEY;
if (!url || !key) {
  throw new Error('Vercel Preview requires SB_URL and SB_KEY. Production defaults will not be used for a Preview deployment.');
}

let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch {
  throw new Error('SB_URL is not a valid absolute URL.');
}
if (parsedUrl.origin !== expectedTestUrl || url !== expectedTestUrl) {
  throw new Error('Preview SB_URL must point exactly to the dedicated QueueZeroTwo test project.');
}
if (key.startsWith('sb_secret_')) {
  throw new Error('A Supabase secret key is not allowed in browser code. Use the anon/publishable key.');
}
if (key.startsWith('sb_publishable_')) {
  // New-format publishable keys are browser-safe.
} else {
  const parts = key.split('.');
  if (parts.length !== 3) {
    throw new Error('SB_KEY must be a Supabase publishable key or a legacy anon JWT.');
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Could not decode the SB_KEY JWT claims.');
  }
  if (claims.role !== 'anon' || claims.ref !== testProjectRef) {
    throw new Error('SB_KEY must be the anon JWT for the same dedicated test project as SB_URL.');
  }
}

const path = 'index.html';
const html = await readFile(path, 'utf8');
const configPattern = /const SB_URL=(["'])(.*?)\1,SB_KEY=(["'])(.*?)\3;/;
const match = html.match(configPattern);
if (!match || !match[0].includes(productionUrl)) {
  throw new Error('Expected the checked-in production Supabase defaults were not found in index.html; refusing to rewrite an unexpected config.');
}

const replacement = 'const SB_URL=' + JSON.stringify(url) + ',SB_KEY=' + JSON.stringify(key) + ';';
const liveCodePattern = /const randLiveCode=\(\)=>\{const a=new Uint8Array\(10\);crypto\.getRandomValues\(a\);return Array\.from\(a,v=>LIVE_ALPH\[v%LIVE_ALPH\.length\]\)\.join\(''\)\};/;
if (!liveCodePattern.test(html)) {
  throw new Error('Expected randLiveCode generator was not found; refusing to deploy a Preview without test-prefixed session codes.');
}
const configured = html
  .replace(configPattern, replacement)
  .replace(liveCodePattern, "const randLiveCode=()=> 'ZZTEST'+Array.from(crypto.getRandomValues(new Uint8Array(4)),v=>LIVE_ALPH[v%LIVE_ALPH.length]).join('');");
if (!configured.includes('const randLiveCode=()=> \'ZZTEST\'+')) {
  throw new Error('Preview test-code prefix substitution failed.');
}
await writeFile(path, configured, 'utf8');
console.log('Configured this Vercel Preview build for the isolated QueueZeroTwo test project with ZZTEST-prefixed live session codes.');
