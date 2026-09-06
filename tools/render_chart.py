#!/usr/bin/env python3
"""Render the alliance power distribution chart described in chart.md.

Same spec as the interactive chart on the site, emitted as the high-resolution
PNG chart.md asks for. Input is the extracted snapshot JSON — never the
screenshots.

Usage: python3 tools/render_chart.py <date> [state] [-m power|labyrinth] [-o out.png]
"""
import argparse
import json
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
BUCKET_SIZE = 25_000_000
RANK_ORDER = ["R5", "R4", "R3", "R2", "R1"]
COLORS = {
    "R5": "#5B8CFF",  # neon blue
    "R4": "#C300FF",  # neon purple
    "R3": "#33D1D1",  # cyan
    "R2": "#FFC300",  # yellow
    "R1": "#FF2D7A",  # pink
}


def chart_label(tag: str, name: str) -> str:
    """Matplotlib's bundled fonts carry no CJK, so a name it cannot draw would
    come out as tofu boxes. Fall back to the tag alone in that case; the web
    chart, which uses system fonts, still shows the full name."""
    if all(ch.isascii() for ch in name):
        return f"[{tag}] {name}"
    return f"[{tag}]"


def billions(value: float, _pos: int) -> str:
    return f"{value / 1e9:.1f}B"


def plain(value: float, _pos: int) -> str:
    return f"{value:,.0f}"


# The two things a chart can be about. Power is on every player; the Labyrinth
# score is only on the players who made their state's top 100, so a chart of it
# covers a subset and says so.
METRICS = {
    "power": {
        "key": "power", "label": "Power", "bucket": 25_000_000,
        "bucket_word": "25M", "y_step": 50_000_000, "from_zero": True,
        "tick": billions, "axis": lambda v: f"{v / 1e9:.2f}B",
        "bucket_label": lambda b: f"{int(b / 1e6)}m",
    },
    "labyrinth": {
        "key": "labyrinth", "label": "Labyrinth", "bucket": 50,
        "bucket_word": "50-stage", "y_step": 5_000, "from_zero": False,
        "tick": plain, "axis": lambda v: f"{v:,.0f}",
        "bucket_label": lambda b: f"{int(b):,}",
    },
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("date")
    ap.add_argument("state", nargs="?", help="limit to one state (e.g. 3178)")
    ap.add_argument("-m", "--metric", choices=sorted(METRICS), default="power")
    ap.add_argument("-o", "--out")
    args = ap.parse_args()
    M = METRICS[args.metric]

    snap = json.loads(
        (REPO / "data" / "snapshots" / f"{args.date}.json").read_text(encoding="utf-8")
    )
    players = [p for p in snap["players"] if not args.state or p["state"] == args.state]
    if not players:
        raise SystemExit(f"no players for state {args.state} in {args.date}")
    players = [p for p in players if p.get(M["key"]) is not None]
    if not players:
        raise SystemExit(
            f"no {args.metric} values for state {args.state or 'any'} in {args.date}"
        )

    size = M["bucket"]
    for p in players:
        p["bucket"] = int(np.ceil(p[M["key"]] / size) * size)
        p["label"] = chart_label(p["allianceTag"], p["alliance"])

    lo = size if M["from_zero"] else min(p["bucket"] for p in players)
    max_bucket = max(p["bucket"] for p in players)
    buckets = list(range(lo, max_bucket + size, size))

    totals, counts = {}, {}
    for p in players:
        totals[p["label"]] = totals.get(p["label"], 0) + p[M["key"]]
        counts[p["label"]] = counts.get(p["label"], 0) + 1
    order = sorted(totals, key=totals.get, reverse=True)

    stacked = {}
    for p in players:
        key = (p["label"], p["bucket"], p["rank"])
        stacked[key] = stacked.get(key, 0) + p[M["key"]]

    y_max = 0
    for label in order:
        for b in buckets:
            y_max = max(y_max, sum(stacked.get((label, b, r), 0) for r in RANK_ORDER))
    y_max = int(np.ceil(y_max / M["y_step"]) * M["y_step"]) or M["y_step"]

    fig, axes = plt.subplots(len(order), 1, figsize=(14, max(8, 4 * len(order))))
    if len(order) == 1:
        axes = [axes]
    fig.patch.set_facecolor("black")

    for ax, label in zip(axes, order):
        ax.set_facecolor("black")
        bottom = np.zeros(len(buckets))
        for rank in RANK_ORDER:
            vals = np.array(
                [stacked.get((label, b, rank), 0) for b in buckets[::-1]], dtype=float
            )
            ax.bar(range(len(buckets)), vals, bottom=bottom, color=COLORS[rank], width=0.86)
            bottom += vals

        ranked = "" if args.metric == "power" else f"  ({counts[label]} ranked)"
        ax.set_title(
            f"{label} — Total: {M['axis'](totals[label])}{ranked}",
            color="white", fontsize=18, pad=18,
        )
        ax.set_ylim(0, y_max)
        ax.set_xticks(range(len(buckets)))
        ax.set_xticklabels(
            [M["bucket_label"](b) for b in buckets[::-1]], rotation=45, color="white"
        )
        ax.tick_params(axis="x", colors="white")
        ax.tick_params(axis="y", colors="white")
        ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(M["tick"]))
        ax.grid(axis="y", linestyle="--", alpha=0.18, color="white")
        for spine in ax.spines.values():
            spine.set_visible(False)

    scope = args.state or "All states"
    fig.suptitle(
        f"{scope} Alliance {M['label']} Distribution by {M['bucket_word']} Buckets  •  "
        f"Shared Y Max: {M['axis'](y_max)}",
        color="white", fontsize=22, y=0.985,
    )
    handles = [plt.Rectangle((0, 0), 1, 1, color=COLORS[r]) for r in RANK_ORDER]
    fig.legend(
        handles, RANK_ORDER, loc="upper center", ncol=5, frameon=False,
        labelcolor="white", bbox_to_anchor=(0.5, 0.972), fontsize=12,
    )
    plt.subplots_adjust(top=0.90, hspace=0.62)

    suffix = "" if args.metric == "power" else f"_{args.metric}"
    out = (Path(args.out) if args.out
           else REPO / "charts" / f"{args.date}_{args.state or 'all'}{suffix}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out, dpi=220, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close()
    print(out)


if __name__ == "__main__":
    main()
