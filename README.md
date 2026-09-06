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
  transcripts/<date>/   the hand-verified transcription, one TSV per alliance
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

Most are detected automatically by script. The exception is CJK *lookalike*
glyphs standing in for Latin letters (`毛匚万丅卂万丫`), which no script check can
tell from a genuine Chinese name — add a 5th TSV column of `?` to mark those by
hand.

## Adding a new snapshot

1. Drop the screenshots in `screenshots/<YYYY.MM.DD>/<state>/`, named so they
   sort in capture order. Each alliance is an Alliance Info screen followed by
   its scrolling member list.
2. Build legible composites: `python3 tools/compose.py /tmp/comp screenshots/<date>/<state>/*.PNG`
3. Transcribe each alliance to `tools/transcripts/<date>/<state>_<TAG>.tsv`
   (`rank<TAB>chiefName<TAB>power<TAB>furnace`), and add its entry under that
   date in `ALLIANCES` in `tools/build_snapshot.py`.
4. `python3 tools/build_snapshot.py <date> tools/transcripts`

Both the transcripts and the `ALLIANCES` metadata are keyed by date, because
each batch covers whichever alliances were photographed that day. Rebuilding an
older date reads only that date's roster and leaves every other snapshot alone.

### What makes the data trustworthy

Step 4 **fails loudly** on two independent checks, and neither can be satisfied
by a plausible-looking guess:

- **Row count** — each alliance's transcribed rows must equal the member count
  on its Alliance Info screen. Each rank section is also read back against its
  own header count while transcribing.
- **Total power** — the Info screen states an exact alliance total, while each
  member card shows power *truncated* to 0.1M. So the roster must sum to
  somewhere between the stated total minus 0.1M per member, and the stated total
  exactly. That bound is directional and tight: a single misread digit anywhere
  in a 99-player roster breaks it.

The second check exists because the first cannot see a wrong number, only a
wrong count. Together they caught the 2026.09.06 batch cleanly — every complete
alliance landed inside the truncation window, typically ~0.05M per member below
the stated total, exactly as truncation predicts.

To correct data later, edit the TSV and re-run step 4 — the TSV is the editable
record, the JSON is the generated artifact the site reads.

### Partially captured rosters

If a capture stops before the roster does, the alliance carries an explicit
`transcribedCount` and `partialNote` in `ALLIANCES`. The row check then runs
against the number of rows we *meant* to have, so it stays loud for a genuine
miscount, and the snapshot marks the alliance `"partial": true`. The site shows
those with a dagger and a footnote, since their totals and bars understate
reality. The total-power check is skipped for them — their sum is short by
design.

## Charts

`chart.md` specifies the power-distribution chart: 25M power buckets on a
descending x-axis, bars stacked by rank R5→R1, one chart per alliance sorted by
total power, a single shared y-max, dark neon styling. It is implemented twice
from the same JSON:

- **interactively on the site**, with hover/tap tooltips and a state selector
- **as a PNG**: `.venv/bin/python tools/render_chart.py 2026.09.06 3178`

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

## Coverage

### 2026.09.06

| State | Alliance | Members | Total power |
|---|---|---|---|
| 3178 | `[VKR]` Vikings | 99 | 33.51B |
| 3178 | `[UFO]` Aliens | 94 | 25.29B |
| 3178 | `[TTC]` 東都 | 85 † | 24.67B † |
| 3178 | `[SIN]` BeechesOfChaos | 99 | 24.92B |
| 3178 | `[TEA]` TheEternalArt | 60 | 10.33B |
| 3213 | `[INK]` INK | 98 | 31.59B |
| 3213 | `[ICE]` TUBIG | 90 | 25.68B |
| 3213 | `[PXI]` pixies | 93 | 16.43B |

718 players total.

† `[TTC]` was captured in two passes. The first stopped 12 members into R1;
`IMG_2775`–`IMG_2776` re-shot that section about six hours later, by which point
R1 had gone from 16 members to 13 — three left, ~502M between them. The roster
is complete, but its R1 is six hours younger than the rest, and the Alliance
Info screen from the first pass now describes an alliance that no longer exists
(88 members / 25.17B against the 85 we hold). Its member count therefore comes
from the rank-section headers, which are finer-grained and all agree at the
later time (1 + 11 + 60 + 0 + 13 = 85), and the total-power cross-check is
skipped for this alliance alone. Re-shoot its Info screen to restore it.

This batch covers state **3213** for the first time, and `[TEA]` TheEternalArt
is new in 3178. State 3073, covered on 2026.08.08, was not captured this time —
snapshots are independent, and the site's date selector switches between them.

### 2026.08.08

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
