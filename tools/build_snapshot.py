#!/usr/bin/env python3
"""Build a canonical snapshot JSON from transcribed alliance rosters.

This runs once per screenshot batch. After it has run, the JSON in data/ is the
source of truth — nothing downstream ever reads the screenshots again. Re-run
only to improve an extraction.

Input: one TSV per alliance, named <state>_<tag>.tsv, rows of
    rank<TAB>chiefName<TAB>power<TAB>furnace
Output: data/snapshots/<date>.json + refreshed data/index.json

Usage: python3 tools/build_snapshot.py <date> <tsv-dir>
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Alliance metadata keyed by "<state>_<tag>", transcribed from the Alliance Info
# screenshot that precedes each roster.
ALLIANCES = {
    "3073_STK": {
        "tag": "STK", "name": "TheHouseofStark", "state": "3073",
        "memberCount": 88, "memberCapacity": 100,
        "infoImage": "IMG_2114.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2115, 2123)],
        "rankLabels": {"R4": "High Table", "R3": "The Divine", "R2": "The Noble", "R1": "Wanderer"},
    },
    "3073_INF": {
        "tag": "INF", "name": "INFINITY", "state": "3073",
        "memberCount": 98, "memberCapacity": 100,
        "infoImage": "IMG_2123.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2124, 2133)],
        "rankLabels": {"R4": "Council", "R3": "Infinity", "R2": "X Com/Tele", "R1": "UP or OUT"},
    },
    "3073_PrO": {
        "tag": "PrO", "name": "FarmColective", "state": "3073",
        "memberCount": 55, "memberCapacity": 100,
        "infoImage": "IMG_2133.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2134, 2140)],
        "rankLabels": {"R4": "R4 PrO", "R3": "Regular", "R2": "Time2Time", "R1": "Inactive"},
    },
    "3073_PWR": {
        "tag": "PWR", "name": "OrganizedChaos", "state": "3073",
        "memberCount": 9, "memberCapacity": 100,
        "infoImage": "IMG_2140.PNG", "rosterImages": ["IMG_2141.PNG", "IMG_2142.PNG"],
        "rankLabels": {"R4": "HighTable", "R3": "The Divine", "R2": "The Elite", "R1": "Valiant"},
    },
    "3178_VKR": {
        "tag": "VKR", "name": "Vikings", "state": "3178",
        "memberCount": 98, "memberCapacity": 100,
        "infoImage": "IMG_2143.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2144, 2153)],
        "rankLabels": {"R4": "Jarls", "R3": "Karls", "R2": "Thralls", "R1": "Draugr"},
    },
    "3178_UFO": {
        "tag": "UFO", "name": "Aliens", "state": "3178",
        "memberCount": 98, "memberCapacity": 100,
        "infoImage": "IMG_2153.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2154, 2163)],
        "rankLabels": {"R4": "Alliance Rank 4", "R3": "Alliance Rank 3",
                       "R2": "Alliance Rank 2", "R1": "Alliance Rank 1"},
    },
    "3178_TTC": {
        "tag": "TTC", "name": "東都", "state": "3178",
        "memberCount": 86, "memberCapacity": 100,
        "infoImage": "IMG_2163.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2164, 2172)],
        "rankLabels": {"R4": "연맹 계급 4", "R3": "연맹 계급 3",
                       "R2": "연맹 계급 2", "R1": "연맹 계급 1"},
    },
    "3178_SIN": {
        "tag": "SIN", "name": "BeechesOfChaos", "state": "3178",
        "memberCount": 99, "memberCapacity": 100,
        "infoImage": "IMG_2172.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2173, 2183)],
        "rankLabels": {"R4": "R04", "R3": "R03", "R2": "Check msg", "R1": "Offline 5+"},
    },
}

RANK_ORDER = ["R5", "R4", "R3", "R2", "R1"]


def parse_power(raw: str) -> int:
    """'605.9M' -> 605900000; '421,016' -> 421016."""
    raw = raw.strip()
    if raw.upper().endswith("M"):
        return round(float(raw[:-1].replace(",", "")) * 1_000_000)
    return int(raw.replace(",", ""))


def check_furnace(raw: str) -> str:
    if not re.fullmatch(r"(fc\d{1,2}|f\d{1,2})", raw):
        raise ValueError(f"bad furnace value: {raw!r}")
    return raw


# Scripts we transcribe with confidence. Names using glyphs outside these — the
# decorative superscripts, enclosed letters and lookalike blocks players favour —
# get flagged so they can be corrected without re-reading every screenshot.
TRUSTED_SCRIPTS = ("LATIN", "CJK", "HIRAGANA", "KATAKANA", "HANGUL",
                   "CYRILLIC", "ARABIC", "IDEOGRAPHIC", "FULLWIDTH")


def name_is_uncertain(name: str) -> bool:
    for ch in name:
        if ch.isascii() or ch.isspace():
            continue
        try:
            n = unicodedata.name(ch)
        except ValueError:
            return True
        if not any(s in n for s in TRUSTED_SCRIPTS):
            return True
        if "MODIFIER LETTER" in n or "CIRCLED" in n or "SQUARED" in n:
            return True
    return False


def main() -> None:
    date, tsv_dir = sys.argv[1], Path(sys.argv[2])
    players, alliances, problems = [], [], []

    for key, meta in ALLIANCES.items():
        rows = [
            line.split("\t")
            for line in (tsv_dir / f"{key}.tsv").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        counts = {r: 0 for r in RANK_ORDER}
        for rank, name, power, furnace in rows:
            counts[rank] += 1
            player = {
                "chiefName": name,
                "power": parse_power(power),
                "rank": rank,
                "furnace": check_furnace(furnace.strip()),
                "alliance": meta["name"],
                "allianceTag": meta["tag"],
                "state": meta["state"],
                "date": date,
            }
            if name_is_uncertain(name):
                player["nameUncertain"] = True
            if not name:
                player["nameUncertain"] = True
                player["note"] = "chief name renders blank in-game"
            players.append(player)

        if len(rows) != meta["memberCount"]:
            problems.append(
                f"{key}: transcribed {len(rows)} rows, info screen says {meta['memberCount']}"
            )
        alliances.append({**meta, "key": key, "rankCounts": counts,
                          "totalPower": sum(p["power"] for p in players
                                            if p["allianceTag"] == meta["tag"]
                                            and p["state"] == meta["state"])})

    if problems:
        raise SystemExit("roster count mismatch:\n  " + "\n  ".join(problems))

    snapshot = {
        "date": date,
        "states": sorted({a["state"] for a in alliances}),
        "playerCount": len(players),
        "alliances": alliances,
        "players": players,
    }
    out = REPO / "data" / "snapshots" / f"{date}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    snaps = sorted(p.stem for p in out.parent.glob("*.json"))
    index = {
        "snapshots": [
            {
                "date": d,
                "file": f"snapshots/{d}.json",
                "states": json.loads((out.parent / f"{d}.json").read_text(encoding="utf-8"))["states"],
            }
            for d in snaps
        ]
    }
    (REPO / "data" / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    flagged = sum(1 for p in players if p.get("nameUncertain"))
    print(f"wrote {out.relative_to(REPO)}: {len(players)} players, "
          f"{len(alliances)} alliances, {flagged} names flagged for review")


if __name__ == "__main__":
    main()
