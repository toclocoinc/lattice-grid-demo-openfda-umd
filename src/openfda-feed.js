/**
 * The openFDA drug adverse-event feeds: the reaction-term counts, a sample of
 * raw reports, and the counts by sex, seriousness and drug that the charts
 * draw.
 *
 * Nothing here knows about the grid. It produces plain objects and hands them
 * to whoever asked, so the same code feeds the live page and the saved copy.
 *
 * The API is public and needs no key at low volume, and it answers with open
 * cross-origin headers, so the browser reads it directly. There is a soft
 * limit of 240 requests a minute and 1,000 a day, so a request that is asked
 * to wait (HTTP 429) is retried with a backoff rather than failing.
 *
 * This is a classic script, not a module: there is no `import` or `export`
 * anywhere on this page. What this file offers is put on `OpenFdaDemo`, a plain
 * object on the global, and the next script reads it from there. The snapshot
 * tool runs this same file under Node, which is why it looks for `globalThis`
 * rather than `window`.
 */
(function (root) {
  'use strict';

  const BASE = 'https://api.fda.gov';

  /** How many reaction terms the count endpoint returns. Anonymous access tops
      out below 1,000, so this stays well inside it and inside the rate limit. */
  const COUNT_LIMIT = 500;

  /** How many raw reports the page holds, for the detail table and its derived
      grid. The count endpoint is the authoritative tally; this is a sample. */
  const REPORTS_LIMIT = 200;

  /** How many drug names the top-drugs chart reads. */
  const DRUGS_LIMIT = 100;

  /** How often the live page asks the API for changes. The dataset is a
      monthly snapshot of a safety database, so this is deliberately slow. */
  const POLL_MS = 10 * 60 * 1000;

  /** The sex codes the API numbers rows with, mapped to words. */
  const SEX_LABELS = {
    0: 'Unknown',
    1: 'Male',
    2: 'Female',
  };

  /** The seriousness codes, mapped to words. 1 is serious, 2 is not. */
  const SERIOUS_LABELS = {
    1: 'Serious',
    2: 'Non-serious',
  };

  /** The reporter qualification codes, mapped to words. */
  const QUALIFICATION_LABELS = {
    1: 'Physician',
    2: 'Pharmacist',
    3: 'Other health professional',
    4: 'Lawyer',
    5: 'Consumer or non-health professional',
  };

  /** The order the snapshot stores a term-count row in. */
  const COUNT_COLUMNS = ['term', 'count'];

  /** The order the snapshot stores a report row in. */
  const REPORT_COLUMNS = ['id', 'term', 'sex', 'serious', 'year', 'qualification'];

  /**
   * Fetch JSON from the API, retrying a moment later when the service asks us
   * to slow down. openFDA rate-limits bursts (240 a minute, 1,000 a day), so a
   * short pause and retry is enough rather than giving up.
   *
   * @param {string} url the endpoint
   * @param {string} describe what is being read, for the error message
   * @param {{signal?: AbortSignal}} [opts]
   * @returns {Promise<object>} the parsed body
   */
  async function requestJson(url, describe, opts = {}) {
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetch(url, {
        signal: opts.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      throw new Error(`The ${describe} answered ${response.status}.`);
    }
  }

  /** The `term` from a count result, uppercased and trimmed. */
  function cleanTerm(value) {
    return String(value == null ? '' : value).trim().toUpperCase();
  }

  /** Turn one `{term, count}` result into a count row. */
  function toCountRow(item) {
    return { term: cleanTerm(item.term), count: Number(item.count) || 0 };
  }

  /** The reaction-term counts, largest first. The Pareto data. */
  async function fetchReactionTerms(opts = {}) {
    const body = await requestJson(
      `${BASE}/drug/event.json?count=patient.reaction.reactionmeddrapt.exact&limit=${COUNT_LIMIT}`,
      'reaction term counts',
      opts,
    );
    return (body.results || []).map(toCountRow).filter((row) => row.term);
  }

  /** A count endpoint read as rows, with each term mapped through `labels`. */
  async function fetchCountRows(path, labels, opts = {}) {
    const body = await requestJson(`${BASE}/drug/event.json?count=${path}`, `count of ${path}`, opts);
    return (body.results || [])
      .map((item) => {
        const label = labels[Number(item.term)] != null ? labels[Number(item.term)] : String(item.term);
        return { term: label, count: Number(item.count) || 0 };
      })
      .filter((row) => row.term);
  }

  /** The counts by patient sex. */
  async function fetchSex(opts = {}) {
    return fetchCountRows('patient.patientsex', SEX_LABELS, opts);
  }

  /** The counts by seriousness. */
  async function fetchSerious(opts = {}) {
    return fetchCountRows('serious', SERIOUS_LABELS, opts);
  }

  /** The top drug names, by generic name. */
  async function fetchDrugs(opts = {}) {
    const body = await requestJson(
      `${BASE}/drug/event.json?count=patient.drug.openfda.generic_name.exact&limit=${DRUGS_LIMIT}`,
      'drug name counts',
      opts,
    );
    return (body.results || []).map(toCountRow).filter((row) => row.term);
  }

  /** The first reaction term a report names, or null when it names none. */
  function firstReaction(report) {
    const reactions = report && report.patient && report.patient.reaction;
    if (!Array.isArray(reactions) || !reactions.length) return null;
    return cleanTerm(reactions[0].reactionmeddrapt);
  }

  /** The calendar year of an openFDA `YYYYMMDD` date, or null. */
  function yearOf(dateText) {
    if (dateText == null) return null;
    const text = String(dateText);
    const match = /^(\d{4})/.exec(text);
    return match ? Number(match[1]) : null;
  }

  /** Turn one raw report into a flat row. */
  function toReportRow(report) {
    const patient = report && report.patient ? report.patient : {};
    const sexCode = Number(patient.patientsex);
    const seriousCode = Number(report.serious);
    const qualificationCode = report && report.primarysource ? Number(report.primarysource.qualification) : NaN;
    return {
      kind: 'report',
      id: String(report.safetyreportid || ''),
      term: firstReaction(report) || 'UNSPECIFIED',
      sex: SEX_LABELS[sexCode] || 'Unknown',
      serious: SERIOUS_LABELS[seriousCode] || 'Non-serious',
      year: yearOf(report.receivedate),
      qualification: QUALIFICATION_LABELS[qualificationCode] || 'Not recorded',
      count: 1,
    };
  }

  /** A sample of raw reports, most recent first. */
  async function fetchReports(opts = {}) {
    const body = await requestJson(
      `${BASE}/drug/event.json?search=receivedate:%5B20150101+TO+20990101%5D&limit=${REPORTS_LIMIT}&sort=receivedate:desc`,
      'reports sample',
      opts,
    );
    const rows = [];
    for (const report of body.results || []) {
      const row = toReportRow(report);
      if (row.id) rows.push(row);
    }
    return rows;
  }

  /**
   * Read everything the page starts from: the reaction-term counts, a sample
   * of reports, and the counts by sex, seriousness and drug.
   *
   * @param {{signal?: AbortSignal, onProgress?: Function}} [opts]
   * @returns {Promise<{terms: object[], reports: object[], sex: object[], serious: object[], drugs: object[]}>}
   */
  async function fetchInitial(opts = {}) {
    const report = opts.onProgress || (() => {});
    report('Reading the reaction terms...', 0.1);
    const terms = await fetchReactionTerms(opts);
    report('Reading a sample of reports...', 0.4);
    const reports = await fetchReports(opts);
    report('Reading the counts by sex, seriousness and drug...', 0.7);
    const [sex, serious, drugs] = await Promise.all([
      fetchSex(opts),
      fetchSerious(opts),
      fetchDrugs(opts),
    ]);
    report('Building the dashboard...', 1);
    return { terms, reports, sex, serious, drugs };
  }

  /**
   * Poll for fresh data and report each result.
   *
   * @param {object} opts
   * @param {(result: object) => void} opts.onPoll called with each successful poll
   * @param {(error: Error) => void} [opts.onError] called when a poll fails
   * @param {number} [opts.intervalMs] how often to poll
   * @returns {{stop: Function, pollNow: Function}} a handle that stops the polling
   */
  function startPolling({ onPoll, onError, intervalMs = POLL_MS }) {
    let stopped = false;
    let timer = null;
    const controller = new AbortController();

    const runOnce = async () => {
      if (stopped) return;
      try {
        const { terms, reports, sex, serious, drugs } = await fetchInitial({ signal: controller.signal });
        if (!stopped) onPoll({ terms, reports, sex, serious, drugs, fetchedAt: Date.now() });
      } catch (error) {
        if (!stopped && onError) onError(error);
      }
    };

    timer = setInterval(runOnce, intervalMs);

    return {
      stop() {
        stopped = true;
        clearInterval(timer);
        controller.abort();
      },
      pollNow: runOnce,
    };
  }

  /* ---------------- the snapshot ---------------- */

  /** Pack a term-count row (terms, sex, serious, drugs) into its compact form. */
  function encodeCount(row) {
    return COUNT_COLUMNS.map((col) => row[col]);
  }

  /** Unpack a compact count array back into a row. */
  function decodeCount(values) {
    const row = {};
    COUNT_COLUMNS.forEach((col, index) => {
      row[col] = values[index];
    });
    return row;
  }

  /** Pack a report row into its compact array form. */
  function encodeReport(row) {
    return REPORT_COLUMNS.map((col) => row[col]);
  }

  /** Unpack a compact report array back into a row, deriving `count`. */
  function decodeReport(values) {
    const row = {};
    REPORT_COLUMNS.forEach((col, index) => {
      row[col] = values[index];
    });
    row.kind = 'report';
    row.count = 1;
    return row;
  }

  /** Read the saved copy that ships with the demo. */
  async function readSnapshot() {
    const names = ['terms', 'reports', 'sex', 'serious', 'drugs', 'meta'];
    const [terms, reports, sex, serious, drugs, meta] = await Promise.all(
      names.map(async (name) => {
        const response = await fetch(`./data/snapshot/${name}.json`);
        if (!response.ok) throw new Error(`The saved copy is missing ${name}.json.`);
        return response.json();
      }),
    );
    return {
      terms: terms.map((values) => Object.assign(decodeCount(values), { kind: 'term' })),
      reports: reports.map(decodeReport),
      sex: sex.map((values) => Object.assign(decodeCount(values), { kind: 'sex' })),
      serious: serious.map((values) => Object.assign(decodeCount(values), { kind: 'serious' })),
      drugs: drugs.map((values) => Object.assign(decodeCount(values), { kind: 'drug' })),
      meta: { ...meta, live: false },
    };
  }

  root.OpenFdaDemo = Object.assign(root.OpenFdaDemo || {}, {
    BASE,
    COUNT_LIMIT,
    REPORTS_LIMIT,
    DRUGS_LIMIT,
    POLL_MS,
    SEX_LABELS,
    SERIOUS_LABELS,
    QUALIFICATION_LABELS,
    COUNT_COLUMNS,
    REPORT_COLUMNS,
    cleanTerm,
    toCountRow,
    toReportRow,
    firstReaction,
    yearOf,
    fetchReactionTerms,
    fetchSex,
    fetchSerious,
    fetchDrugs,
    fetchReports,
    fetchInitial,
    startPolling,
    encodeCount,
    decodeCount,
    encodeReport,
    decodeReport,
    readSnapshot,
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
