/**
 * Save a real run of the openFDA drug adverse-event API to
 * `data/snapshot/`, so the dashboard can also be opened with no network.
 *
 * Run it with `node tools/build-snapshot.mjs`. It is a development tool:
 * nothing the page loads imports it.
 *
 * The feed code the page uses is a classic script, not a module, so it cannot
 * be imported. It is run here instead, in this process, exactly as the browser
 * runs it: the file leaves its functions on `globalThis.OpenFdaDemo` and they
 * are read from there. One copy of the feed code, used by both.
 *
 * It saves the reaction-term counts, a sample of raw reports, and the counts
 * by sex, seriousness and drug.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data', 'snapshot');

const feedFile = join(here, '..', 'src', 'openfda-feed.js');
runInThisContext(await readFile(feedFile, 'utf8'), { filename: feedFile });
const { fetchInitial, encodeCount, encodeReport } = globalThis.OpenFdaDemo;

const started = Date.now();
const { terms, reports, sex, serious, drugs } = await fetchInitial({
  onProgress: (message) => console.log(`  ${message}`),
});

const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

const meta = {
  fetchedAt: new Date().toISOString(),
  fetchedAtMs: Date.now(),
  seconds,
  terms: terms.length,
  reports: reports.length,
  sex: sex.length,
  serious: serious.length,
  drugs: drugs.length,
  source: 'openFDA drug adverse-event API',
  sourceUrl: 'https://open.fda.gov/apis/drug/event/',
  licence: 'openFDA data are published for public use',
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'terms.json'), JSON.stringify(terms.map(encodeCount)));
await writeFile(join(outDir, 'reports.json'), JSON.stringify(reports.map(encodeReport)));
await writeFile(join(outDir, 'sex.json'), JSON.stringify(sex.map(encodeCount)));
await writeFile(join(outDir, 'serious.json'), JSON.stringify(serious.map(encodeCount)));
await writeFile(join(outDir, 'drugs.json'), JSON.stringify(drugs.map(encodeCount)));
await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

console.log(`\nSaved ${terms.length} reaction terms and ${reports.length} reports in ${seconds}s.`);
console.log(`  sex: ${sex.length} rows, serious: ${serious.length} rows, drugs: ${drugs.length} rows`);
