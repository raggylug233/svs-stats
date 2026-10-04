#!/usr/bin/env python3
"""Build a canonical snapshot JSON from transcribed alliance rosters.

This runs once per screenshot batch. After it has run, the JSON in data/ is the
source of truth — nothing downstream ever reads the screenshots again. Re-run
only to improve an extraction.

Input: one TSV per alliance under <tsv-dir>/<date>/, named <state>_<tag>.tsv,
rows of
    rank<TAB>chiefName<TAB>power<TAB>furnace[<TAB>?]
where a trailing "?" marks the name as uncertain by hand.
Output: data/snapshots/<date>.json + refreshed data/index.json

Each batch covers whichever alliances were captured that day, so both the
transcripts and the ALLIANCES metadata are keyed by date. Rebuilding an older
date reads only that date's roster and leaves every other snapshot untouched.

Usage: python3 tools/build_snapshot.py <date> <tsv-dir>
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Alliance metadata per snapshot date, keyed by "<state>_<tag>", transcribed
# from the Alliance Info screenshot that precedes each roster. A date lists only
# the alliances captured that day — the set changes between batches as alliances
# are founded, dissolved or simply not photographed.
ALLIANCES = {
 "2026.08.08": {
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
 },
 "2026.09.06": {
    "3178_VKR": {
        "tag": "VKR", "name": "Vikings", "state": "3178",
        "memberCount": 99, "memberCapacity": 100,
        "infoTotalPower": 33_516_080_138,
        "infoImage": "IMG_2710.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2711, 2720)],
        "rankLabels": {"R4": "Jarls", "R3": "Karls", "R2": "Thralls", "R1": "Draugr"},
    },
    "3178_UFO": {
        "tag": "UFO", "name": "Aliens", "state": "3178",
        "memberCount": 94, "memberCapacity": 100,
        "infoTotalPower": 25_294_931_658,
        "infoImage": "IMG_2721.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2722, 2731)],
        "rankLabels": {"R4": "Gold", "R3": "Silver", "R2": "Value", "R1": "Budget"},
    },
    "3178_TTC": {
        "tag": "TTC", "name": "東都", "state": "3178",
        # Captured in two passes. The first stopped 12 members into R1; IMG_2775
        # and IMG_2776 re-shot that section about six hours later, when R1 read 13
        # rather than 16. The re-shot Info screen still reads 88 members, so those
        # three did not leave the alliance -- they were promoted out of R1, into an
        # R2 that the first pass photographed while it was still empty:
        #
        #   first pass  R5 1 + R4 11 + R3 60 + R2 0 + R1 16 = 88
        #   now         R5 1 + R4 11 + R3 60 + R2 3 + R1 13 = 88
        #
        # So R2 is the one section never photographed in its current state, and it
        # holds exactly the 3 members we are short (513,091,454 power, ~171M each).
        # The alliance total moved only +11,123,127 across those six hours, so this
        # is a rank reshuffle rather than real growth.
        #
        # IMG_2738 is absent from the batch, but R3 still totals its full 60
        # across 2737 -> 2739, so that missing frame held nothing new.
        "memberCount": 88, "memberCapacity": 100,
        "transcribedCount": 85,
        "partialNote": "R2 not captured since 3 members were promoted into it; "
                       "85 of 88 recorded",
        "infoTotalPower": 25_184_791_454,
        "infoImage": "TTC_info_reshoot.PNG",
        "rosterImages": ["IMG_%d.PNG" % n for n in range(2732, 2738)]
                        + ["IMG_2739.PNG", "IMG_2775.PNG", "IMG_2776.PNG"],
        "rankLabels": {"R4": "연맹 계급 4", "R3": "연맹 계급 3",
                       "R2": "연맹 계급 2", "R1": "연맹 계급 1"},
    },
    "3178_SIN": {
        "tag": "SIN", "name": "BeechesOfChaos", "state": "3178",
        "memberCount": 99, "memberCapacity": 100,
        "infoTotalPower": 24_925_269_214,
        "infoImage": "IMG_2740.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2741, 2751)],
        "rankLabels": {"R4": "R04", "R3": "R03", "R2": "Check msg", "R1": "Offline 5+"},
    },
    "3178_TEA": {
        "tag": "TEA", "name": "TheEternalArt", "state": "3178",
        "memberCount": 60, "memberCapacity": 100,
        "infoTotalPower": 10_331_088_677,
        "infoImage": "IMG_2751.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2752, 2758)],
        "rankLabels": {"R4": "Commanders", "R3": "Envoys", "R2": "Recruits", "R1": "Nomads"},
    },
    "3213_INK": {
        "tag": "INK", "name": "INK", "state": "3213",
        "memberCount": 98, "memberCapacity": 100,
        "infoTotalPower": 31_598_294_075,
        "infoImage": "IMG_2677.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2678, 2688)],
        "rankLabels": {"R4": "EXECUTOR", "R3": "FIGHTER", "R2": "RUNNER", "R1": "BASEMENT"},
    },
    "3213_ICE": {
        "tag": "ICE", "name": "TUBIG", "state": "3213",
        "memberCount": 90, "memberCapacity": 100,
        "infoTotalPower": 25_682_128_783,
        "infoImage": "IMG_2688.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2689, 2698)],
        "rankLabels": {"R4": "VPresident", "R3": "Fighter", "R2": "Balancer", "R1": "Welcome"},
    },
    "3213_PXI": {
        "tag": "PXI", "name": "pixies", "state": "3213",
        "memberCount": 93, "memberCapacity": 100,
        "infoTotalPower": 16_435_574_824,
        "infoImage": "IMG_2698.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(2699, 2708)],
        "rankLabels": {"R4": "Officers", "R3": "Combats", "R2": "Trainees", "R1": "Sleeping"},
    },
 },
 # The Labyrinth boards sit in the state folders themselves rather than in a
 # Labyrinth/ subfolder: IMG_3831..3847 for 3178, IMG_3773..3789 for 3196.
 "2026.10.05": {
    "3178_VKR": {
        "tag": "VKR", "name": "Pumpkings", "state": "3178",
        "memberCount": 100, "memberCapacity": 100,
        "infoTotalPower": 37_527_420_745,
        "infoImage": "IMG_3790.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3791, 3800)],
        "rankLabels": {"R4": "Jarls", "R3": "Karls", "R2": "Thralls", "R1": "Draugr"},
    },
    "3178_TTC": {
        "tag": "TTC", "name": "東都", "state": "3178",
        "memberCount": 91, "memberCapacity": 100,
        "infoTotalPower": 28_485_619_983,
        "infoImage": "IMG_3800.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3801, 3810)],
        "rankLabels": {"R4": "연맹 계급 4", "R3": "연맹 계급 3",
                       "R2": "연맹 계급 2", "R1": "연맹 계급 1"},
    },
    "3178_SIN": {
        "tag": "SIN", "name": "DevilsAdvocates", "state": "3178",
        "memberCount": 99, "memberCapacity": 100,
        "infoTotalPower": 27_674_720_593,
        "infoImage": "IMG_3810.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3811, 3820)],
        "rankLabels": {"R4": "R04", "R3": "R03", "R2": "Check msg", "R1": "Offline 5+"},
    },
    "3178_UFO": {
        "tag": "UFO", "name": "Aliens", "state": "3178",
        "memberCount": 94, "memberCapacity": 100,
        "infoTotalPower": 26_316_147_791,
        "infoImage": "IMG_3820.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3821, 3830)],
        "rankLabels": {"R4": "Gold", "R3": "Silver", "R2": "Value", "R1": "Budget"},
    },
    # TEA's Info screen (IMG_3830) closed the first pass with no member list
    # behind it; the roster was shot later the same day and sits after the
    # Labyrinth images.
    "3178_TEA": {
        "tag": "TEA", "name": "TheEternalArt", "state": "3178",
        "memberCount": 60, "memberCapacity": 100,
        "infoTotalPower": 10_769_720_436,
        "infoImage": "IMG_3830.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3848, 3854)],
        "rankLabels": {"R4": "Commanders", "R3": "Envoys", "R2": "Recruits", "R1": "Nomads"},
    },
    # 3196 was shot members-first for its top alliance: SRL's Info screen
    # (IMG_3734) follows its roster instead of preceding it.
    "3196_SRL": {
        "tag": "SRL", "name": "ShangRiLa", "state": "3196",
        "memberCount": 90, "memberCapacity": 100,
        "infoTotalPower": 25_692_900_021,
        "infoImage": "IMG_3734.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3725, 3734)],
        "rankLabels": {"R4": "Commander", "R3": "Diamond", "R2": "Platinum", "R1": "Silver"},
    },
    "3196_RGA": {
        "tag": "RGA", "name": "RockGroup", "state": "3196",
        "memberCount": 90, "memberCapacity": 100,
        "infoTotalPower": 25_429_979_407,
        "infoImage": "IMG_3735.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3736, 3745)],
        "rankLabels": {"R4": "Co-Leader", "R3": "FC 5+", "R2": "F30 ~ FC4", "R1": "<F29 & AFK"},
    },
    "3196_NYX": {
        "tag": "NYX", "name": "EMPIRE", "state": "3196",
        "memberCount": 74, "memberCapacity": 100,
        "infoTotalPower": 19_377_973_122,
        "infoImage": "IMG_3745.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3746, 3754)],
        "rankLabels": {"R4": "mentors", "R3": "R3 +", "R2": "- r2", "R1": "mga ewan"},
    },
    "3196_ONE": {
        "tag": "ONE", "name": "ONE", "state": "3196",
        "memberCount": 99, "memberCapacity": 100,
        "infoTotalPower": 18_448_260_248,
        "infoImage": "IMG_3754.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3755, 3765)],
        "rankLabels": {"R4": "DUKE", "R3": "EARL", "R2": "CITIZENS", "R1": "OUTOF TOWN"},
    },
    "3196_PNX": {
        "tag": "PNX", "name": "PhoenixNobles", "state": "3196",
        "memberCount": 76, "memberCapacity": 100,
        "infoTotalPower": 16_010_154_783,
        "infoImage": "IMG_3765.PNG", "rosterImages": ["IMG_%d.PNG" % n for n in range(3766, 3773)],
        "rankLabels": {"R4": "Officers", "R3": "FC6-FC8", "R2": "FC5-Below", "R1": "Holiday"},
    },
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


def load_labyrinth(roster_dir: Path, state: str) -> list[dict]:
    """Read one state's Labyrinth leaderboard, if it was captured.

    Rows are rank<TAB>allianceTag<TAB>chiefName<TAB>totalStages. The board is
    state-wide top 100, so it also lists alliances we do not track and players
    with no alliance at all (tag "-"); those are kept here and dropped at the
    join, since the file is a record of the board as it stood.
    """
    f = roster_dir / f"{state}_labyrinth.tsv"
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rank, tag, name, score = line.split("\t")
        out.append({"rank": int(rank), "allianceTag": tag, "chiefName": name,
                    "score": int(score.replace(",", ""))})
    return out


def attach_labyrinth(players: list[dict], board: list[dict], state: str) -> dict:
    """Join leaderboard scores onto the roster by (alliance tag, chief name).

    Returns counts for the build report. Anything that does not join is surfaced
    rather than silently dropped: a tracked alliance whose player is missing from
    the roster means the two extractions disagree about a name.
    """
    tracked = {p["allianceTag"] for p in players}
    by_key: dict[tuple[str, str], list[dict]] = {}
    for p in players:
        by_key.setdefault((p["allianceTag"], p["chiefName"]), []).append(p)

    stats = {"matched": 0, "untracked": 0, "unmatched": [], "ambiguous": []}
    pending: dict[tuple[str, str], list[dict]] = {}
    for e in board:
        key = (e["allianceTag"], e["chiefName"])
        if e["allianceTag"] not in tracked:
            stats["untracked"] += 1
            continue
        if key not in by_key:
            stats["unmatched"].append(f"{state} [{e['allianceTag']}]{e['chiefName']}")
            continue
        pending.setdefault(key, []).append(e)

    for key, entries in pending.items():
        roster = by_key[key]
        if len(roster) == 1 and len(entries) == 1:
            roster[0]["labyrinth"] = entries[0]["score"]
            roster[0]["labyrinthRank"] = entries[0]["rank"]
            stats["matched"] += 1
            continue
        # Same display name used by more than one player in the alliance. When the
        # board lists exactly as many, pair them best-score-to-highest-power and
        # flag both, since nothing in either screen distinguishes them.
        roster = sorted(roster, key=lambda p: -p["power"])
        entries = sorted(entries, key=lambda e: -e["score"])
        stats["ambiguous"].append(f"{state} [{key[0]}]{key[1]} x{len(roster)}")
        for pl, e in zip(roster, entries):
            pl["labyrinth"] = e["score"]
            pl["labyrinthRank"] = e["rank"]
            pl["labyrinthAmbiguous"] = True
            stats["matched"] += 1
    return stats


def main() -> None:
    date, tsv_dir = sys.argv[1], Path(sys.argv[2])
    if date not in ALLIANCES:
        raise SystemExit(
            f"no alliance metadata for {date}; known dates: {', '.join(sorted(ALLIANCES))}"
        )
    roster_dir = tsv_dir / date
    players, alliances, problems = [], [], []

    for key, meta in ALLIANCES[date].items():
        rows = [
            line.split("\t")
            for line in (roster_dir / f"{key}.tsv").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        counts = {r: 0 for r in RANK_ORDER}
        for row in rows:
            # An optional 5th field of "?" marks a name the transcriber could not
            # pin down but the heuristic below would wave through -- chiefly CJK
            # lookalike glyphs standing in for Latin letters, which are
            # indistinguishable from a genuine Chinese name to a script check.
            rank, name, power, furnace = row[:4]
            forced_uncertain = len(row) > 4 and row[4].strip() == "?"
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
            if forced_uncertain or name_is_uncertain(name):
                player["nameUncertain"] = True
            if not name:
                player["nameUncertain"] = True
                player["note"] = "chief name renders blank in-game"
            players.append(player)

        # Normally every member must be accounted for. An alliance whose capture
        # is known to be short carries an explicit transcribedCount, so the check
        # still fails loudly on an accidental miscount -- it just checks against
        # the number we meant to have rather than the roster size.
        expected = meta.get("transcribedCount", meta["memberCount"])
        if len(rows) != expected:
            of_roster = "" if expected == meta["memberCount"] else \
                f" (declared partial: {expected} of {meta['memberCount']})"
            problems.append(
                f"{key}: transcribed {len(rows)} rows, expected {expected}{of_roster}"
            )
        total = sum(p["power"] for p in players
                    if p["allianceTag"] == meta["tag"]
                    and p["state"] == meta["state"])
        entry = {**meta, "key": key, "rankCounts": counts, "totalPower": total}
        if "transcribedCount" in meta:
            # Downstream needs to know this alliance's totals understate reality.
            entry["partial"] = True
        else:
            # Independent check on the numbers themselves. The Alliance Info screen
            # states an exact total, while each member's power is displayed
            # truncated to 0.1M -- every card hides 0..0.1M. So the roster sum must
            # be short of the stated total by between 0 and 0.1M per member. That
            # is directional, which makes it sharp: a transcription that reads one
            # digit high breaks the lower bound immediately, and one that reads
            # low breaks the upper. Skipped for a partial roster, short by design.
            stated = meta.get("infoTotalPower")
            if stated is not None:
                short = stated - total
                if not 0 <= short <= meta["memberCount"] * 100_000:
                    problems.append(
                        f"{key}: roster sums to {total:,}, info screen says "
                        f"{stated:,} (short by {short:,}; truncation allows "
                        f"0..{meta['memberCount'] * 100_000:,})"
                    )
        alliances.append(entry)

    if problems:
        raise SystemExit("roster count mismatch:\n  " + "\n  ".join(problems))

    # Labyrinth total-stages score, joined on per state where captured.
    states = sorted({a["state"] for a in alliances})
    boards, lab_stats = {}, []
    for st in states:
        board = load_labyrinth(roster_dir, st)
        if not board:
            continue
        boards[st] = board
        stats = attach_labyrinth([p for p in players if p["state"] == st], board, st)
        lab_stats.append((st, stats))

    snapshot = {
        "date": date,
        "states": states,
        "playerCount": len(players),
        "alliances": alliances,
        "players": players,
    }
    if boards:
        # The board is state-wide top 100, so it is worth keeping whole: it is the
        # only view we have of alliances outside the roster.
        snapshot["labyrinth"] = {st: {"top": len(b), "entries": b} for st, b in boards.items()}
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
    for a in alliances:
        if a.get("partial"):
            print(f"  PARTIAL {a['key']}: {a['partialNote']}")
    for st, stats in lab_stats:
        print(f"  labyrinth {st}: {stats['matched']} joined, "
              f"{stats['untracked']} in untracked alliances")
        for a in stats["ambiguous"]:
            print(f"    ambiguous (paired by power): {a}")
        for u in stats["unmatched"]:
            print(f"    NO ROSTER MATCH: {u}")


if __name__ == "__main__":
    main()
