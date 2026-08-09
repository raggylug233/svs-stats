#!/usr/bin/env python3
"""Build one upscaled, side-by-side composite per "Alliance Members" screenshot.

The member list is two columns of cards. Each card's readable content (name,
power, furnace badge) sits to the right of its avatar. We crop the two columns'
text regions, drop most of the dead space, and upscale — giving a single image
per screenshot in which every name is legible enough to transcribe exactly.

The left crop deliberately starts far enough left to include the rank section
headers ("R3  The Divine"), which span the list and carry each player's rank.

Usage: python3 tools/compose.py <outdir> <img.png> [<img.png> ...]
"""
import sys
from pathlib import Path

from PIL import Image

LIST_TOP, LIST_BOTTOM = 620, 2110
LEFT = (95, 615)   # left column: rank-header badge through end of card
RIGHT = (755, 1110)  # right column: card text region only
SCALE = 1.45
GUTTER = 12


def compose(src: Path, outdir: Path) -> Path:
    im = Image.open(src).convert("RGB")
    left = im.crop((LEFT[0], LIST_TOP, LEFT[1], LIST_BOTTOM))
    right = im.crop((RIGHT[0], LIST_TOP, RIGHT[1], LIST_BOTTOM))
    w = left.width + GUTTER + right.width
    out = Image.new("RGB", (w, left.height), (40, 40, 40))
    out.paste(left, (0, 0))
    out.paste(right, (left.width + GUTTER, 0))
    out = out.resize((int(w * SCALE), int(out.height * SCALE)), Image.LANCZOS)
    outdir.mkdir(parents=True, exist_ok=True)
    dst = outdir / f"{src.stem}_c.png"
    out.save(dst)
    return dst


def main() -> None:
    outdir = Path(sys.argv[1])
    for p in sys.argv[2:]:
        print(compose(Path(p), outdir))


if __name__ == "__main__":
    main()
