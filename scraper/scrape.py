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
SCORE_PART_RE = re.compile(r"^\d+\s*(?:\(\d+\))?$")
# Sportlomo writes the referee cell as a label line then a ': value' line.
# Either form is accepted: 'Referee: X' once joined, or a bare ': X'.
REF_RE = re.compile(r"^(?:referee\s*)?:\s*(.*)$", re.I)
VALUE_RE = re.compile(r"^:\s*(.*)$")
INT_RE = re.compile(r"^[+\-\u2212]?\d+$")
OFF_RE = re.compile(r"\b(off|postponed|cancell?ed|abandoned|walkover|conceded)\b", re.I)
# "Conceded by Roscrea 2" / "Walkover to Longford 2" — the league awards the game
CONCEDE_RE = re.compile(r"\b(?:conceded|walkover)\s+(?:by|to)\s+(.+)$", re.I)
LABELS = {"referee", "comment"}
TEAM_SUFFIX_RE = re.compile(r"^(.*?)\s+(\d+)$")

NOISE = {
    "team sheet", "time", "team1", "team2", "scores", "venue", "comment", "referee",
    "", "powered by sportlomo", "scroll to top", "all competitions",
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
    """
    The page as an ordered list of text lines, with Sportlomo's split cells stitched back:

        'Referee' + ': Luke Judge'      -> 'Referee: Luke Judge'
        '25 (3)'  + 'V' + '10 (2)'      -> '25 (3) V 10 (2)'

    Noise is dropped only AFTER stitching, because 'Referee' and 'V' are noise on their
    own but load-bearing next to their values.
    """
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    raw = [" ".join(l.split()) for l in soup.get_text("\n").split("\n")]
    raw = [x for x in raw if x]

    joined = []
    for x in raw:
        m = VALUE_RE.match(x)
        if m and joined and joined[-1].lower() in LABELS:
            joined[-1] = "%s: %s" % (joined[-1], m.group(1).strip())
        else:
            joined.append(x)

    out, i = [], 0
    while i < len(joined):
        a = joined[i]
        if (i + 2 < len(joined) and SCORE_PART_RE.match(a)
                and joined[i + 1].lower() == "v" and SCORE_PART_RE.match(joined[i + 2])):
            out.append("%s V %s" % (a, joined[i + 2]))
            i += 3
            continue
        out.append(a)
        i += 1

    return [x for x in out if x.lower() not in NOISE and x.lower() != "v"]


# ---------------------------------------------------------------- discovery

BASE = "https://leinsterrugby.sportlomo.com"
COMP_HREF_RE = re.compile(r"/(league|league-diagram)/(\d+)")


def discover_competitions(html):
    """
    Every competition heading on a fixtures page links to that competition's own
    page. Sportlomo mints a NEW competition id for each cup round, so the club
    fixtures page is the only reliable way to find a round once it is drawn.

    Returns {url: name}.
    """
    soup = BeautifulSoup(html, "lxml")
    out = {}
    for a in soup.find_all("a", href=True):
        m = COMP_HREF_RE.search(a["href"])
        if not m:
            continue
        name = " ".join(a.get_text().split()).lstrip(">").strip(" -\u2013")
        if not name or len(name) > 90 or name.lower() in NOISE:
            continue
        url = "%s/%s/%s/" % (BASE, m.group(1), m.group(2))
        out.setdefault(url, name)
    return out


def same_comp(url_a, url_b):
    """Compare by numeric id, ignoring league vs league-diagram and trailing slashes."""
    ma, mb = COMP_HREF_RE.search(url_a or ""), COMP_HREF_RE.search(url_b or "")
    return bool(ma and mb and ma.group(2) == mb.group(2))


def comp_urls(comp):
    """A competition may be spread over several pages: a bracket plus a page per round."""
    urls = list(comp.get("urls") or [])
    if comp.get("url"):
        urls.insert(0, comp["url"])
    seen, out = set(), []
    for u in urls:
        m = COMP_HREF_RE.search(u or "")
        k = m.group(2) if m else u
        if k not in seen:
            seen.add(k)
            out.append(u)
    return out


# ---------------------------------------------------------------- standings

HEAD_ALIASES = {
    "pos": {"pos", "position", "#", "no", "rank"},
    "team": {"team", "teams", "club", "name"},
    "pld": {"pld", "p", "played", "gp", "mp"},
    "w": {"w", "won"},
    "d": {"d", "drawn"},
    "l": {"l", "lost"},
    "pf": {"pf", "for", "pts for", "points for"},
    "pa": {"pa", "against", "pts against", "points against"},
    "diff": {"diff", "pd", "+/-", "difference"},
    "bp": {"bp", "bonus", "bonus points"},
    "bpl": {"bp l", "bpl", "lbp", "losing bp", "bp (l)", "l bp", "bp losing"},
    "bp4": {"bp 4-try", "bp 4 try", "bp4try", "bp4", "4-try bp", "4 try bp",
            "try bp", "tbp", "bp t", "bpt", "bp try"},
    "pts": {"pts", "points", "total"},
}


def _int(x):
    x = (x or "").strip().replace("\u2212", "-")
    return int(x) if INT_RE.match(x) else None


def parse_standings(html):
    """
    Read the league table if the page has one. Tolerant of an extra crest or form
    column: it finds the team and points columns by header, then slides along the
    body row until the team cell has letters and the points cell is a number.
    Returns [] if nothing sensible is found; the caller falls back to computing it.
    """
    soup = BeautifulSoup(html, "lxml")
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        colmap, head_at, head_len = None, None, 0
        for i, tr in enumerate(rows[:3]):
            cells = [" ".join(c.get_text().split()).lower() for c in tr.find_all(["th", "td"])]
            cm = {}
            for j, c in enumerate(cells):
                for key, aliases in HEAD_ALIASES.items():
                    if c in aliases and key not in cm:
                        cm[key] = j
            if "team" in cm and "pts" in cm:
                colmap, head_at, head_len = cm, i, len(cells)
                break
        if colmap is None:
            continue

        out = []
        for n, tr in enumerate(rows[head_at + 1:], 1):
            cells = [" ".join(c.get_text().split()) for c in tr.find_all(["th", "td"])]
            extra = len(cells) - head_len
            if not cells or extra < 0:
                continue
            shift = None
            for o in range(extra + 1):
                t, p = colmap["team"] + o, colmap["pts"] + o
                if p < len(cells) and re.search("[A-Za-z]", cells[t]) and _int(cells[p]) is not None:
                    shift = o
                    break
            if shift is None:
                continue

            def g(key):
                j = colmap.get(key)
                return None if j is None or j + shift >= len(cells) else _int(cells[j + shift])

            pf, pa = g("pf") or 0, g("pa") or 0
            # BP is the total; derive whichever of the three is absent
            bp_total, bp_lose, bp_try = g("bp"), g("bpl"), g("bp4")
            if bp_try is None and bp_total is not None and bp_lose is not None:
                bp_try = bp_total - bp_lose
            if bp_total is None and bp_try is not None:
                bp_total = bp_try + (bp_lose or 0)
            elif bp_total is None and bp_lose is not None:
                bp_total = bp_lose          # a league with no try bonus at all
            out.append({
                "pos": g("pos") or n,
                "team": team_name(cells[colmap["team"] + shift]),
                "pld": g("pld") or 0, "w": g("w") or 0, "d": g("d") or 0, "l": g("l") or 0,
                "pf": pf, "pa": pa,
                "diff": g("diff") if g("diff") is not None else pf - pa,
                "bp": bp_total,
                "bp4": bp_try,
                "bpl": bp_lose or 0,
                "pts": g("pts") or 0,
            })
        if len(out) >= 4:
            return out
    return []


def compute_standings(fixtures, comp):
    """
    Build the table from results. Leinster League scoring: 4 win, 2 draw, 1 for losing
    by 7 or fewer, 1 for scoring 4+ tries where the competition awards it. Checked
    against the published Division 2A and J2 2A tables after round 1: exact match.
    """
    try_bonus = comp.get("tryBonus", True)
    # points the league awards for a walkover, and what it docks the side that conceded
    walkover_pts = comp.get("walkoverPoints", 4)
    concede_pts = comp.get("concedePoints", -4)
    rows = {}
    for f in fixtures:
        for t in (f["home"], f["away"]):
            rows.setdefault(t, {"team": t, "pld": 0, "w": 0, "d": 0, "l": 0,
                                "pf": 0, "pa": 0, "bp": 0, "bp4": 0, "bpl": 0, "pts": 0})
    for f in fixtures:
        if f["status"] == "conceded" and f.get("concededBy"):
            loser = f["concededBy"]
            winner = f["away"] if loser == f["home"] else f["home"]
            if winner in rows and loser in rows:
                rows[winner]["pld"] += 1
                rows[winner]["w"] += 1
                rows[winner]["pts"] += walkover_pts
                rows[loser]["pld"] += 1
                rows[loser]["l"] += 1
                rows[loser]["pts"] += concede_pts
                rows[loser]["conceded"] = rows[loser].get("conceded", 0) + 1
            continue
        if f["status"] != "played" or f["homeScore"] is None:
            continue
        for me, s, o, tries in ((f["home"], f["homeScore"], f["awayScore"], f["homeTries"]),
                                (f["away"], f["awayScore"], f["homeScore"], f["awayTries"])):
            r = rows[me]
            r["pld"] += 1
            r["pf"] += s
            r["pa"] += o
            if s > o:
                r["w"] += 1
                r["pts"] += 4
            elif s == o:
                r["d"] += 1
                r["pts"] += 2
            else:
                r["l"] += 1
                if o - s <= 7:
                    r["bpl"] += 1
                    r["pts"] += 1
            if try_bonus and tries is not None and tries >= 4:
                r["bp4"] += 1
                r["pts"] += 1
    ordered = sorted(rows.values(),
                     key=lambda r: (-r["pts"], -(r["pf"] - r["pa"]), -r["pf"], r["team"]))
    for i, r in enumerate(ordered, 1):
        r["pos"] = i
        r["diff"] = r["pf"] - r["pa"]
        r.setdefault("conceded", 0)
        r["bp"] = (r.get("bp4") or 0) + (r.get("bpl") or 0)
        if not try_bonus:
            r["bp4"] = None
    return ordered


# ---------------------------------------------------------------- fixtures

def parse_fixtures(lines, comp):
    """
    Every Sportlomo fixture row is the same fixed sequence of cells:

        time, team1, [score], team2, venue, [comment], referee

    Empty cells vanish from the text, which is why the score and comment are optional.
    The referee cell is always present (': NA' when unappointed), so it is the reliable
    end-of-row marker. A date line sets the date for the rows beneath it.
    """
    fixtures, date, buf = [], None, []

    def flush(ref):
        f = row_to_fixture(buf, ref, date, comp, len(fixtures))
        if f:
            fixtures.append(f)

    for x in lines:
        m = DATE_RE.match(x)
        if m:
            buf = []
            date = "%s-%s-%s" % (m.group(4), m.group(3), m.group(2))
            continue
        r = REF_RE.match(x)
        if r:
            flush(r.group(1))
            buf = []
            continue
        # a row that somehow lost its referee cell: close it when the next time appears
        if TIME_RE.match(x) and buf and TIME_RE.match(buf[0]) and len(buf) >= 3:
            flush(None)
            buf = []
        buf.append(x)
    return fixtures


def row_to_fixture(cells, ref, date, comp, idx):
    toks = list(cells)
    time = None
    if toks and (TIME_RE.match(toks[0]) or toks[0].upper() == "TBC"):
        t = toks.pop(0)
        time = None if t.upper() == "TBC" else t
    if len(toks) < 2:
        return None

    home = toks.pop(0)
    hs = as_ = ht = at = None
    if toks and SCORE_RE.match(toks[0]):
        m = SCORE_RE.match(toks.pop(0))
        hs, as_ = int(m.group(1)), int(m.group(3))
        ht = int(m.group(2)) if m.group(2) else None
        at = int(m.group(4)) if m.group(4) else None
    if not toks:
        return None
    away = toks.pop(0)
    venue = toks.pop(0) if toks else "TBC"

    status = "played" if hs is not None else "scheduled"
    rnd = note = conceded_by = None
    for e in toks:
        if OFF_RE.search(e) and hs is None:
            m = CONCEDE_RE.search(e)
            if m:
                status = "conceded"
                conceded_by = team_name(m.group(1).strip())
            else:
                status = "called-off"
            note = e
        elif ROUND_WORDS.search(e) and rnd is None:
            rnd = e
        else:
            note = e

    ref = (ref or "").strip()
    referee = None if ref.upper() in ("", "NA", "N/A", "TBC") else ref

    return {
        "id": "%s-%s-%02d" % (comp["id"], date or "tbc", idx),
        "date": date,
        "time": time,
        "comp": comp["id"],
        "team": None,
        "home": team_name(home), "away": team_name(away),
        "venue": venue or "TBC", "referee": referee,
        "homeScore": hs, "awayScore": as_,
        "homeTries": ht, "awayTries": at,
        "round": rnd,
        "note": note,
        "status": status,
        "concededBy": conceded_by,
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

def check_standings(parsed, computed):
    """Differences between the league's own table and one built from results."""
    by_team = {r["team"]: r for r in computed}
    diffs = []
    for r in parsed:
        c = by_team.get(r["team"])
        if c is None:
            diffs.append("%s is in the table but in no fixture" % r["team"])
        elif (r["pts"], r["pld"]) != (c["pts"], c["pld"]):
            diffs.append("%s: table says %d pts from %d, results give %d from %d"
                         % (r["team"], r["pts"], r["pld"], c["pts"], c["pld"]))
        elif r.get("bp") is not None and r.get("bpl") is not None \
                and r.get("bp4") is not None \
                and r["bp"] != (r["bp4"] or 0) + (r["bpl"] or 0):
            diffs.append("%s: bonus points do not add up \u2014 table shows %d total, "
                         "%s four-try and %d losing"
                         % (r["team"], r["bp"], r["bp4"], r["bpl"]))
    return diffs


def flag_missing_results(fixtures, today):
    out = []
    for f in fixtures:
        if f["status"] != "scheduled" or not f["date"] or not f["team"]:
            continue
        when = datetime.strptime(f["date"], "%Y-%m-%d").date()
        if (today - when).days >= 2:
            out.append({
                "kind": "attention", "comp": f["comp"],
                "pair": "%s v %s" % (f["home"], f["away"]),
                "kept": when.strftime("%a %-d %b") + " \u00b7 no result",
                "hidden": None,
                "why": "Kick-off was %d days ago and there is still no score or call-off in the feed."
                       % (today - when).days,
            })
    return out


def sanity(data, today):
    """Reasons to refuse to publish. Any one of these means the parser has drifted."""
    problems = []
    fx = data["fixtures"]
    if not fx:
        problems.append("no fixtures parsed")
    for c in data["competitions"]:
        if c["type"] == "league" and c.get("source") and len(c["standings"]) < 4:
            problems.append("%s has %d standings rows" % (c["id"], len(c["standings"])))
    bad_venues = [f for f in fx if SCORE_PART_RE.match(f["venue"] or "") or (f["venue"] or "").startswith(":")]
    if bad_venues:
        problems.append("%d fixtures have a score or referee where the venue should be" % len(bad_venues))
    past = [f for f in fx if f["date"] and datetime.strptime(f["date"], "%Y-%m-%d").date() < today - timedelta(days=1)]
    if len(past) >= 3 and not any(f["status"] in ("played", "called-off") for f in past):
        problems.append("%d fixtures are in the past but none has a result" % len(past))
    rows_in = data["counts"]["rowsIn"]
    if rows_in and data["counts"]["merged"] / float(rows_in) > 0.4:
        problems.append("merged %d of %d rows" % (data["counts"]["merged"], rows_in))
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", metavar="COMP_ID", help="dump the stitched line stream for one competition")
    ap.add_argument("--dry-run", action="store_true", help="parse and report, write nothing")
    args = ap.parse_args()

    cfg = json.load(open(SOURCES))
    session = requests.Session()
    today = datetime.now().date()

    club_prefix = cfg["club"]["short"]
    suffix_to_team = {t["sourceSuffix"]: t["id"] for t in cfg["teams"]}

    all_fixtures, comps_out, notes = [], [], []

    # The club fixtures page lists every competition the club is entered in, so a new
    # cup round is found the moment it is drawn rather than waiting for a config edit.
    discovered = {}
    club_url = cfg["club"].get("fixturesUrl")
    if club_url:
        try:
            discovered = discover_competitions(fetch(club_url, session))
            print("discovered %d competition pages on the club fixtures page"
                  % len(discovered), file=sys.stderr)
        except Exception as e:                                     # noqa: BLE001
            print("could not read the club fixtures page: %s" % e, file=sys.stderr)

    claimed = set()
    for comp in cfg["competitions"]:
        for u in comp_urls(comp):
            m = COMP_HREF_RE.search(u or "")
            if m:
                claimed.add(m.group(2))

    # attach each discovered page to the competition whose keyword its name matches
    extra = {}
    for url, name in discovered.items():
        m = COMP_HREF_RE.search(url)
        cid = m.group(2) if m else None
        if cid in claimed:
            continue
        low = name.lower()
        hit = None
        for comp in cfg["competitions"]:
            for kw in (comp.get("match") or []):
                if kw.lower() in low:
                    hit = comp
                    break
            if hit:
                break
        if hit:
            extra.setdefault(hit["id"], []).append(url)
            notes.append({"kind": "attention", "comp": hit["id"], "pair": name,
                          "kept": "New round found: " + url,
                          "hidden": None,
                          "why": "Sportlomo publishes each cup round as its own competition page. "
                                 "This one was picked up automatically; add it to sources.json "
                                 "under that competition's urls to make it permanent."})
        else:
            notes.append({"kind": "attention", "comp": None, "pair": name,
                          "kept": "Unrecognised competition: " + url,
                          "hidden": None,
                          "why": "The club is entered in a competition the app does not track. "
                                 "Add it to sources.json if it should appear."})

    for comp in cfg["competitions"]:
        record = {k: comp[k] for k in ("id", "name", "short", "team", "type") if k in comp}
        record["zones"] = comp.get("zones", {})
        if comp.get("note"):
            record["note"] = comp["note"]
        record["tryBonus"] = comp.get("tryBonus", True)
        record["status"] = comp.get("status", "live")
        if record["status"] == "not-drawn" and extra.get(comp["id"]):
            record["status"] = "live"          # a round has appeared, so it is drawn now
        pages = comp_urls(comp) + extra.get(comp["id"], [])
        record["source"] = pages[0] if pages else None
        record["sources"] = pages
        record["standings"] = []

        if not pages:
            comps_out.append(record)
            continue

        html, fixtures = None, []
        for page in pages:
            try:
                page_html = fetch(page, session)
            except Exception as e:                                 # noqa: BLE001
                print("  ! %s: %s" % (page, e), file=sys.stderr)
                notes.append({"kind": "attention", "comp": comp["id"], "pair": comp["name"],
                              "kept": "Could not read " + page,
                              "hidden": None,
                              "why": "That source page did not load on this run. Anything it holds "
                                     "is missing until it does."})
                continue
            if html is None:
                html = page_html
            lines = lines_of(page_html)
            if args.debug == comp["id"]:
                print("---- %s ----" % page)
                for i, x in enumerate(lines):
                    print("%3d  %s" % (i, x))
                continue
            fixtures += parse_fixtures(lines, comp)

        if args.debug == comp["id"]:
            return 0
        if html is None:
            comps_out.append(record)
            continue

        for f in fixtures:
            for side in (f["home"], f["away"]):
                if side.startswith(club_prefix):
                    m = re.search(r"(\d)(st|nd|rd|th) XV$", side)
                    f["team"] = suffix_to_team.get(m.group(1), comp.get("team")) if m else comp.get("team")

        if comp["type"] == "league":
            parsed = parse_standings(html)
            computed = compute_standings(fixtures, comp)
            if parsed and not comp.get("tryBonus", True):
                for r in parsed:
                    r["bp4"] = None
            if parsed:
                record["standings"] = parsed
                record["standingsSource"] = "table"
                for d in check_standings(parsed, computed):
                    notes.append({"kind": "attention", "comp": comp["id"], "pair": comp["name"],
                                  "kept": d, "hidden": None,
                                  "why": "The published table and the results disagree. Usually a points "
                                         "deduction or an awarded game; worth a look either way."})
            else:
                record["standings"] = computed
                record["standingsSource"] = "computed"
                notes.append({"kind": "attention", "comp": comp["id"], "pair": comp["name"],
                              "kept": "Table built from results",
                              "hidden": None,
                              "why": "Could not read the league's own table, so it was calculated from "
                                     "the results instead. Correct unless there is a deduction or walkover."})

        all_fixtures += fixtures
        comps_out.append(record)
        print("%-7s %2d fixtures, %d played, standings %s (%d rows), %d page(s)"
              % (comp["id"], len(fixtures), sum(f["status"] == "played" for f in fixtures),
                 record.get("standingsSource", "-"), len(record["standings"]), len(pages)),
              file=sys.stderr)

    rows_in = len(all_fixtures)
    kept, issues, merged = dedupe(all_fixtures, cfg["competitions"])
    issues += flag_stale_calloffs(kept, today)
    issues += flag_missing_results(kept, today)
    issues += notes
    kept.sort(key=lambda f: (f["date"] or "9999-99-99", f["time"] or "99:99"))

    data = {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "club": cfg["club"],
        "links": cfg.get("links", {}),
        "venues": cfg.get("venues", {}),
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

    problems = sanity(data, today)
    if problems:
        print("REFUSING TO PUBLISH \u2014 the parser looks broken, keeping the last good data:",
              file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        return 1

    if args.dry_run:
        print(json.dumps(data["counts"], indent=1))
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(data, open(os.path.join(OUT_DIR, "data.json"), "w"), indent=1)

    ours = [f for f in kept if f["team"]]
    feeds = [("cill-dara-all.ics", cfg["club"]["name"], ours)]
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
