#!/usr/bin/env python3
"""Render the alliance power distribution chart described in chart.md.

Same spec as the interactive chart on the site, emitted as the high-resolution
PNG chart.md asks for. Input is the extracted snapshot JSON — never the
screenshots.

Usage: python3 tools/render_chart.py <date> [state] [-o out.png]
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("date")
    ap.add_argument("state", nargs="?", help="limit to one state (e.g. 3178)")
    ap.add_argument("-o", "--out")
    args = ap.parse_args()

    snap = json.loads(
        (REPO / "data" / "snapshots" / f"{args.date}.json").read_text(encoding="utf-8")
    )
    players = [p for p in snap["players"] if not args.state or p["state"] == args.state]
    if not players:
        raise SystemExit(f"no players for state {args.state} in {args.date}")

    for p in players:
        p["bucket"] = int(np.ceil(p["power"] / BUCKET_SIZE) * BUCKET_SIZE)
        p["label"] = chart_label(p["allianceTag"], p["alliance"])

    max_bucket = max(p["bucket"] for p in players)
    buckets = list(range(BUCKET_SIZE, max_bucket + BUCKET_SIZE, BUCKET_SIZE))

    totals = {}
    for p in players:
        totals[p["label"]] = totals.get(p["label"], 0) + p["power"]
    order = sorted(totals, key=totals.get, reverse=True)

    stacked = {}
    for p in players:
        key = (p["label"], p["bucket"], p["rank"])
        stacked[key] = stacked.get(key, 0) + p["power"]

    y_max = 0
    for label in order:
        for b in buckets:
            y_max = max(y_max, sum(stacked.get((label, b, r), 0) for r in RANK_ORDER))
    y_max = int(np.ceil(y_max / 50_000_000) * 50_000_000)

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

        ax.set_title(
            f"{label} — Total: {totals[label] / 1e9:.2f}B",
            color="white", fontsize=18, pad=18,
        )
        ax.set_ylim(0, y_max)
        ax.set_xticks(range(len(buckets)))
        ax.set_xticklabels(
            [f"{int(b / 1e6)}m" for b in buckets[::-1]], rotation=45, color="white"
        )
        ax.tick_params(axis="x", colors="white")
        ax.tick_params(axis="y", colors="white")
        ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(billions))
        ax.grid(axis="y", linestyle="--", alpha=0.18, color="white")
        for spine in ax.spines.values():
            spine.set_visible(False)

    scope = args.state or "All states"
    fig.suptitle(
        f"{scope} Alliance Power Distribution by 25M Buckets  •  "
        f"Shared Y Max: {y_max / 1e9:.2f}B",
        color="white", fontsize=22, y=0.985,
    )
    handles = [plt.Rectangle((0, 0), 1, 1, color=COLORS[r]) for r in RANK_ORDER]
    fig.legend(
        handles, RANK_ORDER, loc="upper center", ncol=5, frameon=False,
        labelcolor="white", bbox_to_anchor=(0.5, 0.972), fontsize=12,
    )
    plt.subplots_adjust(top=0.90, hspace=0.62)

    out = Path(args.out) if args.out else REPO / "charts" / f"{args.date}_{args.state or 'all'}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(out, dpi=220, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close()
    print(out)


if __name__ == "__main__":
    main()
