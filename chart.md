Claude.md — Alliance Power Distribution Chart

Purpose

Generate a high-resolution stacked bar chart showing alliance power distribution by power bucket and rank.

This chart is designed for Whiteout Survival alliance comparison reports. It groups players into 25 million power buckets, stacks total power in each bucket by rank, and creates one vertically stacked chart per alliance.

Expected Input

Use an Excel or CSV file containing player-level data with at least these columns:

```text
Chief Name
Power
Rank
Alliance
```

Optional columns may also exist:

```text
Furnace
State
Date
```

For the 3243 chart, the source workbook was:

```text
3174 v 3243.xlsx
```

The script should select the worksheet whose name contains 3243. If no sheet name contains 3243, fall back to the last worksheet.

Data Rules

Power Bucketing

Bucket player power into 25,000,000 increments.

Use the upper bound of the bucket as the bucket value.

Examples:

```text
1 to 25,000,000           -> 25m
25,000,001 to 50,000,000  -> 50m
50,000,001 to 75,000,000  -> 75m
```

Python logic:

```python
bucket_size = 25_000_000
df["Bucket"] = (np.ceil(df["Power"] / bucket_size) * bucket_size).astype(int)
```

X-Axis

• Show buckets from largest to smallest.
• Label only the upper bound.
• Abbreviate in millions.

Examples:

```text
500m, 475m, 450m, 425m, ... 25m
```

Missing Buckets

All bucket positions should exist for every alliance, even when the value is zero. This keeps all alliance charts aligned and comparable.

Stack Order

Bars must be stacked by rank in this bottom-to-top order:

```text
R5
R4
R3
R2
R1
```

Alliance Sorting

Create one chart per alliance.

Sort charts by total alliance power descending.

```python
totals = df.groupby("Alliance")["Power"].sum().sort_values(ascending=False)
```

Y-Axis Rules

All alliance charts must share the same Y-axis maximum.

Calculate the maximum stacked bucket total across all alliances, then round up to the nearest 50 million.

```python
y_max = df.groupby(["Alliance", "Bucket"])["Power"].sum().max()
y_max = int(np.ceil(y_max / 50_000_000) * 50_000_000)
```

Display the shared Y max in the chart header.

Visual Style

Use a dark, neon gamer style.

Canvas

• Black background
• High-resolution PNG
• Vertical layout
• One chart per alliance
• Extra spacing between charts
• Extra spacing below the header

Text

• White chart title
• White axis labels
• White tick labels
• Alliance chart title includes total power

Example title:

```text
ABC — Total: 5.42B
```

Main header example:

```text
3243 Alliance Power Distribution by 25M Buckets • Shared Y Max: 0.80B
```

Grid

• Horizontal grid lines only
• Dashed
• Subtle opacity
• White with low alpha

```python
ax.grid(axis="y", linestyle="--", alpha=0.18, color="white")
```

Legends

• Remove individual legends from each chart.
• Add one shared legend at the top.
• Legend order should match stack order:

```text
R5, R4, R3, R2, R1
```

Rank Colors

Use this neon palette:

```python
colors = {
    "R5": "#5B8CFF",  # neon blue
    "R4": "#C300FF",  # neon purple
    "R3": "#33D1D1",  # cyan
    "R2": "#FFC300",  # yellow
    "R1": "#FF2D7A",  # pink
}
```

Output

Create a single high-resolution PNG.

For the 3243 chart, output path:

```text
/mnt/data/3243_power_distribution_chart.png
```

Reference Implementation

```python
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from openpyxl import load_workbook

xlsx_path = "/mnt/data/3174 v 3243.xlsx"

wb = load_workbook(xlsx_path, read_only=True)
sheet_names = wb.sheetnames

target_sheet = None
for s in sheet_names:
    if "3243" in s:
        target_sheet = s
        break

if target_sheet is None:
    target_sheet = sheet_names[-1]

df = pd.read_excel(xlsx_path, sheet_name=target_sheet)

df.columns = [str(c).strip() for c in df.columns]
df["Power"] = pd.to_numeric(df["Power"], errors="coerce")

bucket_size = 25_000_000
df["Bucket"] = (np.ceil(df["Power"] / bucket_size) * bucket_size).astype(int)

max_bucket = int(df["Bucket"].max())
buckets = list(range(bucket_size, max_bucket + bucket_size, bucket_size))

totals = df.groupby("Alliance")["Power"].sum().sort_values(ascending=False)

y_max = df.groupby(["Alliance", "Bucket"])["Power"].sum().max()
y_max = int(np.ceil(y_max / 50_000_000) * 50_000_000)

colors = {
    "R5": "#5B8CFF",
    "R4": "#C300FF",
    "R3": "#33D1D1",
    "R2": "#FFC300",
    "R1": "#FF2D7A",
}

rank_order = ["R5", "R4", "R3", "R2", "R1"]

fig, axes = plt.subplots(
    len(totals),
    1,
    figsize=(14, max(8, 4 * len(totals)))
)

if len(totals) == 1:
    axes = [axes]

fig.patch.set_facecolor("black")

for ax, alliance in zip(axes, totals.index.tolist()):
    ax.set_facecolor("black")
    sub = df[df["Alliance"] == alliance]
    bottom = np.zeros(len(buckets))

    for rank in rank_order:
        vals = []

        for b in buckets[::-1]:
            vals.append(
                sub[
                    (sub["Bucket"] == b) &
                    (sub["Rank"] == rank)
                ]["Power"].sum()
            )

        vals = np.array(vals)

        ax.bar(
            range(len(buckets)),
            vals,
            bottom=bottom,
            color=colors[rank],
            width=0.86
        )

        bottom += vals

    ax.set_title(
        f"{alliance} — Total: {totals[alliance]/1e9:.2f}B",
        color="white",
        fontsize=18,
        pad=18
    )

    ax.set_ylim(0, y_max)

    ax.set_xticks(range(len(buckets)))
    ax.set_xticklabels(
        [f"{int(b/1e6)}m" for b in buckets[::-1]],
        rotation=45,
        color="white"
    )

    ax.tick_params(axis="x", colors="white")
    ax.tick_params(axis="y", colors="white")
    ax.grid(axis="y", linestyle="--", alpha=0.18, color="white")

    for spine in ax.spines.values():
        spine.set_visible(False)

fig.suptitle(
    f"3243 Alliance Power Distribution by 25M Buckets  •  Shared Y Max: {y_max/1e9:.2f}B",
    color="white",
    fontsize=22,
    y=0.985
)

handles = [
    plt.Rectangle((0, 0), 1, 1, color=colors[r])
    for r in rank_order
]

fig.legend(
    handles,
    rank_order,
    loc="upper center",
    ncol=5,
    frameon=False,
    labelcolor="white",
    bbox_to_anchor=(0.5, 0.972),
    fontsize=12
)

plt.subplots_adjust(top=0.90, hspace=0.62)

out_path = "/mnt/data/3243_power_distribution_chart.png"

plt.savefig(
    out_path,
    dpi=220,
    bbox_inches="tight",
    facecolor=fig.get_facecolor()
)

plt.close()
print(out_path)
```

Common Modifications

Filter to Specific Alliances

```python
alliances_keep = ["XYZ", "AAG", "BBL", "TRK"]
df = df[df["Alliance"].isin(alliances_keep)].copy()
```

Use Latest Snapshot Only

If the workbook contains historical snapshots and has a Date column:

```python
df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
latest_date = df["Date"].max()
df = df[df["Date"] == latest_date].copy()
```

For latest snapshot per alliance:

```python
latest_dates = df.groupby("Alliance")["Date"].max()

df = pd.concat(
    [
        df[
            (df["Alliance"] == alliance) &
            (df["Date"] == latest_date)
        ]
        for alliance, latest_date in latest_dates.items()
    ],
    ignore_index=True
)
```

Change State Title

```python
state = "3243"
fig.suptitle(
    f"{state} Alliance Power Distribution by 25M Buckets  •  Shared Y Max: {y_max/1e9:.2f}B",
    color="white",
    fontsize=22,
    y=0.985
)
```
