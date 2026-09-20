#!/usr/bin/env python3
"""
Read the Leinster Rugby (Sportlomo) pages for Cill Dara RFC and write docs/data.json
plus the .ics calendar feeds.

    python scraper/scrape.py                 # normal run
    python scraper/scrape.py --debug lalor   # dump the raw line stream for one competition
    python scraper/scrape.py --dry-run       # parse and report, write nothing

The pages are server-rendered HTML with no JSON API, so this parses the text stream
rather than CSS classes: classes change far more often than the shape of the content.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "docs")
SOURCES = os.path.join(ROOT, "scraper", "sources.json")
UA = "cill-dara-fixtures/1.0 (+https://github.com/apk-repo)"

DATE_RE = re.compile(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2})/(\d{2})/(\d{4})$")
TIME_RE = re.compile(r"^(\d{1,2}:\d{2})$")
SCORE_RE = re.compile(r"^(\d+)\s*(?:\((\d+)\))?\s*[Vv]\s*(\d+)\s*(?:\((\d+)\))?$")
REF_RE = re.compile(r"^Referee\s*:?\s*(.*)$", re.I)
COMMENT_RE = re.compile(r"^Comment\s*:?\s*(.*)$", re.I)
TEAM_SUFFIX_RE = re.compile(r"^(.*?)\s+(\d+)$")

NOISE = {
    "team sheet", "time", "team1", "team2", "scores", "venue", "comment", "referee",
    "na", "v", "", "powered by sportlomo", "scroll to top", "all competitions",
    "upcoming fixtures", "recent results", "home", "league", "league diagram",
    "you are here", "search", "sort by date", "sort by competition",
}

ROUND_WORDS = re.compile(
    r"(preliminary|first|second|third|quarter|semi|final|round\s*\d+|r\d+)", re.I
)


# ---------------------------------------------------------------- helpers

def team_name(raw):
    """'Newbridge 1' -> 'Newbridge 1st XV'. Leaves anything else alone."""
    raw = raw.strip()
    m = TEAM_SUFFIX_RE.match(raw)
    if not m:
        return raw
    base, num = m.group(1), int(m.group(2))
    suffix = {1: "1st", 2: "2nd", 3: "3rd"}.get(num, "%dth" % num)
    return "%s %s XV" % (base, suffix)


def fetch(url, session):
    r = session.get(url, timeout=30, headers={"User-Agent": UA})
    r.raise_for_status()
    return r.text


def lines_of(html):
    """The page as an ordered list of non-empty text lines."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    out = []
    for line in soup.get_text("\n").split("\n"):
        s = " ".join(line.split())
        if s and s.lower() not in NOISE:
            out.append(s)
    return out


# ---------------------------------------------------------------- standings

def parse_standings(html):
    """Find the table whose header mentions Pos and Team, return a list of dicts."""
    soup = BeautifulSoup(html, "lxml")
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        head = [" ".join(c.get_text().split()).lower() for c in rows[0].find_all(["th", "td"])]
        if "team" not in head:
            continue
        out = []
        for tr in rows[1:]:
            cells = [" ".join(c.get_text().split()) for c in tr.find_all(["th", "td"])]
            if len(cells) != len(head) or not cells[0].strip().isdigit():
                continue
            rec = dict(zip(head, cells))

            def num(*keys):
                for k in keys:
                    if k in rec and rec[k] not in ("", "-"):
                        try:
                            return int(rec[k].replace("\u2212", "-"))
                        except ValueError:
                            pass
                return 0

            out.append({
                "pos": num("pos", "#"),
                "team": team_name(rec.get("team", "")),
                "pld": num("pld", "p"),
                "w": num("w"), "d": num("d"), "l": num("l"),
                "pf": num("pf"), "pa": num("pa"),
                "diff": num("diff"),
                "bp": num("bp") if "bp" in rec else None,
                "bpl": num("bp l", "bpl"),
                "pts": num("pts"),
            })
        if out:
            return out
    return []


# ---------------------------------------------------------------- fixtures

def parse_fixtures(lines, comp, known_teams):
    """
    Walk the line stream. A date line sets the current date; a time line opens a
    fixture block that runs to the next time or date line.
    """
    blocks, current_date, block = [], None, None

    def close():
        if block and block["lines"]:
            blocks.append(block)

    for raw in lines:
        m = DATE_RE.match(raw)
        if m:
            close()
            block = None
            current_date = "%s-%s-%s" % (m.group(4), m.group(3), m.group(2))
            continue
        if TIME_RE.match(raw) or raw.upper() == "TBC":
            close()
            block = {"date": current_date,
                     "time": None if raw.upper() == "TBC" else raw,
                     "lines": []}
            continue
        if block is not None:
            block["lines"].append(raw)
    close()

    fixtures = []
    for i, b in enumerate(blocks):
        f = block_to_fixture(b, comp, known_teams, i)
        if f:
            fixtures.append(f)
    return fixtures


def looks_like_team(s, known_teams):
    if s in known_teams:
        return True
    if REF_RE.match(s) or COMMENT_RE.match(s) or SCORE_RE.match(s):
        return False
    if s.lower() in NOISE or len(s) > 40:
        return False
    # 'Cill Dara 1', 'Cill Dara 1st XV', 'Tallaght/Guinness'
    return bool(re.match(r"^[A-Z][A-Za-z'&./\- ]+( \d+| \d(st|nd|rd|th) XV)?$", s))


def block_to_fixture(b, comp, known_teams, idx):
    home = away = venue = referee = comment = None
    hs = as_ = ht = at = None
    rnd = None
    seen_score = False
    leftovers = []

    for s in b["lines"]:
        m = SCORE_RE.match(s)
        if m:
            hs, ht = int(m.group(1)), int(m.group(2)) if m.group(2) else None
            as_, at = int(m.group(3)), int(m.group(4)) if m.group(4) else None
            seen_score = True
            continue
        m = REF_RE.match(s)
        if m:
            val = m.group(1).strip()
            if val and val.upper() != "NA" and referee is None:
                referee = val
            continue
        m = COMMENT_RE.match(s)
        if m:
            val = m.group(1).strip()
            if val and val.upper() != "NA":
                comment = val
            continue
        leftovers.append(s)

    teams = [s for s in leftovers if looks_like_team(s, known_teams)]
    rest = [s for s in leftovers if s not in teams]

    if len(teams) >= 2:
        home, away = team_name(teams[0]), team_name(teams[1])
    else:
        return None

    for s in rest:
        if ROUND_WORDS.search(s) and rnd is None:
            rnd = s
        elif venue is None:
            venue = s
    if venue is None:
        extra = [s for s in leftovers if s not in (teams[0], teams[1]) and s != rnd]
        venue = extra[0] if extra else "TBC"

    status = "scheduled"
    if comment and "off" in comment.lower():
        status = "called-off"
    elif seen_score:
        status = "played"

    return {
        "id": "%s-%02d" % (comp["id"], idx),
        "date": b["date"],
        "time": b["time"],
        "comp": comp["id"],
        "team": None,          # filled in later
        "home": home, "away": away,
        "venue": venue, "referee": referee,
        "homeScore": hs, "awayScore": as_,
        "homeTries": ht, "awayTries": at,
        "round": rnd or comment if (rnd or (comment and "off" not in (comment or "").lower())) else rnd,
        "status": status,
        "_comment": comment,
    }


# ---------------------------------------------------------------- de-duplication

def rank(f):
    """Higher wins. A result beats a real date and venue, which beats a placeholder."""
    if f["status"] == "played":
        return 3
    if f["date"] and f["time"] and f["venue"] not in (None, "", "TBC"):
        return 2
    if f["date"]:
        return 1
    return 0


def describe(f):
    bits = []
    if f["date"]:
        d = datetime.strptime(f["date"], "%Y-%m-%d")
        bits.append(d.strftime("%a %-d %b") + (" " + f["time"] if f["time"] else ""))
    else:
        bits.append("no date")
    if f.get("round"):
        bits.append(f["round"])
    if f["homeScore"] is not None:
        bits.append("%d\u2013%d" % (f["homeScore"], f["awayScore"]))
    bits.append(f["venue"] or "venue TBC")
    if f["referee"]:
        bits.append(f["referee"])
    return " \u00b7 ".join(bits)


def dedupe(fixtures, comps):
    by_id = {c["id"]: c for c in comps}
    buckets, issues = {}, []
    for f in fixtures:
        comp = by_id[f["comp"]]
        if comp["type"] == "cup":
            # a knockout pairing happens once, whichever way round it is listed
            key = (f["comp"], tuple(sorted([f["home"], f["away"]])))
        else:
            key = (f["comp"], f["home"], f["away"])
        buckets.setdefault(key, []).append(f)

    kept, merged = [], 0
    for key, group in buckets.items():
        group.sort(key=rank, reverse=True)
        winner = group[0]
        kept.append(winner)
        for loser in group[1:]:
            merged += 1
            issues.append({
                "kind": "duplicate",
                "comp": winner["comp"],
                "pair": "%s v %s" % (winner["home"], winner["away"]),
                "kept": describe(winner),
                "hidden": describe(loser),
                "why": ("Same tie in the same competition. Kept the row with the stronger "
                        "evidence: a result, then a real date and venue, then a placeholder."),
            })
    return kept, issues, merged


def flag_stale_calloffs(fixtures, today):
    out = []
    for f in fixtures:
        if f["status"] != "called-off" or not f["date"]:
            continue
        when = datetime.strptime(f["date"], "%Y-%m-%d").date()
        if (today - when).days < 5:
            continue
        pair = {f["home"], f["away"]}
        refixed = any(
            g is not f and g["comp"] == f["comp"] and {g["home"], g["away"]} == pair
            and g["status"] == "scheduled" and g["date"] and
            datetime.strptime(g["date"], "%Y-%m-%d").date() > when
            for g in fixtures
        )
        if not refixed:
            out.append({
                "kind": "attention",
                "comp": f["comp"],
                "pair": "%s v %s" % (f["home"], f["away"]),
                "kept": when.strftime("%a %-d %b") + " \u00b7 called off",
                "hidden": None,
                "why": "Called off and not refixed after %d days. Needs a human to chase."
                       % (today - when).days,
            })
    return out


# ---------------------------------------------------------------- calendars

def ics_escape(s):
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")


def build_ics(name, fixtures, club_short):
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ["BEGIN:VCALENDAR", "VERSION:2.0",
           "PRODID:-//%s//League Hub//EN" % club_short,
           "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
           "X-WR-CALNAME:%s" % ics_escape(name),
           "X-WR-TIMEZONE:Europe/Dublin"]
    for f in fixtures:
        if not f["date"]:
            continue
        start = datetime.strptime(f["date"] + " " + (f["time"] or "12:00"), "%Y-%m-%d %H:%M")
        end = start + timedelta(minutes=110)
        title = "%s v %s" % (f["home"], f["away"])
        if f["status"] == "called-off":
            title = "CALLED OFF: " + title
        desc = []
        if f.get("round"):
            desc.append(f["round"])
        if f.get("referee"):
            desc.append("Referee: " + f["referee"])
        out += [
            "BEGIN:VEVENT",
            "UID:%s@cilldara" % f["id"],
            "DTSTAMP:" + now,
            "DTSTART;TZID=Europe/Dublin:" + start.strftime("%Y%m%dT%H%M%S"),
            "DTEND;TZID=Europe/Dublin:" + end.strftime("%Y%m%dT%H%M%S"),
            "SUMMARY:" + ics_escape(title),
            "LOCATION:" + ics_escape(f["venue"] or "TBC"),
            "DESCRIPTION:" + ics_escape(" \u00b7 ".join(desc)),
            "STATUS:" + ("CANCELLED" if f["status"] == "called-off" else "CONFIRMED"),
            "END:VEVENT",
        ]
    out.append("END:VCALENDAR")
    return "\r\n".join(out) + "\r\n"


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", metavar="COMP_ID", help="dump the line stream for one competition")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.load(open(SOURCES))
    session = requests.Session()
    today = datetime.now().date()

    club_prefix = cfg["club"]["short"]
    suffix_to_team = {t["sourceSuffix"]: t["id"] for t in cfg["teams"]}

    all_fixtures, comps_out, known_teams = [], [], set()

    for comp in cfg["competitions"]:
        record = {k: comp[k] for k in
                  ("id", "name", "short", "team", "type") if k in comp}
        record["promotion"] = comp.get("promotion", 0)
        record["relegation"] = comp.get("relegation", 0)
        record["status"] = comp.get("status", "live")
        record["source"] = comp.get("url")
        record["standings"] = []

        if not comp.get("url"):
            comps_out.append(record)
            continue

        html = fetch(comp["url"], session)
        lines = lines_of(html)

        if args.debug == comp["id"]:
            for i, s in enumerate(lines):
                print("%3d  %s" % (i, s))
            return 0

        record["standings"] = parse_standings(html)
        known_teams |= {r["team"] for r in record["standings"]}
        known_teams |= {r["team"].replace(" 1st XV", " 1").replace(" 2nd XV", " 2")
                        for r in record["standings"]}

        fixtures = parse_fixtures(lines, comp, known_teams)
        for f in fixtures:
            for side in (f["home"], f["away"]):
                if side.startswith(club_prefix):
                    m = re.search(r"(\d)(st|nd|rd|th) XV$", side)
                    if m:
                        f["team"] = suffix_to_team.get(m.group(1), comp.get("team"))
            if f["team"] is None and (f["home"].startswith(club_prefix)
                                      or f["away"].startswith(club_prefix)):
                f["team"] = comp.get("team")
        all_fixtures += fixtures
        comps_out.append(record)
        print("%-8s %2d standings rows, %2d fixture rows"
              % (comp["id"], len(record["standings"]), len(fixtures)), file=sys.stderr)

    rows_in = len(all_fixtures)
    kept, issues, merged = dedupe(all_fixtures, cfg["competitions"])
    issues += flag_stale_calloffs(kept, today)
    kept.sort(key=lambda f: (f["date"] or "9999-99-99", f["time"] or "99:99"))
    for f in kept:
        f.pop("_comment", None)

    data = {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "club": cfg["club"],
        "links": cfg.get("links", {}),
        "teams": cfg["teams"],
        "competitions": comps_out,
        "fixtures": kept,
        "issues": issues,
        "counts": {
            "rowsIn": rows_in,
            "kept": len(kept),
            "merged": merged,
            "attention": len([i for i in issues if i["kind"] == "attention"]),
        },
    }

    if not kept:
        print("ERROR: no fixtures parsed \u2014 refusing to overwrite good data", file=sys.stderr)
        return 1
    if rows_in and merged / float(rows_in) > 0.4:
        print("ERROR: merged %d of %d rows \u2014 the parser is probably broken"
              % (merged, rows_in), file=sys.stderr)
        return 1

    if args.dry_run:
        print(json.dumps(data["counts"], indent=1))
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(data, open(os.path.join(OUT_DIR, "data.json"), "w"), indent=1)

    ours = [f for f in kept if f["team"]]
    feeds = [("cill-dara-all.ics", "Cill Dara RFC", ours)]
    for t in cfg["teams"]:
        feeds.append(("cill-dara-%s.ics" % t["id"], t["label"],
                      [f for f in ours if f["team"] == t["id"]]))
    for filename, title, subset in feeds:
        open(os.path.join(OUT_DIR, filename), "w").write(
            build_ics(title, subset, cfg["club"]["short"]))

    print("wrote %d fixtures, merged %d, flagged %d"
          % (len(kept), merged, data["counts"]["attention"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
