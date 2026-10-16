#!/usr/bin/env python3
"""
Scrape completed seasons from the Sportlomo archive into docs/history.json.

    python scraper/backfill.py            # scrape every season in sources.json
    python scraper/backfill.py --dry-run  # parse and report, write nothing

Past seasons stay on Sportlomo after they finish, so this only needs running
when a new season is added to the "history" block in sources.json. It reuses
the live scraper's parser, so a page that parses today parses the same way here.

What it keeps, deliberately small: the club's own fixtures, the final table,
and the club's league points after each round. That is enough for the ghost
climber, On This Day and head-to-head, without carrying a whole season of
other clubs' fixtures.
"""

import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCES = os.path.join(ROOT, "scraper", "sources.json")
OUT = os.path.join(ROOT, "docs", "history.json")

_spec = importlib.util.spec_from_file_location("scrape", os.path.join(HERE, "scrape.py"))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)


def club_points(fixtures, comp, club_prefix):
    """
    The club's league points after each round, oldest first, so a later season
    can be compared round for round rather than date for date.
    """
    ours = [f for f in fixtures
            if f["date"] and (f["home"].startswith(club_prefix) or f["away"].startswith(club_prefix))]
    ours.sort(key=lambda f: (f["date"], f["time"] or ""))
    out, cum = [], 0
    for i, f in enumerate(ours, 1):
        got = 0
        if f["status"] == "conceded" and f.get("concededBy"):
            got = comp.get("concedePoints", -4) if f["concededBy"].startswith(club_prefix) \
                else comp.get("walkoverPoints", 4)
        elif f["status"] == "played" and f["homeScore"] is not None:
            home = f["home"].startswith(club_prefix)
            s = f["homeScore"] if home else f["awayScore"]
            o = f["awayScore"] if home else f["homeScore"]
            tries = (f["homeTries"] if home else f["awayTries"])
            if s > o:
                got = 4
            elif s == o:
                got = 2
            elif o - s <= 7:
                got = 1
            if comp.get("tryBonus", True) and tries is not None and tries >= 4:
                got += 1
        else:
            continue
        cum += got
        out.append({"round": i, "date": f["date"], "pts": got, "cum": cum})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.load(open(SOURCES))
    seasons_cfg = cfg.get("history") or []
    if not seasons_cfg:
        print("no history block in sources.json — nothing to do", file=sys.stderr)
        return 0

    import requests
    session = requests.Session()
    club_prefix = cfg["club"]["short"]
    seasons = []

    for season in seasons_cfg:
        comps = []
        for comp in season.get("competitions", []):
            if not comp.get("url"):
                continue
            try:
                html = S.fetch(comp["url"], session)
            except Exception as e:                                  # noqa: BLE001
                print("  ! %s %s: %s" % (season["label"], comp["id"], e), file=sys.stderr)
                continue

            fixtures = S.parse_fixtures(S.lines_of(html), comp)
            standings = S.parse_standings(html)
            if not standings:
                standings = S.compute_standings(fixtures, comp)

            ours = [f for f in fixtures
                    if f["home"].startswith(club_prefix) or f["away"].startswith(club_prefix)]
            for f in ours:
                f.pop("note", None)
                f["comp"] = comp["id"]

            final = None
            for r in standings:
                if r["team"].startswith(club_prefix):
                    final = r
            teams = len(standings) or 8
            rounds = (teams - 1) * 2
            available = rounds * (5 if comp.get("tryBonus", True) else 4)

            comps.append({
                "id": comp["id"],
                "name": comp.get("name", comp["id"]),
                "team": comp.get("team"),
                "tryBonus": comp.get("tryBonus", True),
                "available": available,
                "rounds": rounds,
                "final": final,
                "standings": standings,
                "progress": club_points(fixtures, comp, club_prefix),
                "fixtures": sorted(ours, key=lambda f: (f["date"] or "", f["time"] or "")),
                "source": comp["url"],
            })
            print("%-8s %-7s %2d of our fixtures, final %s"
                  % (season["label"], comp["id"], len(ours),
                     ("%s with %s pts" % (final["pos"], final["pts"])) if final else "unknown"),
                  file=sys.stderr)

        if comps:
            seasons.append({"label": season["label"], "competitions": comps})

    if not seasons:
        print("ERROR: nothing scraped — refusing to overwrite history", file=sys.stderr)
        return 1

    data = {
        "generated": datetime.now(timezone.utc).replace(microsecond=0)
                     .isoformat().replace("+00:00", "Z"),
        "club": cfg["club"]["name"],
        "seasons": seasons,
    }

    if args.dry_run:
        for s in data["seasons"]:
            for c in s["competitions"]:
                print(s["label"], c["id"], "progress rounds:", len(c["progress"]),
                      "| final cum:", c["progress"][-1]["cum"] if c["progress"] else None)
        return 0

    json.dump(data, open(OUT, "w"), indent=1)
    print("wrote %s (%d season(s))" % (OUT, len(seasons)), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
