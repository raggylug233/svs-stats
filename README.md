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
  transcripts/<date>/   the hand-verified transcription: one TSV per alliance,
                        plus <state>_labyrinth.tsv per state
  build_snapshot.py     transcripts -> data/snapshots/<date>.json
  render_chart.py       data JSON -> charts/<date>_<state>.png
screenshots/<date>/<state>/            raw roster images — gitignored, local only
screenshots/<date>/<state>/Labyrinth/  raw leaderboard images — likewise
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

A player who placed in their state's Labyrinth top 100 also carries
`"labyrinth": 1707` (total stages) and `"labyrinthRank": 1`. Everyone else has
neither key — absent means "not on the board", which is not the same as a score
of zero, and the site keeps those rows at the bottom of the column whichever way
it is sorted.

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
4. For each state's Labyrinth board, compose with
   `python3 tools/compose.py --labyrinth /tmp/lab screenshots/<date>/<state>/Labyrinth/*.PNG`
   and transcribe to `tools/transcripts/<date>/<state>_labyrinth.tsv`. Optional —
   the build simply reports no scores if the file is absent.
5. `python3 tools/build_snapshot.py <date> tools/transcripts`

Both the transcripts and the `ALLIANCES` metadata are keyed by date, because
each batch covers whichever alliances were photographed that day. Rebuilding an
older date reads only that date's roster and leaves every other snapshot alone.

### What makes the data trustworthy

Step 5 **fails loudly** on two independent checks, and neither can be satisfied
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

To correct data later, edit the TSV and re-run step 5 — the TSV is the editable
record, the JSON is the generated artifact the site reads.

### Partially captured rosters

If a capture stops before the roster does, the alliance carries an explicit
`transcribedCount` and `partialNote` in `ALLIANCES`. The row check then runs
against the number of rows we *meant* to have, so it stays loud for a genuine
miscount, and the snapshot marks the alliance `"partial": true`. The site shows
those with a dagger and a footnote, since their totals and bars understate
reality. The total-power check is skipped for them — their sum is short by
design.

## The Labyrinth

Each state has a Labyrinth leaderboard: a **top 100** of chiefs by total stages
cleared. It is the single best available signal of a player's real strength, so
it is extracted alongside the rosters and joined onto them.

The board is state-wide, so it also lists alliances we do not track and players
with no alliance at all. `tools/transcripts/<date>/<state>_labyrinth.tsv` keeps
all 100 rows as `rank<TAB>allianceTag<TAB>chiefName<TAB>totalStages` — the board
as it stood — and the join drops what it cannot place:

```
python3 tools/compose.py --labyrinth /tmp/lab screenshots/<date>/<state>/Labyrinth/*.PNG
```

`--labyrinth` crops the leaderboard layout instead of the member list, dropping
the avatar between the rank badge and the name. Every row carries a unique rank,
so pages are merged on rank rather than on matching runs, and the build checks
that the ranks it ends up with run 1..100 with nothing missing.

The join matches on `(allianceTag, chiefName)` and reports what does not stick,
rather than dropping it quietly:

- **untracked alliances** — expected, just counted
- **no roster match** — the two extractions disagree, or the roster moved
  between captures; investigate
- **ambiguous** — one alliance with two players sharing a display name. If the
  board lists exactly as many, they are paired best-score-to-highest-power and
  both are flagged `labyrinthAmbiguous`, since nothing on either screen tells
  them apart.

## Charts

`chart.md` specifies the power-distribution chart: 25M power buckets on a
descending x-axis, bars stacked by rank R5→R1, one chart per alliance sorted by
total power, a single shared y-max, dark neon styling. It is implemented twice
from the same JSON:

- **interactively on the site**, with hover/tap tooltips and a state selector
- **as a PNG**: `.venv/bin/python tools/render_chart.py 2026.09.06 3178`

The same chart draws either measure, chosen with the **Measure** control on the
site or `-m` on the PNG tool:

```
.venv/bin/python tools/render_chart.py 2026.09.06 3178 -m labyrinth
```

Power uses 25M buckets over every player; Labyrinth uses 50-stage buckets and
starts at the lowest occupied bucket rather than zero, since scores cluster in a
narrow band. Only a state's top 100 have a score, so every Labyrinth view says
how many of the selected chiefs it actually covers.

On the site the charts have two views, chosen with the **Charts** control:

- *One per alliance* — the chart.md layout, banded under a heading per state
  when more than one state is in scope
- *One per state (aggregate)* — every selected alliance in a state combined
  into a single chart, still stacked by rank

The shared y-max is recomputed per view, since aggregating raises it.
Alliance and rank pickers are multi-select and drive the charts and both
tables together.

Above the player list, **Top 20 by state** puts each state's twenty best side by
side — one column per state, stacking on a phone — ranked by whichever measure
is selected, with a column total so the two are comparable at a glance.

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
| 3178 | `[TTC]` 東都 | 85 of 88 † | 24.67B † |
| 3178 | `[SIN]` BeechesOfChaos | 99 | 24.92B |
| 3178 | `[TEA]` TheEternalArt | 60 | 10.33B |
| 3213 | `[INK]` INK | 98 | 31.59B |
| 3213 | `[ICE]` TUBIG | 90 | 25.68B |
| 3213 | `[PXI]` pixies | 93 | 16.43B |

718 players total. The Labyrinth top 100 was captured for both states, joining
scores onto **193** of them — 96 of 3178's players and 97 of 3213's.

One board entry does not join: ``[ICE]ᴺᴬᴺᴼ` `` in 3213. ICE's roster is verified
complete at 90 and contains no such name (its `Nano` is a different, plainly
cased name), so this is roster drift between the two captures — a transfer into
ICE, or a rename, after the member list was shot. The build reports it rather
than guessing.

† `[TTC]` was captured in two passes. The first stopped 12 members into R1;
`IMG_2775`–`IMG_2776` re-shot that section six hours later, when R1 read 13
rather than 16. A re-shot Info screen still reads **88 members**, so those three
did not leave — they were promoted out of R1, into an R2 that the first pass had
photographed while it was still empty:

```
first pass  R5 1 + R4 11 + R3 60 + R2 0 + R1 16 = 88
now         R5 1 + R4 11 + R3 60 + R2 3 + R1 13 = 88
```

R2 is therefore the one section never photographed in its current state, and it
holds exactly the 3 members the roster is short (513,091,454 power, ~171M each).
The alliance total moved only +11,123,127 across those six hours, so this is a
rank reshuffle rather than growth. Shoot TTC's R2 section to close it out.

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
