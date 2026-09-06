#!/usr/bin/env python3
"""Build one upscaled composite per roster screenshot, for extraction only.

Two screens, two layouts:

*Alliance Members* (default) — the member list is two columns of cards. Each
card's readable content (name, power, furnace badge) sits to the right of its
avatar. We crop the two columns' text regions, drop most of the dead space, and
upscale, giving a single image per screenshot in which every name is legible
enough to transcribe exactly. The left crop deliberately starts far enough left
to include the rank section headers ("R3  The Divine"), which span the list and
carry each player's rank.

*The Labyrinth* (--labyrinth) — a single-column state leaderboard of
rank / [TAG]chief / total stages. The avatar sits between the rank badge and the
name and carries no information, so we drop it and butt the rank badge against
the text.

Usage: python3 tools/compose.py [--labyrinth] <outdir> <img.png> [<img.png> ...]
"""
import sys
from pathlib import Path

from PIL import Image

LIST_TOP, LIST_BOTTOM = 620, 2110
LEFT = (95, 615)   # left column: rank-header badge through end of card
RIGHT = (755, 1110)  # right column: card text region only
SCALE = 1.45
GUTTER = 12

# Labyrinth leaderboard. The bottom of the crop stops above the pinned "your own
# rank" row, which repeats on every screenshot and is not part of the list.
LAB_TOP, LAB_BOTTOM = 1000, 2330
LAB_RANK = (90, 200)    # rank badge
LAB_TEXT = (370, 1150)  # [TAG]chief through the score, skipping the avatar
LAB_SCALE = 1.15


def compose(src: Path, outdir: Path) -> Path:
    im = Image.open(src).convert("RGB")
    left = im.crop((LEFT[0], LIST_TOP, LEFT[1], LIST_BOTTOM))
    right = im.crop((RIGHT[0], LIST_TOP, RIGHT[1], LIST_BOTTOM))
    return _emit(left, right, SCALE, src, outdir)


def compose_labyrinth(src: Path, outdir: Path) -> Path:
    im = Image.open(src).convert("RGB")
    rank = im.crop((LAB_RANK[0], LAB_TOP, LAB_RANK[1], LAB_BOTTOM))
    text = im.crop((LAB_TEXT[0], LAB_TOP, LAB_TEXT[1], LAB_BOTTOM))
    return _emit(rank, text, LAB_SCALE, src, outdir)


def _emit(a: Image.Image, b: Image.Image, scale: float, src: Path, outdir: Path) -> Path:
    w = a.width + GUTTER + b.width
    out = Image.new("RGB", (w, a.height), (40, 40, 40))
    out.paste(a, (0, 0))
    out.paste(b, (a.width + GUTTER, 0))
    out = out.resize((int(w * scale), int(out.height * scale)), Image.LANCZOS)
    outdir.mkdir(parents=True, exist_ok=True)
    dst = outdir / f"{src.stem}_c.png"
    out.save(dst)
    return dst


def main() -> None:
    args = sys.argv[1:]
    fn = compose
    if args and args[0] == "--labyrinth":
        fn, args = compose_labyrinth, args[1:]
    outdir = Path(args[0])
    for p in args[1:]:
        print(fn(Path(p), outdir))


if __name__ == "__main__":
    main()
