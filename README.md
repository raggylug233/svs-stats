# svs-stats

Power ranking intel for Whiteout Survival state-vs-state prep, published as a
static site on GitHub Pages.

**Screenshots are read exactly once.** Extraction produces JSON under `data/`,
and everything downstream — the site, the charts, any future analysis — reads
only that JSON. You never need to touch an image again unless you want to
*improve* an extraction.

## Layout

```
index.html              the site (GitHub Pages serves the repo root)
assets/                 styles + app JS, no dependencies, no CDN
data/
  index.json            list of available snapshots
  snapshots/<date>.json one snapshot: alliances + every player   <- source of truth
charts/                 rendered PNG charts (per chart.md)
tools/
  compose.py            screenshot -> legible composite, for extraction only
  transcripts/          the original hand-verified transcription, one TSV per alliance
  build_snapshot.py     transcripts -> data/snapshots/<date>.json
  render_chart.py       data JSON -> charts/<date>_<state>.png
screenshots/<date>/<state>/   raw source images — gitignored, local only
chart.md                the power-distribution chart specification
```

Screenshots are deliberately **not** committed: each batch is ~78 MB and git
history cannot be pruned without a rewrite. They live on disk so an extraction
can be improved later; the committed JSON is what everything actually reads.

The **state is the folder name** the screenshots live in (e.g. `3178`).

## Player record

```json
{
  "chiefName": "ANTHONY TARK",
  "power": 323300000,
  "rank": "R5",
  "furnace": "fc7",
  "alliance": "TheHouseofStark",
  "allianceTag": "STK",
  "state": "3073",
  "date": "2026.08.08"
}
```

Formatting follows the extraction rules: power expanded to a full integer,
rank as `R1`–`R5`, Fire Crystal furnaces as `fc##`, regular furnaces (shown
in-game as `Lv. ##`) as `f##`, date as `YYYY.MM.DD`, state numeric.

A player may also carry `"nameUncertain": true` — the name uses decorative
glyphs (superscripts, enclosed letters, lookalike blocks) whose exact
codepoints are hard to recover from a screenshot. The rendering is right; the
underlying characters may not be. Correct them in the TSV and rebuild.

## Adding a new snapshot

1. Drop the screenshots in `screenshots/<YYYY.MM.DD>/<state>/`, named so they
   sort in capture order. Each alliance is an Alliance Info screen followed by
   its scrolling member list.
2. Build legible composites: `python3 tools/compose.py /tmp/comp screenshots/<date>/<state>/*.PNG`
3. Transcribe each alliance to `tools/transcripts/<state>_<TAG>.tsv`
   (`rank<TAB>chiefName<TAB>power<TAB>furnace`), and add its entry to
   `ALLIANCES` in `tools/build_snapshot.py`.
4. `python3 tools/build_snapshot.py <date> tools/transcripts`

Step 4 **fails loudly** if any alliance's transcribed row count disagrees with
the member count on its Alliance Info screen. That check is what makes the data
trustworthy: the 2026.08.08 batch matched on all eight alliances, and each
rank section matched its own header count too.

To correct data later, edit the TSV and re-run step 4 — the TSV is the editable
record, the JSON is the generated artifact the site reads.

## Charts

`chart.md` specifies the power-distribution chart: 25M power buckets on a
descending x-axis, bars stacked by rank R5→R1, one chart per alliance sorted by
total power, a single shared y-max, dark neon styling. It is implemented twice
from the same JSON:

- **interactively on the site**, with hover/tap tooltips and a state selector
- **as a PNG**: `.venv/bin/python tools/render_chart.py 2026.08.08 3178`

On the site the charts have two views, chosen with the **Charts** control:

- *One per alliance* — the chart.md layout, banded under a heading per state
  when more than one state is in scope
- *One per state (aggregate)* — every selected alliance in a state combined
  into a single chart, still stacked by rank

The shared y-max is recomputed per view, since aggregating raises it.
Alliance and rank pickers are multi-select and drive the charts and both
tables together.

matplotlib ships no CJK font, so the PNG falls back to the alliance tag alone
for non-ASCII alliance names; the web chart shows them in full.

## Running locally

```
python3 -m http.server 8000     # then open http://localhost:8000
```

Opening `index.html` straight off disk will not work — the browser blocks the
`fetch` of the JSON.

## Coverage — 2026.08.08

| State | Alliance | Members |
|---|---|---|
| 3073 | `[STK]` TheHouseofStark | 88 |
| 3073 | `[INF]` INFINITY | 98 |
| 3073 | `[PrO]` FarmColective | 55 |
| 3073 | `[PWR]` OrganizedChaos | 9 |
| 3178 | `[VKR]` Vikings | 98 |
| 3178 | `[UFO]` Aliens | 98 |
| 3178 | `[TTC]` 東都 | 86 |
| 3178 | `[SIN]` BeechesOfChaos | 99 |

631 players total.
