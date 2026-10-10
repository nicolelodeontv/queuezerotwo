import assert from 'node:assert/strict';
import playwright from 'playwright';

const APP_URL = process.env.APP_URL || '';
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || '';
const TEST_PROJECT_REF = 'yeytqiyhosoyuassjcef';
if (!APP_URL) throw new Error('APP_URL must be a protected Vercel Preview share link; production fallback is intentionally disabled.');
if (new URL(SUPABASE_URL).origin !== 'https://' + TEST_PROJECT_REF + '.supabase.co') {
  throw new Error('TEST_SUPABASE_URL must identify the dedicated QueueZeroTwo test project.');
}
if (new URL(APP_URL).hostname === 'queuezerotwo.vercel.app') {
  throw new Error('The production app is forbidden in the BrowserStack workflow.');
}

const USER = process.env.BROWSERSTACK_USERNAME;
const KEY = process.env.BROWSERSTACK_ACCESS_KEY;
const BUILD = 'QueueZeroTwo Release 1 real-device gate ' + new Date().toISOString();

if (!USER || !KEY) {
  throw new Error('Missing BrowserStack Action secrets. Add BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY; never put credentials in source.');
}
function scrub(value) {
  let text = String(value ?? '');
  if (USER) text = text.split(USER).join('[redacted username]');
  if (KEY) text = text.split(KEY).join('[redacted access key]');
  return text;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function caps(options) {
  const result = {
    browser: options.browser,
    osVersion: options.osVersion,
    deviceName: options.deviceName,
    realMobile: 'true',
    'browserstack.username': USER,
    'browserstack.accessKey': KEY,
    'browserstack.playwrightVersion': '1.56.1',
    'client.playwrightVersion': '1.56.1',
    'browserstack.debug': 'true',
    'browserstack.networkLogs': 'true',
    build: BUILD,
    name: options.sessionName,
  };
  return result;
}

async function getSessionId(page, name) {
  try {
    const result = await page.evaluate(() => {}, 'browserstack_executor: {"action":"getSessionDetails"}');
    const details = typeof result === 'string' ? JSON.parse(result) : result;
    if (details && (details.hashed_id || details.session_id || details.id)) {
      return details.hashed_id || details.session_id || details.id;
    }
  } catch {}
  const auth = 'Basic ' + Buffer.from(USER + ':' + KEY).toString('base64');
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const response = await fetch('https://api.browserstack.com/automate/sessions.json?status=running', {
      headers: { authorization: auth },
    });
    if (!response.ok) throw new Error('BrowserStack session lookup failed with HTTP ' + response.status);
    const body = await response.json();
    const sessions = Array.isArray(body) ? body : (body.sessions || []);
    for (const item of sessions) {
      const session = item.automation_session || item;
      if (session.name === name && (session.hashed_id || session.id)) {
        return session.hashed_id || session.id;
      }
    }
    await sleep(1000);
  }
  throw new Error('Unable to identify BrowserStack session: ' + name);
}

async function connectDevice(options) {
  // Session names are unique per workflow run. getSessionId() uses the name
  // to call BrowserStack's session API, and duplicate names can target another run.
  const sessionName = options.name + ' [' + BUILD + ']';
  const sessionOptions = { ...options, sessionName };
  const endpoint = 'wss://cdp.browserstack.com/playwright?caps=' + encodeURIComponent(JSON.stringify(caps(sessionOptions)));

  if (options.browser === 'chrome') {
    // BrowserStack real Android devices use Playwright's Android API, not chromium.connect().
    const android = await playwright._android.connect(endpoint);
    try {
      await android.shell('am force-stop com.android.chrome');
      const context = await android.launchBrowser();
      const page = await context.newPage();
      const sessionId = await getSessionId(page, sessionName);
      return { kind: 'android', android, context, page, name: options.name, sessionId };
    } catch (error) {
      await android.close().catch(() => {});
      throw error;
    }
  }

  if (options.browser === 'safari') {
    // BrowserStack real iPhone Safari uses Playwright's WebKit connection.
    const browser = await playwright.webkit.connect({
      wsEndpoint: endpoint,
      timeout: 120000,
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const sessionId = await getSessionId(page, sessionName);
      return { kind: 'ios', browser, context, page, name: options.name, sessionId };
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  throw new Error('Unsupported BrowserStack real device browser: ' + options.browser);
}

async function setNetwork(device, networkProfile) {
  const auth = 'Basic ' + Buffer.from(USER + ':' + KEY).toString('base64');
  const response = await fetch(
    'https://api.browserstack.com/automate/sessions/' + encodeURIComponent(device.sessionId) + '/update_network.json',
    {
      method: 'PUT',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ networkProfile }),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error('BrowserStack could not switch device network to ' + networkProfile +
      ' (HTTP ' + response.status + '): ' + body.slice(0, 250));
  }
}

async function markStatus(device, status, reason) {
  if (!device) return;
  const command = 'browserstack_executor: ' + JSON.stringify({
    action: 'setSessionStatus',
    arguments: { status, reason: String(reason).slice(0, 240) },
  });
  try { await device.page.evaluate(() => {}, command); } catch {}
}

async function waitUntil(read, description, timeout = 25000, interval = 500) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
      last = String(value);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(interval);
  }
  throw new Error('Timed out waiting for ' + description + (last ? ': ' + last.slice(0, 200) : ''));
}

async function networkProbe(page) {
  // Some BrowserStack WebKit sessions do not serialize an async evaluate return
  // consistently. Store the result in-page, then read it synchronously.
  await page.evaluate(baseUrl => {
    window.__qztNetworkProbe = null;
    fetch(baseUrl + '/auth/v1/health?probe=' + Date.now(), { cache: 'no-store' })
      .then(response => {
        window.__qztNetworkProbe = {
          reachable: true,
          status: response.status,
          online: navigator.onLine,
        };
      })
      .catch(error => {
        window.__qztNetworkProbe = {
          reachable: false,
          error: String(error),
          online: navigator.onLine,
        };
      });
  }, SUPABASE_URL);
  try {
    await page.waitForFunction(() => window.__qztNetworkProbe !== null, null, { timeout: 15000 });
  } catch {
    const online = await page.evaluate(() => navigator.onLine).catch(() => null);
    return { reachable: false, error: 'health probe timed out in page context', online };
  }
  return page.evaluate(() => window.__qztNetworkProbe);
}

async function verifyPreviewTarget(page, initialUrl = APP_URL, probeSupabase = true) {
  await ready(page, initialUrl);
  const html = await page.content();
  const config = html.match(/const SB_URL=(["'])(https:\/\/[^"']+)\1,SB_KEY=(["'])([^"']+)\3;/);
  assert.ok(config, 'deployed HTML must contain the inline Supabase config');
  assert.equal(new URL(config[2]).origin, SUPABASE_URL, 'preview HTML must target the dedicated test backend');
  assert.notEqual(new URL(config[2]).origin, 'https://wochetemsnrysnjrgoed.supabase.co', 'production Supabase is forbidden');
  assert.equal(config[2], SUPABASE_URL, 'preview backend URL must exactly match TEST_SUPABASE_URL');
  assert.ok(!config[4].startsWith('sb_secret_'), 'a Supabase secret key must never be embedded in browser code');
  if (probeSupabase) {
    const probe = await networkProbe(page);
    assert.equal(probe.reachable, true, 'dedicated test Supabase endpoint must be reachable from the device; probe=' + JSON.stringify({ status: probe.status ?? null, error: probe.error ?? null, online: probe.online }));
  } else {
    console.log('Supabase URL/key configuration verified on iPhone; real RPC checks will verify network access during handoff and publishing.');
  }
}

async function verifyProfilesPrecachedOffline(device, verifyRestoredConnectivity = true) {
  const page = device.page;
  // The Vercel share URL sets a browser cookie; remove its one-time query token before reloads.
  await page.evaluate(() => history.replaceState(null, '', location.pathname));
  await waitUntil(
    () => page.evaluate(() => !!navigator.serviceWorker?.controller),
    'service worker controls Android page',
    30000,
  );
  await waitUntil(
    () => page.evaluate(async () => !!(await caches.match('/profiles.js'))),
    'profiles.js is present in the service-worker cache',
    30000,
  );

  await setNetwork(device, 'no-network');
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitUntil(() => page.locator('#app').isVisible() && page.locator('header h1').isVisible(), 'app shell reloads offline', 30000);
    await page.locator('#mnb').click();
    await waitUntil(
      () => page.locator('#qmenu button[title="Players"]').isVisible(),
      'Players feature button exists after offline reload',
    );
    await page.locator('#qmenu button[title="Players"]').click();
    await waitUntil(
      () => page.getByText('All-time stats on this device').isVisible(),
      'Players feature opens offline',
    );
    const content = await page.locator('[role="dialog"]').innerText();
    assert.match(content, /No players yet|All-time stats on this device/);
    console.log('PASS: offline shell loaded and Players opened from the cached profiles.js on ' + device.kind + '.');
  } finally {
    await setNetwork(device, '4g-lte-good').catch(() => {});
  }
  if (verifyRestoredConnectivity) {
    await waitUntil(async () => {
      const probe = await networkProbe(page);
      return probe.reachable && probe.online;
    }, 'device returns online after offline Players check', 60000);
  } else {
    console.log('iPhone offline shell/Players check completed; subsequent handoff RPCs will verify connectivity after profile restoration.');
  }
}

async function verifyWinByOneLiveView(hostPage, viewerPage) {
  await hostPage.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(hostPage);
  const session = await hostPage.evaluate(async () => {
    localStorage.clear();
    S = mk();
    S.name = 'Win-by-one device check';
    S.target = 11;
    S.wb = 1;
    S.queue = [];
    S.waiting = [];
    S.log = [];
    S.courts = [{
      id: 1,
      name: 'Court 1',
      isActive: true,
      players: ['Ana', 'Ben', 'Cara', 'Dan'],
      score: [11, 10],
      mid: 'WBYONE01',
      t: Date.now(),
    }];
    ensureLiveIdentity();
    const published = await publishSession(sdata());
    if (published?.error) throw new Error('Could not publish win-by-one test session: ' + published.error.message);
    dropPublishQueue(S.sid, S.sh);
    save();
    return { sid: S.sid, wb: S.wb };
  });
  assert.match(session.sid, /^ZZTEST[A-Za-z0-9]{4}$/, 'win-by-one test must use an isolated ZZTEST code');
  assert.equal(session.wb, 1);

  const viewerUrl = await hostPage.evaluate(sid => location.origin + location.pathname + '#s=' + sid, session.sid);
  await viewerPage.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitUntil(
    () => viewerPage.evaluate(() => !!SV?.d && (SV.d.courts || []).some(c => c.a)),
    'Live View loads the win-by-one test session',
    30000,
  );
  const scores = await viewerPage.locator('#viewer span.font-sport.text-3xl').evaluateAll(
    els => els.map(el => ({ text: el.textContent.trim(), highlighted: el.classList.contains('text-pickle-500') })),
  );
  assert.deepEqual(scores.slice(0, 2).map(x => x.text), ['11', '10'], 'Live View displays the 11-10 score');
  assert.deepEqual(scores.slice(0, 2).map(x => x.highlighted), [true, false], 'win-by-1 highlights Team 1 at 11-10');
  console.log('PASS: iPhone-hosted win-by-1 session highlights the winning team in the Android Live View.');
  return { sid: session.sid, scores: scores.slice(0, 2) };
}

async function ready(page, initialUrl = APP_URL) {
  await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await waitUntil(() => page.locator('#app').isVisible() && page.locator('header h1').isVisible(), 'main app layout ready', 30000);
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      host: location.hostname,
      path: location.pathname,
      title: document.title,
      body: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 240),
      hasAppForm: !!document.getElementById('pn'),
    })).catch(() => ({ host: 'unavailable', path: '/', title: '', body: 'Unable to inspect page', hasAppForm: false }));
    console.error('Preview browser diagnostic: ' + JSON.stringify(diagnostic));
    throw new Error('Main app layout did not load on ' + diagnostic.host + diagnostic.path +
      '; title=' + diagnostic.title + '; hasAppForm=' + diagnostic.hasAppForm +
      '; body=' + diagnostic.body);
  }
}

async function setupEight(page, navigate = true) {
  if (navigate) await ready(page);
  await page.locator('#nvs').click();
  await page.locator('#pn').fill('Alpha One,Beta Two,Gamma Three,Delta Four,Echo Five,Fox Six,Golf Seven,Hotel Eight');
  await page.locator('#f button').click();
  await waitUntil(() => page.evaluate(() => S.waiting.length === 8), 'eight test players added');
  await page.getByRole('button', { name: 'Check in all' }).click();
  await waitUntil(() => page.evaluate(() => S.queue.length === 8 && S.waiting.length === 0), 'all test players checked in');
  // The Send Next 4 action belongs to the Stack tab on narrow viewports.
  await page.locator('#go').click();
  await waitUntil(() => page.evaluate(() => S.courts.some(c => c.isActive && c.players.length === 4)), 'court started');
  await page.locator('#nvp').click();
  await page.locator('button[aria-label="Plus point, Team 1"]').first().waitFor({ state: 'visible' });
}

async function confirmDialog(page) {
  await page.getByRole('button', { name: 'Confirm' }).click();
}

async function backupAndImportOnIPhone(page) {
  await page.evaluate(() => {
    localStorage.clear();
    history.replaceState(null, '', location.pathname + location.search);
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.evaluate(() => {
    window.__backupJson = [];
    sb.rpc = async () => ({ data: null, error: new Error('Isolated backup verification: network writes suppressed') });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      if (blob instanceof Blob && blob.type === 'application/json') blob.text().then(text => window.__backupJson.push(text));
      return create(blob);
    };
  });

  await setupEight(page, false);
  // End-session intentionally cancels active matches without logging them.
  // Finish one short, scored game first so the backup must preserve a real log entry.
  await page.evaluate(() => {
    S.target = 1;
    S.wb = 1;
    save();
    render();
  });
  await page.locator('button[aria-label="Plus point, Team 1"]').first().click();
  await waitUntil(
    () => page.evaluate(() => S.courts.some(c => c.isActive && c.score[0] === 1 && win(c.score, S.target) >= 0)),
    'winning point recorded before backup',
  );
  await page.getByRole('button', { name: /FINISH & LOG/i }).first().click();
  await waitUntil(() => page.evaluate(() => S.log.length >= 1), 'completed match added to the log before backup');
  await page.locator('#rs').click();
  await confirmDialog(page);
  await page.locator('[role="dialog"] .bk').waitFor({ state: 'visible', timeout: 15000 });
  await waitUntil(() => page.evaluate(() => window.__backupJson.length >= 1), 'End session backup JSON generated');
  const backup = await page.evaluate(() => window.__backupJson[0]);
  const parsed = JSON.parse(backup);
  assert.equal(parsed.app, 'QueueZeroTwo');
  assert.equal(parsed.state.ended, true);
  assert.ok(parsed.state.log.length >= 1, 'match log survives in exported backup');
  assert.ok(parsed.state.queue.length >= 4, 'stack survives in exported backup');

  // Verify the visible Safari fallback calls the same backup-download path.
  // Capture its exact serialized payload synchronously: Safari may handle the Blob download
  // outside the page context, so waiting for a second asynchronous Blob.text() callback is brittle.
  await page.evaluate(() => {
    const original = window.downloadBackup;
    if (typeof original !== 'function') throw new Error('Save backup handler is unavailable');
    window.__backupFallbackCalls = 0;
    window.__backupFallbackJson = '';
    window.downloadBackup = function(note) {
      window.__backupFallbackCalls += 1;
      window.__backupFallbackJson = expData();
      return original(note);
    };
  });
  await page.locator('[role="dialog"] .bk').click();
  await waitUntil(
    () => page.evaluate(() => window.__backupFallbackCalls === 1 && !!window.__backupFallbackJson),
    'Save backup fallback invokes the download handler',
  );
  const fallbackBackup = await page.evaluate(() => window.__backupFallbackJson);
  const fallbackParsed = JSON.parse(fallbackBackup);
  assert.equal(fallbackParsed.app, 'QueueZeroTwo');
  assert.equal(fallbackParsed.state.ended, true);
  assert.ok(fallbackParsed.state.log.length >= 1, 'fallback backup preserves the completed match log');
  assert.ok(fallbackParsed.state.queue.length >= 4, 'fallback backup preserves the stack');

  // Import the exact JSON payload generated by the real Safari fallback path.
  await page.evaluate(() => {
    localStorage.clear();
    history.replaceState(null, '', location.pathname + location.search);
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await page.evaluate(() => {
    sb.rpc = async () => ({ data: null, error: new Error('Isolated import verification: network writes suppressed') });
  });
  await page.locator('#imp').setInputFiles({
    name: 'queuezerotwo-end-session-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fallbackBackup, 'utf8'),
  });
  await confirmDialog(page);
  await waitUntil(
    () => page.evaluate(() => !S.ended && S.log.length >= 1 && S.queue.length >= 4),
    'iPhone Safari imported the exported backup',
  );
  const report = await page.evaluate(() => ({
    ended: !!S.ended,
    queue: S.queue.length,
    log: S.log.length,
    courts: S.courts.length,
    score: Math.max(0, ...S.courts.map(c => c.score[0])),
  }));
  assert.equal(report.ended, false);
  assert.ok(report.queue >= 4);
  assert.ok(report.log >= 1);
  await page.evaluate(() => {
    localStorage.clear();
    clearTimeout(PQRetry);
    clearTimeout(st);
  });
  return report;
}

async function main() {
  let phoneA;
  let phoneB;
  let status = 'failed';
  let reason = 'test did not finish';
  try {
    phoneA = await connectDevice({
      browser: 'chrome',
      osVersion: '13',
      deviceName: 'Samsung Galaxy S22',
      name: 'QueueZeroTwo offline host - real Android Chrome',
    });
    phoneB = await connectDevice({
      browser: 'safari',
      osVersion: '17',
      deviceName: 'iPhone 15 Pro Max',
      name: 'QueueZeroTwo replacement host - real iPhone Safari',
    });
    console.log('Connected to a real Android Chrome and iPhone Safari device pair.');
    // BrowserStack devices may inherit a restricted network state, so set both to known-good LTE before validation.
    await setNetwork(phoneA, '4g-lte-good');
    await setNetwork(phoneB, '4g-lte-good');
    console.log('Both device sessions set to the 4g-lte-good network profile.');

    // Validate both real devices have the intended Preview build before any writes.
    await verifyPreviewTarget(phoneA.page);

    // The Vercel share query redeems into a browser cookie. Copy only cookies
    // scoped to this Preview deployment into the iPhone context instead of
    // attempting to redeem the same one-time URL a second time.
    const previewHost = new URL(APP_URL).hostname;
    const previewCookies = (await phoneA.context.cookies()).filter(cookie => {
      const domain = String(cookie.domain || '').replace(/^\\./, '').toLowerCase();
      return domain && (previewHost === domain || previewHost.endsWith('.' + domain));
    });
    assert.ok(previewCookies.length > 0, 'Android Preview access did not establish a cookie scoped to this deployment');
    await phoneB.context.addCookies(previewCookies);
    const iPhonePreviewUrl = new URL(APP_URL);
    iPhonePreviewUrl.searchParams.delete('_vercel_share');
    iPhonePreviewUrl.hash = '';
    await verifyPreviewTarget(phoneB.page, iPhonePreviewUrl.toString(), false);
    console.log('PASS: both real-device browsers can load the isolated Preview app shell.');
    await verifyProfilesPrecachedOffline(phoneB, false);
    const startNetwork = await networkProbe(phoneA.page);
    assert.equal(startNetwork.reachable, true, 'Android begins online');
    await setupEight(phoneA.page);
    await phoneA.page.evaluate(() => {
      window.__handoffBackupJson = [];
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => {
        if (blob instanceof Blob && blob.type === 'application/json') {
          blob.text().then(text => window.__handoffBackupJson.push(text));
        }
        return create(blob);
      };
    });

    // Generate a real host identity and obtain the handoff code before going offline.
    await phoneA.page.locator('button[title="Open a read-only live view for players"]').click();
    await waitUntil(() => phoneA.page.locator('[role="dialog"] .ho').isVisible(), 'Live View controls');
    await phoneA.page.locator('[role="dialog"] .ho').click();
    await waitUntil(() => phoneA.page.getByRole('button', { name: 'Show code' }).isVisible(), 'handoff confirmation');
    await phoneA.page.getByRole('button', { name: 'Show code' }).click();
    await waitUntil(() => phoneA.page.getByText('Scan on the new host').isVisible(), 'handoff QR ready');
    const handoff = await phoneA.page.evaluate(() => ({
      sid: S.sid,
      sh: S.sh,
      url: location.origin + location.pathname + '#h=' + S.sid + '.' + S.sh,
    }));
    assert.match(handoff.sid, /^ZZTEST[A-Za-z0-9]{4}$/, 'temporary Live View sessions must use the ZZTEST prefix');
    assert.match(handoff.sh, /^[0-9a-f]{64}$/);
    await phoneA.page.locator('[role="dialog"] [data-x]').first().click();

    await waitUntil(
      () => phoneA.page.evaluate(() => PQ.length === 0),
      'initial publishes drained before disconnect',
      30000,
    );
    await setNetwork(phoneA, 'no-network');
    await waitUntil(async () => {
      const probe = await networkProbe(phoneA.page);
      return probe.reachable === false && probe.online === false;
    }, 'Android is truly offline', 60000);

    await phoneA.page.locator('button[aria-label="Plus point, Team 1"]').first().click();
    await waitUntil(
      () => phoneA.page.evaluate(() => S.courts.some(c => c.isActive && c.score[0] === 1)),
      'first Android offline point is recorded',
    );
    await phoneA.page.locator('button[aria-label="Plus point, Team 1"]').first().click();
    await waitUntil(
      () => phoneA.page.evaluate(() =>
        S.courts.some(c => c.isActive && c.score[0] === 2) &&
        JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1') || '{"items":[]}').items.length >= 1),
      'two Android offline points are present in the durable publish queue',
    );
    // Use the actual Export action while offline, then import those exact JSON bytes on phone B.
    if (!(await phoneA.page.locator('#qmenu').isVisible())) await phoneA.page.locator('#mnb').click();
    await phoneA.page.locator('#qmenu #exp').click();
    await waitUntil(
      () => phoneA.page.evaluate(() => window.__handoffBackupJson.length >= 1),
      'offline Export action generated backup JSON',
    );
    const offlineBackup = JSON.parse(await phoneA.page.evaluate(() => window.__handoffBackupJson[0]));
    assert.equal(offlineBackup.app, 'QueueZeroTwo');
    assert.equal(offlineBackup.state.courts.find(c => c.isActive).score[0], 2);
    assert.equal(offlineBackup.state.queue.length, 4);

    // Restore on the new host, then use the displayed handoff URL to rotate authority.
    await ready(phoneB.page);
    await phoneB.page.evaluate(() => {
      localStorage.clear();
      history.replaceState(null, '', location.pathname + location.search);
    });
    await phoneB.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await phoneB.page.evaluate(() => {
      window.__rpcBeforeHandoffImport = sb.rpc;
      sb.rpc = async () => ({ data: null, error: new Error('Suppress publish while staging import') });
    });
    await phoneB.page.locator('#imp').setInputFiles({
      name: 'queuezerotwo-offline-host-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(offlineBackup), 'utf8'),
    });
    await confirmDialog(phoneB.page);
    // The Android backup captured both offline points; import must preserve score 2.
    await waitUntil(
      () => phoneB.page.evaluate(() => S.queue.length === 4 && S.courts.some(c => c.isActive && c.score[0] === 2)),
      'offline state restored on phone B',
    );
    await phoneB.page.evaluate(() => {
      clearTimeout(st);
      clearTimeout(PQRetry);
      PQRetry = null;
      PQ = [];
      PQS = 0;
      savePublishQueue();
      S.sid = '';
      S.sh = '';
      S.ho = false;
      S.hoff = 0;
      persistStateOnly();
      sb.rpc = window.__rpcBeforeHandoffImport;
    });

    await phoneB.page.goto(handoff.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitUntil(() => phoneB.page.getByRole('button', { name: 'Confirm' }).isVisible(), 'takeover requires confirmation');
    await confirmDialog(phoneB.page);
    await waitUntil(
      () => phoneB.page.evaluate(sid => S.sid === sid && !!S.sh && !S.ho &&
        S.courts.some(c => c.isActive && c.score[0] === 2) && S.queue.length === 4, handoff.sid),
      'phone B takes control while preserving the offline score',
      30000,
    );
    const newHost = await phoneB.page.evaluate(() => ({
      sid: S.sid,
      sh: S.sh,
      ho: S.ho,
      queue: S.queue.slice(),
      active: S.courts.filter(c => c.isActive).map(c => ({ players: c.players, score: c.score.slice() })),
      storedState: localStorage.getItem('pickleStackState') || '',
      storedQueue: localStorage.getItem('queuezerotwo-publish-queue-v1') || '',
    }));
    assert.equal(newHost.sid, handoff.sid);
    assert.notEqual(newHost.sh, handoff.sh, 'new host key is rotated');
    assert.equal(newHost.ho, false);
    assert.equal(newHost.queue.length, 4);
    assert.equal(newHost.active[0].score[0], 2);
    assert.equal(newHost.storedState.includes(handoff.sh), false, 'old host key is absent from replacement state');
    assert.equal(newHost.storedQueue.includes(handoff.sh), false, 'old host key is absent from replacement sync queue');

    await setNetwork(phoneA, '4g-lte-good');
    let lastReconnectProbe = null;
    try {
      await waitUntil(async () => {
        lastReconnectProbe = await networkProbe(phoneA.page);
        return lastReconnectProbe.reachable === true && lastReconnectProbe.online === true;
      }, 'old Android host reconnects', 60000);
    } catch (error) {
      throw new Error((error instanceof Error ? error.message : String(error)) +
        '; final Android reconnect probe=' +
        JSON.stringify(lastReconnectProbe && {
          reachable: lastReconnectProbe.reachable,
          online: lastReconnectProbe.online,
          status: lastReconnectProbe.status ?? null,
          error: lastReconnectProbe.error ?? null,
        }));
    }
    await phoneA.page.evaluate(() => flushPublishQueue());
    try {
      await waitUntil(
        () => phoneA.page.evaluate(() =>
          S.ho === true &&
          JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1') || '{"items":[]}').items.length === 0 &&
          document.getElementById('ct').textContent.includes('No longer host')),
        'old host rejects stale queue and displays No longer host',
        30000,
      );
    } catch (error) {
      const diagnostic = await phoneA.page.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('queuezerotwo-publish-queue-v1') || '{"items":[]}');
        const describe = item => ({
          kind: item.kind || 'state',
          attempts: Number(item.attempts) || 0,
          lastError: String(item.lastError || '').slice(0, 120),
          matchesCurrentSession: item.sid === S.sid,
          matchesCurrentHostKey: item.sh === S.sh,
          hasResultId: !!item.rid,
        });
        return {
          online: navigator.onLine,
          hostDemoted: !!S.ho,
          handoffFlagActive: !!S.hoff && Date.now() - S.hoff < 86400000,
          sessionIdentityPresent: !!S.sid && !!S.sh,
          inMemoryQueueLength: PQ.length,
          inMemoryQueue: PQ.slice(0, 3).map(describe),
          storedQueueLength: Array.isArray(stored.items) ? stored.items.length : null,
          storedQueue: (Array.isArray(stored.items) ? stored.items : []).slice(0, 3).map(describe),
          queueBusy: !!PQBusy,
          queueInflight: !!PQInflightId,
          statusText: String(document.getElementById('ct')?.textContent || '').slice(0, 120),
        };
      });
      throw new Error((error instanceof Error ? error.message : String(error)) +
        '; stale-host diagnostic=' + JSON.stringify(diagnostic));
    }
    console.log('PASS: Android offline scoring, iPhone host handoff, key rotation, and stale-queue rejection.');

    // Check that the reconnected Android can read the authoritative post-handoff state.
    const liveViewerUrl = await phoneB.page.evaluate(() => location.origin + location.pathname + '#s=' + S.sid);
    await phoneA.page.goto(liveViewerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitUntil(
      () => phoneA.page.evaluate(() => !!SV?.d && (SV.d.courts || []).some(c => c.a && c.s?.[0] === 2 && c.s?.[1] === 0)),
      'reconnected Android opens the new host Live View',
      30000,
    );
    const syncedScores = await phoneA.page.locator('#viewer span.font-sport.text-3xl').evaluateAll(
      els => els.map(el => el.textContent.trim()),
    );
    assert.deepEqual(syncedScores.slice(0, 2), ['2', '0'], 'the new host Live View shows both offline points');
    console.log('PASS: post-handoff Live View on Android shows the authoritative 2-0 score.');

    // End the temporary host session, not any user-owned live session.
    await phoneB.page.locator('#nvp').click();
    await phoneB.page.locator('#rs').click();
    await confirmDialog(phoneB.page);
    await waitUntil(() => phoneB.page.evaluate(() => S.ended === true), 'temporary host session ended', 20000);

    const backupReport = await backupAndImportOnIPhone(phoneB.page);
    console.log('PASS: iPhone Safari backup JSON generation, Save backup fallback, and import.');
    console.log('Backup/import assertions: ' + JSON.stringify(backupReport));

    const winByOneReport = await verifyWinByOneLiveView(phoneB.page, phoneA.page);
    console.log('Win-by-one Live View assertions: ' + JSON.stringify(winByOneReport));
    status = 'passed';
    reason = 'real-device handoff and iPhone backup/import assertions passed';
  } catch (error) {
    reason = scrub(error instanceof Error ? error.message : error);
    console.error('REAL DEVICE TEST FAILED: ' + reason);
    throw error;
  } finally {
    if (phoneA) await setNetwork(phoneA, '4g-lte-good').catch(() => {});
    await markStatus(phoneA, status, reason);
    await markStatus(phoneB, status, reason);
    await Promise.all([phoneA, phoneB].filter(Boolean).map(async device => {
      if (device.kind === 'android') await device.android.close().catch(() => {});
      else await device.browser.close().catch(() => {});
    }));
  }
}

main().catch(error => {
  console.error(scrub(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
