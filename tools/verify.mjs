/**
 * Load the demo in a real browser and check that it works.
 *
 * Serves the project and opens the saved copy, so the check never depends on
 * the openFDA API being reachable. It does depend on jsDelivr, because that
 * is where the page gets the grid from.
 *
 * It asserts the things this demo exists to show:
 *
 *   - the library arrived by classic script tag (no type="module", pinned
 *     release, integrity hashes, each file left its global);
 *   - the reactions table holds rows and the Pareto and bar charts drew marks;
 *   - the headline figures agree with the saved data, recomputed here;
 *   - the Pareto-head derived grid holds exactly the terms that reach 80%;
 *   - grouping the reports table, routing a pushed report, and a filter on the
 *     reactions table that moves the tiles;
 *   - `grid.statistics.profile('count')` reports a mean and a median.
 *
 * It then blocks the API in the browser and opens the live page, to prove a
 * visitor gets the saved copy, and is told so, when openFDA cannot be reached.
 *
 * Exits non-zero when any of that fails, so it can gate a deployment.
 *
 * Usage: node tools/verify.mjs [--all] [--shots <dir>]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const shotIndex = args.indexOf('--shots');
const shotDir = shotIndex >= 0 ? resolve(args[shotIndex + 1]) : null;
const all = args.includes('--all');

const GRID_VERSION = '1.65.0';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@${GRID_VERSION}/`;
const LIBRARY_TAGS = [
  { file: 'lattice-grid.min.js', global: 'LatticeGrid', member: 'createGrid' },
  { file: 'modules/charts.min.js', global: 'LatticeGrid', member: 'createChart' },
  { file: 'modules/data-router.min.js', global: 'LatticeGridDataRouter', member: 'createDataRouter' },
  { file: 'modules/kpi.min.js', global: 'LatticeGridKPI', member: 'createKPI' },
  { file: 'modules/tabs.min.js', global: 'LatticeGridTabs', member: 'createTabs' },
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error(`No browser found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to point at one.`);
}

function requireModernNode() {
  if (typeof WebSocket === 'undefined') {
    throw new Error(`This check needs Node 22 or newer. You are running ${process.version}, which has no built in WebSocket.`);
  }
}

function freePort() {
  return new Promise((ok, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

const failures = [];
const notes = [];

function check(ok, description, detail) {
  if (ok) {
    notes.push(`  ok   ${description}${detail ? ` (${detail})` : ''}`);
  } else {
    failures.push(`${description}${detail ? ` (${detail})` : ''}`);
    notes.push(`  FAIL ${description}${detail ? ` (${detail})` : ''}`);
  }
}

let browser;
let browserPid = null;
let profile;
let server;

try {
  requireModernNode();
  const chromePath = await findChrome();
  const started = await startServer(0);
  server = started.server;
  const origin = `http://127.0.0.1:${started.port}`;
  console.log(`Browser: ${chromePath}`);
  console.log(`Serving: ${origin}`);

  profile = await mkdtemp(join(tmpdir(), 'openfda-umd-demo-verify-'));
  const port = await freePort();
  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  browserPid = browser.pid;
  browser.stderr.on('data', () => {});

  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('the browser never opened its debugging port');

  const socket = new WebSocket(wsUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error('could not attach to the browser'));
  });

  let nextId = 0;
  const pending = new Map();
  let consoleErrors = [];
  let pageErrors = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else ok(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text);
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: ok, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeout, what) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      let value;
      try {
        value = await evaluate(expression);
      } catch {}
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  const open = async (url, label) => {
    consoleErrors = [];
    pageErrors = [];
    console.log(`\n--- ${label} ---\n${url}`);
    await call('Page.navigate', { url });
    await waitFor('!!(window.__openFdaDemo)', 120000, `${label} to load`);
    const state = await evaluate('({ ready: window.__openFdaDemo.ready, error: window.__openFdaDemo.error || null })');
    if (!state.ready) throw new Error(`${label} reported a failure: ${state.error}`);
    await waitFor('window.__openFdaDemo.termsGrid && window.__openFdaDemo.termsGrid.rows.count() > 0', 60000, `${label} rows`);
  };

  const shoot = async (name) => {
    if (!shotDir) return;
    await mkdir(shotDir, { recursive: true });
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    const file = join(shotDir, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(`  shot ${file}`);
  };

  const noErrors = (label) => {
    check(consoleErrors.length === 0, `${label}: no console errors`, consoleErrors.slice(0, 3).join(' | '));
    check(pageErrors.length === 0, `${label}: no page errors`, pageErrors.slice(0, 3).join(' | '));
  };

  /* =================================================================== */
  /* 1. The saved copy.                                                  */
  /* =================================================================== */

  await open(`${origin}/index.html?source=snapshot`, 'saved copy');

  /* ---- how the library arrived ---- */

  const delivery = await evaluate(`(() => {
    const scripts = [...document.querySelectorAll('script')];
    return {
      moduleScripts: scripts.filter((s) => s.type === 'module').length,
      importmaps: scripts.filter((s) => s.type === 'importmap').length,
      librarySrcs: scripts.map((s) => s.getAttribute('src') || '').filter((src) => /cdn\\.jsdelivr\\.net/.test(src)),
      withIntegrity: scripts.filter((s) => /cdn\\.jsdelivr\\.net/.test(s.src) && s.integrity).length,
      stylesheetSrc: (document.querySelector('link[rel=stylesheet][href*="cdn.jsdelivr.net"]') || {}).href || null,
      members: {
        createGrid: typeof (window.LatticeGrid || {}).createGrid,
        createHeadlessGrid: typeof (window.LatticeGrid || {}).createHeadlessGrid,
        setLicence: typeof (window.LatticeGrid || {}).setLicence,
        createChart: typeof (window.LatticeGrid || {}).createChart,
        createDataRouter: typeof (window.LatticeGridDataRouter || {}).createDataRouter,
        createKPI: typeof (window.LatticeGridKPI || {}).createKPI,
        createTabs: typeof (window.LatticeGridTabs || {}).createTabs,
      },
    };
  })()`);
  console.log(`  library tags: ${delivery.librarySrcs.length} from the CDN, ${delivery.withIntegrity} with an integrity hash; module scripts on the page: ${delivery.moduleScripts}`);
  check(delivery.moduleScripts === 0, 'delivery: no type="module" script on the page', `${delivery.moduleScripts}`);
  check(delivery.importmaps === 0, 'delivery: no import map on the page', `${delivery.importmaps}`);
  check(delivery.librarySrcs.length === LIBRARY_TAGS.length, `delivery: ${LIBRARY_TAGS.length} library script tags point at the CDN`, `${delivery.librarySrcs.length}`);
  for (const tag of LIBRARY_TAGS) {
    const wanted = `${CDN_BASE}${tag.file}`;
    check(delivery.librarySrcs.includes(wanted), `delivery: ${tag.file} is loaded from the pinned ${GRID_VERSION} release`, wanted);
    check(delivery.members[tag.member] === 'function', `delivery: ${tag.file} left ${tag.global}.${tag.member} behind`, delivery.members[tag.member]);
  }
  check(delivery.withIntegrity === LIBRARY_TAGS.length, 'delivery: every library tag carries an integrity hash', `${delivery.withIntegrity} of ${LIBRARY_TAGS.length}`);
  check(delivery.stylesheetSrc === `${CDN_BASE}lattice-grid.min.css`, `delivery: the stylesheet is loaded from the pinned ${GRID_VERSION} release`, delivery.stylesheetSrc);
  check(delivery.members.setLicence === 'function', 'delivery: setLicence is on the core global');
  check(delivery.members.createHeadlessGrid === 'function', 'delivery: createHeadlessGrid is on the core global');

  const snap = await evaluate(`(() => {
    const d = window.__openFdaDemo;
    return {
      terms: d.termsGrid.rows.count(),
      reports: d.reportsGrid.rows.count(),
      painted: document.querySelectorAll('.lattice [role="row"]').length,
      charts: d.charts.length,
      watermark: d.termsGrid.licence.watermark(),
      licenceState: d.termsGrid.licence.state(),
      tiles: Object.fromEntries(d.kpi.tiles().map((t) => [t.id, t.value])),
      named: document.querySelector('.kpi-named-value').textContent,
      freshness: document.querySelector('.freshness').textContent,
      head: d.paretoHeadGrid.rows.count(),
      topTerms: d.topTermsGrid.rows.count(),
      profileRows: d.profileGrid.rows.count(),
    };
  })()`);
  console.log(`  ${snap.terms} terms, ${snap.reports} reports, ${snap.painted} painted, ${snap.charts} charts`);
  console.log(`  tiles: ${JSON.stringify(snap.tiles)}`);
  console.log(`  derived: pareto head ${snap.head}, top terms ${snap.topTerms}, profile ${snap.profileRows}`);

  check(snap.terms > 0, 'saved copy: the reactions table holds rows', `${snap.terms}`);
  check(snap.reports > 0, 'saved copy: the reports table holds rows', `${snap.reports}`);
  check(snap.painted > 0, 'saved copy: the table painted rows', `${snap.painted}`);
  check(snap.charts === 4, 'saved copy: all four charts were built', `${snap.charts}`);

  const drawn = await evaluate(`(() => window.__openFdaDemo.charts.map((c, i) => {
    const el = c.element;
    const marks = el ? el.querySelectorAll('path, rect, circle, line').length : 0;
    const data = c.data();
    const series = (data && data.series) || [];
    const categories = (data && data.categories) || [];
    return { i, marks, series: series.length, categories: categories.length };
  }))()`);
  for (const c of drawn) {
    console.log(`  chart ${c.i}: ${c.marks} marks, ${c.series} series, ${c.categories} categories`);
    check(c.marks > 0, `saved copy: chart ${c.i} drew marks`, `${c.marks} marks`);
  }
  check(drawn[0] && drawn[0].categories === 30, 'saved copy: the top-terms chart shows the 30-term head', `${drawn[0] && drawn[0].categories} categories`);
  check(snap.watermark === false, 'saved copy: no watermark on localhost', `state ${snap.licenceState}`);
  noErrors('saved copy');
  await shoot('01-reactions');

  /* Independent recomputation from the saved data. */
  const meta = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'meta.json'), 'utf8'));
  const termValues = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'terms.json'), 'utf8'));
  const reportValues = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'reports.json'), 'utf8'));
  const terms = termValues.map((v) => ({ term: v[0], count: v[1] }));

  const totalReports = terms.reduce((sum, row) => sum + row.count, 0);
  const distinctTerms = terms.length;
  const byCountDesc = [...terms].sort((a, b) => b.count - a.count);
  const top20 = byCountDesc.slice(0, 20).reduce((sum, row) => sum + row.count, 0);
  const expectedTop20Share = totalReports ? top20 / totalReports : 0;

  let running = 0;
  let headTerms = 0;
  for (const row of byCountDesc) {
    running += row.count;
    headTerms += 1;
    if (totalReports && running / totalReports >= 0.8) break;
  }

  check(snap.tiles.reports === totalReports, 'saved copy: the reaction-reports tile matches the saved data', `tile ${snap.tiles.reports}, expected ${totalReports}`);
  check(snap.tiles.terms === distinctTerms, 'saved copy: the distinct-reactions tile matches the saved data', `tile ${snap.tiles.terms}, expected ${distinctTerms}`);
  check(Math.abs(snap.tiles.top20share - expectedTop20Share) < 1e-9, 'saved copy: the top-20 share matches the saved data', `tile ${snap.tiles.top20share}, expected ${expectedTop20Share.toFixed(4)}`);
  check(snap.head === headTerms, 'saved copy: the Pareto head holds exactly the terms that reach 80%', `grid ${snap.head}, expected ${headTerms}`);
  check(snap.topTerms > 0 && snap.topTerms <= 15, 'saved copy: the top-terms derived grid holds at most fifteen rows', `${snap.topTerms}`);
  check(snap.profileRows >= 1, 'saved copy: the statistics profile derived grid holds a row', `${snap.profileRows}`);
  check(typeof snap.named === 'string' && snap.named.length > 2 && snap.named !== 'No data', 'saved copy: the most reported reaction is named', snap.named);

  /* ---- the statistics surface ---- */

  const stats = await evaluate(`(() => {
    const d = window.__openFdaDemo;
    const p = d.termsGrid.statistics.profile('count');
    return { mean: p && p.mean, median: p && p.median, present: p && p.present };
  })()`);
  check(typeof stats.mean === 'number' && typeof stats.median === 'number', 'saved copy: statistics.profile reports a mean and a median', `mean ${stats.mean}, median ${stats.median}`);
  check(stats.present === distinctTerms, 'saved copy: the statistics profile covers every term in view', `${stats.present} of ${distinctTerms}`);

  /* ---- grouping the reports table ---- */

  await evaluate("window.__openFdaDemo.tabs.activate('reports')");
  await waitFor('window.__openFdaDemo.tabs.activeId === "reports"', 30000, 'the reports table');
  await evaluate("window.__openFdaDemo.reportsGrid.columns.group(['sex'])");
  await sleep(600);
  const grouped = await evaluate(`(() => {
    const d = window.__openFdaDemo;
    let groups = 0;
    d.reportsGrid.rows.forEach((r) => { if (r && r.group) groups += 1; });
    return { groups };
  })()`);
  check(grouped.groups > 0, 'grouping the reports by sex produces group rows', `${grouped.groups} groups`);
  await evaluate('window.__openFdaDemo.reportsGrid.columns.group([])');
  await sleep(300);
  await shoot('02-grouped-reports');

  /* ---- routing a pushed report ---- */

  const injected = await evaluate(`(async () => {
    const d = window.__openFdaDemo;
    const termsBefore = d.termsGrid.rows.count();
    const reportsBefore = d.reportsGrid.rows.count();
    d.ingest([{ kind: 'report', id: 'verify-openfda', term: 'VERIFY REACTION', sex: 'Female', serious: 'Serious', year: 2026, qualification: 'Physician', count: 1 }]);
    await new Promise((r) => setTimeout(r, 400));
    let found = null;
    d.reportsGrid.rows.forEach((r) => { if (r && r.data && r.data.id === 'verify-openfda') found = r.data; });
    return { reports: d.reportsGrid.rows.count(), terms: d.termsGrid.rows.count(), termsBefore, reportsBefore, serious: found ? found.serious : null };
  })()`);
  console.log(`  injected report: reports ${injected.reportsBefore} -> ${injected.reports}, terms ${injected.termsBefore} -> ${injected.terms}`);
  check(injected.reports === injected.reportsBefore + 1, 'a pushed report lands in the reports table', `${injected.reportsBefore} -> ${injected.reports}`);
  check(injected.terms === injected.termsBefore, 'the report did not leak into the reactions table', `${injected.terms}`);
  check(injected.serious === 'Serious', 'the pushed report carries its seriousness', injected.serious);

  /* ---- a filter that moves the tiles ---- */

  await evaluate("window.__openFdaDemo.tabs.activate('reactions')");
  await waitFor('window.__openFdaDemo.tabs.activeId === "reactions"', 30000, 'the reactions table');
  const tilesBefore = await evaluate('Object.fromEntries(window.__openFdaDemo.kpi.tiles().map((t) => [t.id, t.value]))');
  const termsBefore = await evaluate('window.__openFdaDemo.termsGrid.rows.count()');
  await evaluate('window.__openFdaDemo.commonButton.click()');
  await sleep(600);
  const tilesAfter = await evaluate('Object.fromEntries(window.__openFdaDemo.kpi.tiles().map((t) => [t.id, t.value]))');
  const termsAfter = await evaluate('window.__openFdaDemo.termsGrid.rows.count()');
  console.log(`  common-only filter: terms ${termsBefore} -> ${termsAfter}; reports tile ${tilesBefore.reports} -> ${tilesAfter.reports}`);
  check(termsAfter > 0 && termsAfter < termsBefore, 'the common-only filter narrows the reactions table', `${termsBefore} -> ${termsAfter}`);
  check(tilesAfter.reports > 0 && tilesAfter.reports < tilesBefore.reports, 'the common-only filter moves the reaction-reports tile', `${tilesBefore.reports} -> ${tilesAfter.reports}`);
  check(tilesAfter.terms > 0 && tilesAfter.terms < tilesBefore.terms, 'the common-only filter moves the distinct-reactions tile', `${tilesBefore.terms} -> ${tilesAfter.terms}`);
  await evaluate('window.__openFdaDemo.commonButton.click()');
  await sleep(400);
  await shoot('03-filtered');
  noErrors('saved copy, after the checks');

  /* =================================================================== */
  /* 2. What a visitor gets when the openFDA API cannot be reached.      */
  /* =================================================================== */

  await call('Network.enable');
  await call('Network.setBlockedURLs', { urls: ['*api.fda.gov*'] });
  await open(`${origin}/index.html`, 'live page, with the API unreachable');
  const fallback = await evaluate(`(() => {
    const d = window.__openFdaDemo;
    const notice = document.querySelector('.notice');
    const pill = document.querySelector('.head-note .pill');
    return {
      rows: d.termsGrid.rows.count(),
      painted: document.querySelectorAll('.lattice [role="row"]').length,
      fellBack: !!(d.timings && d.timings.fellBack),
      mode: d.timings && d.timings.mode,
      badge: pill ? pill.textContent.trim() : null,
      notice: notice ? notice.textContent.trim() : null,
      polling: !!d.poller,
    };
  })()`);
  console.log(`  rows ${fallback.rows}, badge "${fallback.badge}", fell back: ${fallback.fellBack}`);
  console.log(`  notice: ${fallback.notice}`);
  check(fallback.rows > 0, 'fallback: the saved copy is on screen', `${fallback.rows} rows`);
  check(fallback.painted > 0, 'fallback: the table painted rows', `${fallback.painted}`);
  check(fallback.fellBack, 'fallback: the page recorded that it fell back to the saved copy');
  check(fallback.mode === 'live', 'fallback: the page ran in the live default, not snapshot mode', `mode ${fallback.mode}`);
  check(fallback.badge === 'Saved copy', 'fallback: the badge reads "Saved copy"', `"${fallback.badge}"`);
  check(!!fallback.notice && /could not be reached/i.test(fallback.notice), 'fallback: the page says the API was unreachable', fallback.notice);
  check(!fallback.polling, 'fallback: no poll is started against an API that could not be reached');
  check(pageErrors.length === 0, 'fallback: no page errors', pageErrors.slice(0, 3).join(' | '));
  await shoot('04-fallback');
  await call('Network.setBlockedURLs', { urls: [] });

  if (all) {
    await open(`${origin}/index.html`, 'live');
    const live = await evaluate(`(() => {
      const d = window.__openFdaDemo;
      return {
        terms: d.termsGrid.rows.count(),
        reports: d.reportsGrid.rows.count(),
        charts: d.charts.length,
        fellBack: !!(d.timings && d.timings.fellBack),
        watermark: d.termsGrid.licence.watermark(),
        freshness: document.querySelector('.freshness').textContent,
        tiles: Object.fromEntries(d.kpi.tiles().map((t) => [t.id, t.value])),
      };
    })()`);
    console.log(`  ${live.terms} terms and ${live.reports} reports from the live API; ${live.freshness}`);
    check(live.fellBack === false, 'live: the rows came from the API, not the saved copy');
    check(live.terms > 0, 'live: the table holds rows from the API', `${live.terms}`);
    check(live.charts === 4, 'live: all four charts were built', `${live.charts}`);
    check(live.watermark === false, 'live: no watermark on localhost');
    check(typeof live.tiles.reports === 'number' && live.tiles.reports > 0, 'live: the tiles read the API', `${live.tiles.reports} reports`);
    noErrors('live');
    await shoot('05-live');
  }

  socket.close();
} catch (error) {
  failures.push(String((error && error.stack) || error));
} finally {
  if (browserPid) {
    try { process.kill(-browserPid, 'SIGKILL'); } catch {}
    try { process.kill(browserPid, 'SIGKILL'); } catch {}
  }
  if (server) server.close();
  await sleep(400);
  if (profile) await rm(profile, { recursive: true, force: true });
}

console.log('\nChecks:');
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} checks passed.`);
process.exit(0);
