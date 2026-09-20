# Adverse drug reactions reported to the FDA, live

A live dashboard of the adverse drug reactions reported to the FDA's openFDA
drug-event API, with the Pareto head of reaction terms, counts by sex and
seriousness, and grids derived from the data, built on Lattice Grid loaded by
`<script>` tag: no npm install, no bundler, no build step, no `type="module"`.

**[See it running](https://toclocoinc.github.io/lattice-grid-demo-openfda-umd/)**

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| Grid repository | [toclocoinc/latticegrid](https://github.com/toclocoinc/latticegrid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |

It is one live feed fanned through one data router: the reaction-term counts
(one row per MedDRA preferred term, its report count) and a sample of raw
reports (one row per safety report, its primary reaction, sex, seriousness and
reporter). The router partitions them by `kind`, so the two tables never mix.
Four charts read the data: the top reaction terms as bars, and bars for the
counts by sex, by seriousness and by drug.

The point of the demo is a heavy-tailed, live, keyless dataset where the Pareto
idea is the story: a few common reactions account for a large share of reports,
so the page shows the head of terms that reach 80%, a statistical profile of
the counts, and the terms as two-line cells with a data bar and a magnitude
colour.

## How the grid gets onto the page

Six tags in `index.html`, and that is the whole of the library setup:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/lattice-grid.min.css">

<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/lattice-grid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/charts.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/data-router.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/kpi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/tabs.min.js"></script>
```

Each file is the package's UMD build and leaves a global behind:

| File | Global | Used here for |
| --- | --- | --- |
| `lattice-grid.min.js` | `LatticeGrid` | `createGrid`, `createHeadlessGrid`, `setLicence` |
| `modules/charts.min.js` | extends `LatticeGrid` | `LatticeGrid.createChart` |
| `modules/data-router.min.js` | `LatticeGridDataRouter` | `createDataRouter` |
| `modules/kpi.min.js` | `LatticeGridKPI` | `createKPI` |
| `modules/tabs.min.js` | `LatticeGridTabs` | `createTabs` |

The charts module folds its exports into the core global rather than defining
one of its own, so its tag must come after the core's. The other three are
self-contained and can go in any order. `main.js` checks that every factory it
needs is actually there before it draws anything.

Every address names the exact release, `1.66.0`, and every tag carries the
`integrity` hash of the file it expects. The hashes are the SHA-384 of the
published files.

The demo's own code is four classic scripts, loaded in order:
`src/licence.js`, `src/openfda-feed.js`, `src/dashboard.js`, `main.js`. Each
file wraps itself in a function and puts what it offers on one plain object,
`OpenFdaDemo`, for the next file to read. `src/dashboard.js` is handed the
grid's factories as arguments and never touches a global itself.

## Running it

You need nothing but a browser and a way to serve the folder, because the page
fetches its data with `fetch()` and browsers will not do that from `file://`:

```
node tools/serve.mjs
```

| Address | What you get |
| --- | --- |
| `/` | live, reading the openFDA drug-event API and polling every ten minutes |
| `/?source=snapshot` | the saved copy in `data/snapshot`, no API needed |

Running a copy on your own machine needs no licence key. Publishing it on a
web address does.

## What it shows

**The top terms, as bars.** The thirty reaction terms that carry the most
reports, largest first, with the count read off the left axis. A few common
terms dwarf a long tail, which is what the Pareto head below makes precise.

**The Pareto head, as a derived grid.** A second grid whose rows come from the
reactions table, narrowed by `cumulative: { of: 'count', upTo: 0.8 }`: exactly
the terms that account for 80% of reports, so a reader can count them.

**Two-line cells and data bars.** Each reaction is drawn as a bold term over a
quieter "n% of reports" line, and its count as an in-cell bar sized against the
top term, so the head and the tail read at a glance.

**A statistical profile, as a derived grid and as numbers.** A derived grid
with `profile: ['count']` turns the column statistics into rows, and a line
under it reads the mean and median straight off `grid.statistics.profile`.
The median is a fraction of the mean, which is the long tail made numeric.

**Figures that follow the table.** The strip of tiles reads the reactions
table: reaction reports in view, distinct reactions, and the share accounted
for by the top twenty terms. Filter the table and every figure follows.

**Counts by sex, seriousness and drug.** Three bar charts, drawn from small
headless grids fed by the count endpoints.

**Reports that read as colours.** The reports table colours its seriousness
column as a pill — red for Serious, green for Non-serious — and can be grouped
by sex, seriousness or year.

**Conditional formatting as runtime state.** The count column is coloured by
magnitude band, and those rules are held by the grid, so a reader can open the
Formatting panel and change them.

**A feed that can fail.** If a poll cannot reach openFDA the page says so and
keeps showing what it already had. If the API cannot be reached when the page
first opens, it shows the saved copy instead and says so under the title.

## The data

Everything comes from the openFDA drug adverse-event API:

- <https://open.fda.gov/apis/drug/event/>

The page reads the reaction-term counts, a sample of raw reports, and the
counts by sex, seriousness and drug:

- `https://api.fda.gov/drug/event.json?count=patient.reaction.reactionmeddrapt.exact&limit=500`
- `https://api.fda.gov/drug/event.json?search=receivedate:[20150101+TO+20990101]&limit=200&sort=receivedate:desc`
- `https://api.fda.gov/drug/event.json?count=patient.patientsex`
- `https://api.fda.gov/drug/event.json?count=serious`
- `https://api.fda.gov/drug/event.json?count=patient.drug.openfda.generic_name.exact&limit=100`

The API is public, needs no key at low volume, and answers with open
cross-origin headers, so the browser reads it directly. The data are published
for public use.

A few things worth knowing about the data:

- The `count` endpoint returns the **largest** terms, so the long tail is cut
  off. Anonymous access tops out just below a thousand terms, so the page reads
  500 and the tail is truncated at 500.
- A reaction count is a report that **names** that reaction, so one report can
  stand behind several terms. The "reaction reports in view" tile is the sum of
  the term counts, not a count of unique safety reports.
- There is a soft limit of 240 requests a minute and 1,000 a day, so a request
  asked to wait (HTTP 429) is retried with a backoff rather than failing, and
  the live page polls slowly — every ten minutes.
- Reaction terms are MedDRA preferred terms; sex and seriousness arrive as
  numeric codes and are mapped to words in the feed.
- The reports table is a **sample** of recent reports, for the detail view and
  its derived "top reactions" grid; the reaction counts are the authoritative
  tally over the whole dataset.

## Files

```
index.html                page shell, and the six library tags
main.js                   works out where the data comes from, then starts
src/licence.js            the key for this demo's own published address
src/openfda-feed.js       the API: terms, reports, counts, polling, snapshot
src/dashboard.js          the views: router, tables, tiles, charts, derived grids
styles.css                the page around the grid
tools/serve.mjs           a small static file server
tools/build-snapshot.mjs  save a real run into data/snapshot
tools/verify.mjs          open it in a real browser and check it
data/snapshot/            a saved run, so the demo works without the API
```

There is no `package.json` and no `node_modules`. The tools need Node 22 or
newer and nothing else.

## Building the saved copy

```
node tools/build-snapshot.mjs
```

It reads the reaction-term counts, a sample of reports, and the counts by sex,
seriousness and drug, then writes compact arrays to `data/snapshot/`. Re-run it
to refresh the copy.

## Checking it

```
node tools/verify.mjs        # open the page in a real browser and assert
node tools/verify.mjs --all  # also open the live API
```

`tools/verify.mjs` first insists on how the library arrived: no `type="module"`
script anywhere on the page, five script tags pointing at the pinned release on
the CDN, each with an integrity hash, and each leaving the global it documents.
It then recomputes the headline figures from the saved data and compares them
with what the page is showing, checks the Pareto and bar charts drew marks and
that the Pareto head holds exactly the terms that reach 80%, reads the mean and
median off `grid.statistics.profile`, groups the reports, pushes a report
through to prove it lands there and not in the reactions table, filters the
reactions table and insists the tiles move, and finally blocks the openFDA API
in the browser and insists the saved copy appears with a notice saying why. The
GitHub Pages workflow runs it before every publish.

## Licence

The demo code is MIT. See `LICENSE`.

The drug adverse-event data is from openFDA, published for public use.

Lattice Grid itself is a separate commercial product with its own terms. It is
free to use on localhost, with no key and no watermark, so a copy of this
repository runs unrestricted on your own machine. This demo carries a key for
its own published address only, which is why you will find one in the source.
Keys for your own sites come from [latticegrid.dev](https://www.latticegrid.dev).

---
Built with [Lattice Grid](https://www.latticegrid.dev), a JavaScript data grid with a Data Router: one live feed keeps grids, charts, boards, Gantt and KPI tiles in step. [Documentation](https://www.latticegrid.dev/docs/) · [Demos](https://www.latticegrid.dev/demos/) · [Licence](https://www.latticegrid.dev/licence/)
