#!/usr/bin/env python3
"""
Compare the data.json currently committed against the one the scraper just wrote,
and report what changed.

    python scraper/alerts.py --before old.json --after docs/data.json
    python scraper/alerts.py --before old.json --after docs/data.json --post

Without --post it prints the message and writes docs/last-alert.txt. With --post it
also sends to ALERT_WEBHOOK, which can be any endpoint that accepts a JSON POST:
Slack, Discord, Teams, Zapier, Make, or your own relay.

WhatsApp has no free official group API. The realistic options are a paid relay
(Twilio, 360dialog) behind ALERT_WEBHOOK, or opening docs/last-alert.txt and pasting
it into the group yourself. The message is written to be pasted as it stands.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def load(path):
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path) as fh:
            return json.load(fh)
    except (ValueError, OSError):
        return None


def by_id(d):
    return {f["id"]: f for f in d.get("fixtures", [])} if d else {}


def nice_date(iso):
    if not iso:
        return "date TBC"
    try:
        dt = datetime.strptime(iso, "%Y-%m-%d")
    except ValueError:
        return iso
    return "%s %d %s" % (DAYS[dt.weekday()], dt.day, MONS[dt.month - 1])


def label(f):
    return "%s v %s" % (f.get("home", "?"), f.get("away", "?"))


def ours(f):
    return bool(f.get("team"))


def diff(before, after):
    """Changes worth telling people about, our own teams first."""
    out = []
    ob, oa = by_id(before), by_id(after)

    for fid, f in oa.items():
        old = ob.get(fid)

        if old is None:
            # only announce a brand new fixture if it is already scheduled with a date
            if f.get("date") and f.get("status") == "scheduled" and ours(f):
                out.append((0 if ours(f) else 1, "New fixture",
                            "%s — %s%s" % (label(f), nice_date(f["date"]),
                                           ", " + f["time"] if f.get("time") else "")))
            continue

        prio = 0 if ours(f) else 1

        if old.get("status") != f.get("status"):
            if f.get("status") == "played" and f.get("homeScore") is not None:
                out.append((prio, "Result",
                            "%s %s – %s %s" % (f["home"], f["homeScore"], f["awayScore"], f["away"])))
            elif f.get("status") == "called-off":
                out.append((prio, "Called off", "%s, %s" % (label(f), nice_date(f.get("date")))))
            elif f.get("status") == "conceded":
                who = f.get("concededBy") or "a team"
                out.append((prio, "Walkover", "%s conceded — %s" % (who, label(f))))
            continue

        if old.get("date") != f.get("date"):
            out.append((prio, "Date changed",
                        "%s moved from %s to %s" % (label(f), nice_date(old.get("date")), nice_date(f.get("date")))))
        if old.get("time") != f.get("time") and f.get("date"):
            out.append((prio, "Kick-off changed",
                        "%s on %s now %s (was %s)" % (label(f), nice_date(f.get("date")),
                                                      f.get("time") or "TBC", old.get("time") or "TBC")))
        if old.get("venue") != f.get("venue"):
            out.append((prio, "Venue changed",
                        "%s now at %s (was %s)" % (label(f), f.get("venue"), old.get("venue"))))
        if not old.get("referee") and f.get("referee") and ours(f):
            out.append((prio, "Referee appointed",
                        "%s for %s, %s" % (f["referee"], label(f), nice_date(f.get("date")))))

    # a cup draw appearing is worth its own line
    cb = {c["id"]: c for c in (before or {}).get("competitions", [])}
    for c in after.get("competitions", []):
        was = cb.get(c["id"])
        if was and was.get("status") == "not-drawn" and c.get("status") != "not-drawn":
            out.append((0, "Cup draw", "%s has been drawn" % c["name"]))

    out.sort(key=lambda x: (x[0], x[1]))
    return [(k, v) for _, k, v in out]


def render(changes, club):
    if not changes:
        return ""
    lines = ["*%s — fixture update*" % club, ""]
    last = None
    for kind, text in changes:
        if kind != last:
            lines.append("*%s*" % kind)
            last = kind
        lines.append("• " + text)
    return "\n".join(lines)


def post(url, text, changes):
    body = json.dumps({
        "text": text,            # Slack, Discord (with /slack), Teams, most relays
        "content": text,         # Discord native
        "changes": [{"kind": k, "text": v} for k, v in changes],
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print("posted, HTTP %s" % r.status, file=sys.stderr)
            return True
    except urllib.error.HTTPError as e:
        print("webhook rejected it: HTTP %s %s" % (e.code, e.read()[:200]), file=sys.stderr)
    except Exception as e:                                    # noqa: BLE001
        print("webhook failed: %s" % e, file=sys.stderr)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--before", default=os.path.join(ROOT, "docs", ".data.previous.json"))
    ap.add_argument("--after", default=os.path.join(ROOT, "docs", "data.json"))
    ap.add_argument("--post", action="store_true")
    args = ap.parse_args()

    before, after = load(args.before), load(args.after)
    if after is None:
        print("no new data to compare", file=sys.stderr)
        return 0
    if before is None:
        print("no previous data — nothing to compare, this is normal on a first run",
              file=sys.stderr)
        return 0

    changes = diff(before, after)
    text = render(changes, after.get("club", {}).get("name", "Cill Dara RFC"))

    out = os.path.join(ROOT, "docs", "last-alert.txt")
    with open(out, "w") as fh:
        fh.write(text + ("\n" if text else ""))

    if not changes:
        print("nothing changed", file=sys.stderr)
        return 0

    print(text)
    url = os.environ.get("ALERT_WEBHOOK", "").strip()
    if args.post and url:
        post(url, text, changes)
    elif args.post:
        print("ALERT_WEBHOOK is not set, so nothing was sent", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
