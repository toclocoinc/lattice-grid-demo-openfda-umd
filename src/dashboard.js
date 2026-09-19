/**
 * The dashboard: the reaction-term counts and a sample of reports, fanned
 * through one data router, with a Pareto chart, bar charts for the other
 * dimensions, and derived grids built on top.
 *
 * Nothing here fetches anything and nothing here reaches for the grid's
 * globals: every factory is handed in, so this file is the same whether the
 * library arrived by script tag, as it does here, or by import.
 *
 * How the pieces fit together:
 *
 *   the API  ->  the router  ->  the reactions grid  ->  the tiles
 *                             ->  the reports grid        the Pareto chart
 *                                   |                     the derived grids
 *                                   +-> the sex / serious / drug headless grids
 *
 * The reactions grid holds one row per adverse-reaction term with its report
 * count; the reports grid holds a sample of raw reports. Both arrive in one
 * stream carrying a `kind`, and the router partitions them on it. The counts
 * by sex, seriousness and drug are small headless grids that feed bar charts.
 *
 * A classic script: it reads the constants from `OpenFdaDemo`, put there by
 * `openfda-feed.js`, and adds `buildDashboard` alongside them.
 */
(function (root) {
  'use strict';

  /** Make an element with a class and optional text, the long way round. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** One number, written the way a reader expects to see it. */
  function commas(value) {
    return Number(value || 0).toLocaleString('en-GB');
  }

  /** A clock time, local to whoever is reading. */
  function clockText(ms) {
    return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /** A whole-number share of a total, as a readable percentage. */
  function pct(part, total) {
    if (!total) return '0.0%';
    return `${((part / total) * 100).toFixed(1)}%`;
  }

  /* ------------------------------------------------------------------ */
  /* Columns                                                             */
  /* ------------------------------------------------------------------ */

  /** The reaction-term columns: a two-line cell and a count with a data bar. */
  function termColumns(topCount, totalCount) {
    return [
      {
        title: 'The reaction',
        columns: [
          {
            id: 'term',
            field: 'term',
            title: 'Reaction',
            filter: { type: 'text' },
            layout: { width: 380 },
            /* The term over its share of all reports: a bold line, then the
               quieter share underneath. */
            cell: {
              render: 'twoline',
              props: { secondary: (p) => (p && p.data && p.data.count != null ? `${pct(p.data.count, totalCount)} of reports` : '') },
            },
          },
        ],
      },
      {
        title: 'How often',
        columns: [
          {
            id: 'count',
            field: 'count',
            title: 'Reports',
            type: 'number',
            total: 'sum',
            groupTotal: 'sum',
            format: { type: 'number', notation: 'compact', decimals: 1 },
            filter: { type: 'number' },
            layout: { width: 170 },
            /* The bar is the term's count relative to the top term, so the
               head and the long tail read at a glance. */
            cell: { decoration: { type: 'bar', min: 0, max: topCount } },
          },
        ],
      },
    ];
  }

  /**
   * The magnitude bands on the count column. These are conditional formatting
   * rules the grid holds as runtime state, so a reader can open the Formatting
   * panel and change them.
   *
   * @param {number} topCount the largest term count
   * @returns {object} rules keyed by column id
   */
  function countFormatting(topCount) {
    const head = Math.round(topCount * 0.1);
    const common = Math.round(topCount * 0.02);
    return {
      count: [
        { id: 'count-head', label: `Head term (≥ ${commas(head)})`, when: { op: 'gte', value: head }, style: { color: '#b42318', fontWeight: '700' } },
        { id: 'count-common', label: `Common (≥ ${commas(common)})`, when: { op: 'gte', value: common }, style: { color: '#175cd3', fontWeight: '600' } },
        { id: 'count-tail', label: 'Long tail', when: { op: 'lt', value: common }, style: { color: '#98a2b3' } },
      ],
    };
  }

  /** The report columns: the seriousness column is a status pill. */
  function reportColumns() {
    return [
      {
        title: 'The report',
        columns: [
          { id: 'id', field: 'id', title: 'Report id', filter: { type: 'text' }, layout: { width: 140 } },
          { id: 'term', field: 'term', title: 'Primary reaction', filter: { type: 'set' }, layout: { width: 240 } },
          { id: 'year', field: 'year', title: 'Year', type: 'number', filter: { type: 'number' }, layout: { width: 84 } },
        ],
      },
      {
        title: 'Who and how',
        columns: [
          {
            id: 'serious',
            field: 'serious',
            title: 'Seriousness',
            filter: { type: 'set' },
            layout: { width: 150 },
            cell: {
              decoration: 'pill',
              variant: {
                when: [
                  { op: 'eq', value: 'Serious', use: 'danger' },
                  { op: 'eq', value: 'Non-serious', use: 'success' },
                ],
                default: 'neutral',
              },
            },
          },
          { id: 'sex', field: 'sex', title: 'Sex', filter: { type: 'set' }, layout: { width: 110 } },
          { id: 'qualification', field: 'qualification', title: 'Reported by', filter: { type: 'set' }, layout: { width: 230 } },
        ],
      },
      {
        title: 'Count',
        columns: [
          { id: 'count', field: 'count', title: 'Reports', type: 'number', total: 'sum', groupTotal: 'sum', filter: { type: 'none' }, layout: { width: 90, hidden: true } },
        ],
      },
    ];
  }

  /** The shared grid settings the two tables use. */
  function baseGridConfig(title) {
    return {
      rowKey: 'id',
      theme: 'light',
      density: 'compact',
      stripedRows: true,
      columnMenu: true,
      groupPanel: true,
      statusBar: true,
      find: true,
      grandTotalRow: 'bottom',
      groupDefaultExpanded: 0,
      toolPanel: { side: 'right', panels: ['filters', 'columns', 'formatting'] },
      selection: 'multiple',
      highlightOnChange: { colour: '#ffe8a3', duration: 2500 },
      title,
    };
  }

  /* ------------------------------------------------------------------ */
  /* The dashboard                                                       */
  /* ------------------------------------------------------------------ */

  function buildDashboard({
    root: host,
    createGrid,
    createHeadlessGrid,
    createChart,
    createKPI,
    createTabs,
    createDataRouter,
    terms,
    reports,
    sex,
    serious,
    drugs,
    meta,
  }) {
    host.textContent = '';

    const topCount = terms.length ? terms.reduce((max, row) => Math.max(max, row.count), 0) : 1;
    const totalCount = terms.reduce((sum, row) => sum + row.count, 0);

    const built = {
      termsGrid: null,
      reportsGrid: null,
      paretoHeadGrid: null,
      topTermsGrid: null,
      profileGrid: null,
      router: null,
      kpi: null,
      charts: [],
      tabs: null,
      store: new Map(),
      statsProfile: null,
      status: { lastPoll: null, lastError: null, polls: 0, arrivals: 0, revisions: 0 },
    };

    /* ---------------- the masthead ---------------- */

    const header = el('header', 'head');
    const heading = el('div', 'head-text');
    heading.append(el('h1', null, 'Adverse drug reactions reported to the FDA, live'));
    heading.append(
      el(
        'p',
        'lede',
        'The reaction terms openFDA tallies across the FDA Adverse Event Reporting System, with the Pareto head ' +
          'that accounts for most reports, the counts by sex and seriousness, and grids derived from the data. ' +
          'Built with Lattice Grid loaded by script tag, with no install and no build.',
      ),
    );
    if (meta.fellBack) {
      heading.append(
        el(
          'p',
          'notice',
          'The openFDA API could not be reached, so this is the saved copy. Reloading the page will try again.',
        ),
      );
    }
    header.append(heading);

    const provenance = el('div', 'head-note');
    const modePill = el('span', 'pill', meta.live ? 'Live' : 'Saved copy');
    const liveDot = el('span', 'dot');
    if (meta.live) modePill.prepend(liveDot);
    const freshness = el('span', 'freshness', 'Waiting for the first update...');
    provenance.append(modePill, freshness);
    header.append(provenance);
    host.append(header);

    /* ---------------- the tiles ---------------- */

    const kpiHost = el('section', 'kpi-strip');
    kpiHost.setAttribute('aria-label', 'Headline figures');
    const panelHost = el('div', 'kpi-panel');
    const namedTile = el('div', 'kpi-named');
    const namedValue = el('div', 'kpi-named-value', 'No data');
    const namedLabel = el('div', 'kpi-named-label', 'Most reported reaction in view');
    namedTile.append(namedValue, namedLabel);
    kpiHost.append(panelHost, namedTile);
    host.append(kpiHost);

    /* ---------------- the charts ---------------- */

    const chartHost = el('section', 'chart-wrap');
    chartHost.setAttribute('aria-label', 'Charts');
    const chartBoxes = [];
    for (let i = 0; i < 4; i += 1) {
      const box = el('div', 'chart-box');
      chartHost.append(box);
      chartBoxes.push(box);
    }
    host.append(chartHost);

    /* ---------------- the controls ---------------- */

    const actions = el('div', 'actions');
    host.append(actions);

    /* ---------------- the tables ---------------- */

    const tabsHost = el('section', 'tabs-host');
    host.append(tabsHost);

    const tabs = createTabs(tabsHost, {
      createGrid,
      createHeadlessGrid,
      ariaLabel: 'Adverse drug reaction views',
      tabs: [
        {
          id: 'reactions',
          label: 'Adverse reactions',
          badge: true,
          config: {
            ...baseGridConfig('Adverse drug reactions reported to the FDA, by term'),
            rowKey: 'term',
            rowHeight: 42,
            columns: termColumns(topCount, totalCount),
            formatting: countFormatting(topCount),
            rows: [],
          },
        },
        {
          id: 'reports',
          label: 'Reports',
          badge: true,
          config: {
            ...baseGridConfig('A sample of raw adverse-event reports'),
            columns: reportColumns(),
            rows: [],
          },
        },
      ],
    });
    built.tabs = tabs;
    built.termsGrid = tabs.tab('reactions');

    /* Materialise the reports grid now, rather than on first activation, so
       the derived grid below has a source to read from the moment the page is
       drawn. Both switches are synchronous and paint once. */
    tabs.activate('reports', { silent: true });
    built.reportsGrid = tabs.tab('reports');
    tabs.activate('reactions', { silent: true });

    /* ---------------- the router ---------------- */

    /*
     * One stream in, two tables out, split on `kind`. A term row and a report
     * row never share an identifier, and the two tables key on different
     * fields (`term` and `id`), so each route names its own key. The counting
     * subscriber below matches every row, which is what the "N new, M revised"
     * readout under the masthead reads; `overlap: true` lets one row reach
     * both its table and that subscriber.
     */
    const router = createDataRouter({
      key: (row) => row.kind,
      rowKey: 'id',
      overlap: true,
    });
    built.router = router;

    router.attach(built.termsGrid, 'term', { rowKey: 'term' });
    router.attach(built.reportsGrid, 'report', { rowKey: 'id' });
    router.subscribe(() => true, (change) => {
      built.status.arrivals += (change.add || []).length;
      built.status.revisions += (change.update || []).length;
    });

    const ingest = (incoming) => {
      if (!incoming || !incoming.length) return 0;
      for (const row of incoming) built.store.set(`${row.kind}:${row.term || row.id}`, row);
      router.apply(incoming.map((row) => ({ op: 'upsert', row })));
      return incoming.length;
    };

    const withKind = (rows, kind) => rows.map((row) => Object.assign({}, row, { kind }));
    for (const row of withKind(terms, 'term')) built.store.set(`term:${row.term}`, row);
    for (const row of withKind(reports, 'report')) built.store.set(`report:${row.id}`, row);
    router.load([...built.store.values()]);

    /* ---------------- the tiles, bound to the reactions table ---------------- */

    const kpi = createKPI(panelHost, {
      grid: built.termsGrid,
      rowKey: 'term',
      fields: ['term', 'count'],
      columns: 3,
      ariaLabel: 'Headline figures',
      tiles: [
        { id: 'reports', label: 'Reaction reports in view', aggregation: 'sum', field: 'count', format: 'compact' },
        { id: 'terms', label: 'Distinct reactions', aggregation: 'count', format: 'number' },
        {
          id: 'top20share',
          label: 'Share from the top 20 terms',
          aggregation: 'custom',
          format: 'percent',
          compute: (tileRows) => {
            const total = tileRows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
            if (!total) return null;
            const top20 = [...tileRows].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 20);
            return top20.reduce((sum, row) => sum + (Number(row.count) || 0), 0) / total;
          },
        },
      ],
    });
    built.kpi = kpi;

    /** Name the most reported reaction in view. */
    const refreshNamedTile = () => {
      let best = null;
      kpi.rows.forEach((row) => {
        const term = row.term;
        const count = Number(row.count) || 0;
        if (term && (!best || count > best.count)) best = { term, count };
      });
      if (!best) {
        namedValue.textContent = 'No data';
        namedLabel.textContent = 'Most reported reaction in view';
        return;
      }
      namedValue.textContent = best.term;
      namedLabel.textContent = `Most reported in view, ${commas(best.count)} reports`;
    };
    kpi.on('change', refreshNamedTile);
    refreshNamedTile();

    /* ---------------- the charts ---------------- */

    /* The headline chart reads a derived head of the reactions table: the
       thirty largest terms. Drawing all five hundred would shrink every bar to
       a fraction of a pixel, so the chart binds to a grid that already holds
       only the head, and because it is derived it still follows the table's
       filter. It is drawn as a plain bar chart: the built-in pareto type drops
       the left count axis, so a bar chart is what keeps the figures readable.
       The cumulative story lives in the Pareto-head grid below. */
    const paretoSource = createHeadlessGrid({
      columns: [
        { id: 'term', field: 'term', type: 'text' },
        { id: 'count', field: 'count', type: 'number' },
      ],
      source: {
        mode: 'derived',
        from: built.termsGrid,
        follow: 'filtered',
        sort: [{ col: 'count', dir: 'desc' }],
        limit: 30,
      },
    });
    built.paretoSource = paretoSource;

    const paretoChart = createChart({
      grid: paretoSource,
      container: chartBoxes[0],
      type: 'bar',
      x: 'term',
      y: 'count',
      title: 'Top 30 reaction terms, largest first',
      axis: {
        y: 'Reports',
        x: { rotate: 'auto', every: 2 },
      },
      legend: false,
    });
    built.charts.push(paretoChart);

    /** A small headless grid and its bar chart, for one count dimension. */
    const dimensionChart = (box, rows, title, yTitle) => {
      try {
        const grid = createHeadlessGrid({
          rowKey: 'term',
          columns: [
            { id: 'term', field: 'term', type: 'text' },
            { id: 'count', field: 'count', type: 'number' },
          ],
        });
        grid.rows.load(rows);
        const chart = createChart({
          grid,
          container: box,
          type: 'bar',
          x: 'term',
          y: 'count',
          title,
          axis: { y: yTitle, x: { labels: true, rotate: 'auto' } },
          legend: false,
        });
        built.charts.push(chart);
        return { grid, chart };
      } catch (error) {
        box.append(el('p', 'chart-error', `This chart could not be drawn: ${error.message}`));
        console.error('[openfda demo] chart', title, error);
        return null;
      }
    };

    built.sexGrid = dimensionChart(chartBoxes[1], sex, 'Reports by patient sex', 'Reports').grid;
    built.seriousGrid = dimensionChart(chartBoxes[2], serious, 'Reports by seriousness', 'Reports').grid;
    built.drugsGrid = dimensionChart(chartBoxes[3], drugs, 'Top drugs by generic name', 'Reports').grid;

    /* ---------------- the derived grids ---------------- */

    const derivedHost = el('section', 'derived-wrap');
    derivedHost.setAttribute('aria-label', 'Derived grids');
    const headBox = el('div', 'derived-box');
    const topTermsBox = el('div', 'derived-box');
    const profileBox = el('div', 'derived-box');
    derivedHost.append(headBox, topTermsBox, profileBox);
    host.append(derivedHost);

    try {
      built.paretoHeadGrid = createGrid(headBox, {
        rowKey: '__key',
        title: 'The Pareto head — the terms that reach 80% of reports',
        columns: [
          { id: 'term', field: 'term', title: 'Reaction', filter: { type: 'text' }, layout: { width: 300 } },
          { id: 'count', field: 'count', title: 'Reports', type: 'number', format: { type: 'number', notation: 'compact', decimals: 1 }, layout: { width: 130 } },
        ],
        source: {
          mode: 'derived',
          from: built.termsGrid,
          sort: [{ col: 'count', dir: 'desc' }],
          cumulative: { of: 'count', upTo: 0.8 },
        },
      });
    } catch (error) {
      headBox.append(el('p', 'chart-error', `This derived grid could not be built: ${error.message}`));
      console.error('[openfda demo] pareto head grid', error);
    }

    try {
      built.topTermsGrid = createGrid(topTermsBox, {
        rowKey: '__key',
        title: 'Top reactions in the reports sample (derived from the reports table)',
        columns: [
          { id: 'term', field: 'term', title: 'Reaction', layout: { width: 300 } },
          { id: 'count', field: 'count', title: 'Reports', type: 'number', layout: { width: 110 } },
        ],
        source: {
          mode: 'derived',
          from: built.reportsGrid,
          groupBy: 'term',
          select: { count: { of: 'count', fn: 'sum' } },
          sort: [{ col: 'count', dir: 'desc' }],
          limit: 15,
        },
      });
    } catch (error) {
      topTermsBox.append(el('p', 'chart-error', `This derived grid could not be built: ${error.message}`));
      console.error('[openfda demo] top terms grid', error);
    }

    try {
      built.profileGrid = createGrid(profileBox, {
        rowKey: '__key',
        title: 'A statistical profile of the counts, as rows',
        columns: [
          { id: 'column', field: 'column', title: 'Column', layout: { width: 90 } },
          { id: 'present', field: 'present', title: 'Values', type: 'number', layout: { width: 90 } },
          { id: 'distinct', field: 'distinct', title: 'Distinct', type: 'number', layout: { width: 90 } },
          { id: 'min', field: 'min', title: 'Min', type: 'number', format: { type: 'number', notation: 'compact', decimals: 0 }, layout: { width: 100 } },
          { id: 'q1', field: 'q1', title: 'Q1', type: 'number', format: { type: 'number', notation: 'compact', decimals: 0 }, layout: { width: 100 } },
          { id: 'median', field: 'median', title: 'Median', type: 'number', format: { type: 'number', notation: 'compact', decimals: 0 }, layout: { width: 110 } },
          { id: 'q3', field: 'q3', title: 'Q3', type: 'number', format: { type: 'number', notation: 'compact', decimals: 0 }, layout: { width: 100 } },
          { id: 'max', field: 'max', title: 'Max', type: 'number', format: { type: 'number', notation: 'compact', decimals: 0 }, layout: { width: 110 } },
          { id: 'mean', field: 'mean', title: 'Mean', type: 'number', format: { type: 'number', notation: 'compact', decimals: 0 }, layout: { width: 110 } },
          { id: 'stddev', field: 'stddev', title: 'Std dev', type: 'number', format: { type: 'number', notation: 'compact', decimals: 0 }, layout: { width: 110 } },
        ],
        source: {
          mode: 'derived',
          from: built.termsGrid,
          profile: ['count'],
        },
      });
    } catch (error) {
      profileBox.append(el('p', 'chart-error', `This derived grid could not be built: ${error.message}`));
      console.error('[openfda demo] profile grid', error);
    }

    /* ---------------- the statistics readout ---------------- */

    const statsNote = el('p', 'stats-note', '');
    derivedHost.append(statsNote);

    /** Read the mean and median straight off the grid's statistics surface. */
    const refreshStatsNote = () => {
      const profile = built.termsGrid.statistics.profile('count');
      built.statsProfile = profile;
      if (!profile || profile.median == null) {
        statsNote.textContent = 'No statistics to report yet.';
        return;
      }
      statsNote.textContent =
        `Over the ${commas(profile.present || 0)} terms in view, the mean is ${commas(Math.round(profile.mean || 0))} reports ` +
        `and the median is ${commas(Math.round(profile.median || 0))}, which is why the Pareto head matters: ` +
        'a few common terms dominate a long tail.';
    };
    built.refreshStatsNote = refreshStatsNote;
    refreshStatsNote();

    /* ---------------- the controls ---------------- */

    const button = (label, onClick, className) => {
      const node = el('button', className || 'action', label);
      node.type = 'button';
      node.addEventListener('click', onClick);
      return node;
    };

    const termsActions = el('span', 'actions-group');
    termsActions.append(el('span', 'actions-label', 'Order by'));
    termsActions.append(button('Largest first', () => built.termsGrid && built.termsGrid.sort.set([{ col: 'count', dir: 'desc' }])));
    termsActions.append(button('A\u2013Z', () => built.termsGrid && built.termsGrid.sort.set([{ col: 'term', dir: 'asc' }])));

    const commonButton = button('Only common reactions', () => {
      const on = commonButton.getAttribute('aria-pressed') === 'true';
      const threshold = Math.round(topCount * 0.02);
      built.termsGrid.filters.where('common', on ? null : (row) => typeof row.count === 'number' && row.count >= threshold);
      commonButton.setAttribute('aria-pressed', String(!on));
      commonButton.classList.toggle('on', !on);
    }, 'action toggle');
    commonButton.setAttribute('aria-pressed', 'false');
    termsActions.append(el('span', 'actions-gap'));
    termsActions.append(commonButton);
    actions.append(termsActions);
    built.commonButton = commonButton;

    const reportsActions = el('span', 'actions-group');
    reportsActions.append(el('span', 'actions-label', 'Group by'));
    reportsActions.append(button('Sex', () => built.reportsGrid && built.reportsGrid.columns.group(['sex'])));
    reportsActions.append(button('Seriousness', () => built.reportsGrid && built.reportsGrid.columns.group(['serious'])));
    reportsActions.append(button('Year', () => built.reportsGrid && built.reportsGrid.columns.group(['year'])));
    reportsActions.append(button('No grouping', () => built.reportsGrid && built.reportsGrid.columns.group([])));

    const seriousButton = button('Serious only', () => {
      const on = seriousButton.getAttribute('aria-pressed') === 'true';
      built.reportsGrid.filters.where('seriousOnly', on ? null : (row) => row.serious === 'Serious');
      seriousButton.setAttribute('aria-pressed', String(!on));
      seriousButton.classList.toggle('on', !on);
    }, 'action toggle');
    seriousButton.setAttribute('aria-pressed', 'false');
    reportsActions.append(el('span', 'actions-gap'));
    reportsActions.append(seriousButton);
    actions.append(reportsActions);
    built.seriousButton = seriousButton;

    const showActionsFor = (id) => {
      termsActions.hidden = id !== 'reactions';
      reportsActions.hidden = id !== 'reports';
    };
    showActionsFor(tabs.activeId);
    tabs.on('tab:changed', (event) => showActionsFor(event.id));

    /* ---------------- the live readout ---------------- */

    const setFreshness = () => {
      if (!meta.live) {
        const saved = new Date(meta.fetchedAt).toLocaleString('en-GB');
        freshness.textContent = `A saved copy of the openFDA data, taken on ${saved}.`;
        freshness.className = 'freshness';
        return;
      }
      if (built.status.lastError) {
        freshness.textContent = built.status.lastPoll
          ? `Could not reach the API. Still showing what arrived at ${clockText(built.status.lastPoll)}.`
          : 'Could not reach the API.';
        freshness.className = 'freshness failed';
        return;
      }
      if (!built.status.lastPoll) {
        freshness.textContent = 'Waiting for the first update...';
        freshness.className = 'freshness';
        return;
      }
      freshness.textContent =
        `Updated ${clockText(built.status.lastPoll)}. ` +
        `${commas(built.status.arrivals)} new, ${commas(built.status.revisions)} revised since the page opened.`;
      freshness.className = 'freshness';
    };
    built.setFreshness = setFreshness;

    /** Take a poll's result: apply it, refresh the figures and say so. */
    built.onPoll = (result) => {
      built.status.lastPoll = result.fetchedAt || Date.now();
      built.status.lastError = null;
      built.status.polls += 1;
      liveDot.classList.add('beat');
      setTimeout(() => liveDot.classList.remove('beat'), 900);
      ingest([...withKind(result.terms, 'term'), ...withKind(result.reports, 'report')]);
      if (built.sexGrid) built.sexGrid.rows.load(result.sex);
      if (built.seriousGrid) built.seriousGrid.rows.load(result.serious);
      if (built.drugsGrid) built.drugsGrid.rows.load(result.drugs);
      refreshStatsNote();
      setFreshness();
    };

    /** Take a failed poll: keep the table, say what happened. */
    built.onPollError = (error) => {
      built.status.lastError = String((error && error.message) || error);
      setFreshness();
      console.warn('[openfda demo] a poll failed:', built.status.lastError);
    };

    /* A hook for the verification script and for anyone poking at the page:
       push rows through exactly the path a poll uses. */
    built.ingest = ingest;

    setFreshness();

    /* ---------------- the footer ---------------- */

    const footer = el('footer', 'foot');
    const line = el('p', null, 'Adverse-event data from the ');
    const link = el('a', null, 'openFDA drug adverse-event API');
    link.href = 'https://open.fda.gov/apis/drug/event/';
    link.rel = 'noopener';
    line.append(link);
    line.append(
      document.createTextNode(
        '. The results are unvalidated reports from the FDA Adverse Event Reporting System, published for public use. ' +
          'Reaction terms are MedDRA preferred terms; the count endpoint returns the largest terms, so the tail is cut off. ' +
          'A reaction count is a report that names the reaction, so one report can stand behind several terms.',
      ),
    );
    footer.append(line);
    host.append(footer);

    built.destroy = () => {
      for (const chart of built.charts) chart.destroy();
      kpi.destroy();
      router.destroy();
      tabs.destroy();
    };

    return built;
  }

  root.OpenFdaDemo.buildDashboard = buildDashboard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
