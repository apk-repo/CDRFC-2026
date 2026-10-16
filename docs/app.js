/* League Hub — Cill Dara RFC. Renders from data.json (or window.__DATA__). */
(function () {
  "use strict";

  var D = null, H = null;

  /* ------------------------------------------------------------ helpers */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function comp(id) { return D.competitions.filter(function (c) { return c.id === id; })[0] || {}; }
  function leagues() { return D.competitions.filter(function (c) { return c.type === "league"; }); }
  function isCD(name) { return /^Cill Dara\b/.test(name || ""); }
  function teamLabelFor(id) {
    var t = D.teams.filter(function (x) { return x.id === id; })[0];
    return t ? t.label : id;
  }
  function opponent(f) { return isCD(f.home) ? f.away : f.home; }
  function clubOnly(name) { return (name || "").replace(/\s\d+(st|nd|rd|th) XV$/, ""); }

  /* "North Kildare 1st XV" -> a line break can land before the grade, never inside it */
  function nameNode(full, cls) {
    var n = el("span", cls);
    var m = /^(.*)\s(\d+(?:st|nd|rd|th) XV)$/.exec(full || "");
    if (m) {
      n.appendChild(document.createTextNode(m[1] + " "));
      n.appendChild(el("span", "grade", m[2]));
    } else {
      n.textContent = full || "";
    }
    return n;
  }

  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function parseDT(f) {
    var t = (f.time && /^\d{1,2}:\d{2}$/.test(f.time)) ? f.time : "12:00";
    if (t.length === 4) t = "0" + t;
    return new Date(f.date + "T" + t + ":00");
  }
  function fmtDay(d) { return DAYS[d.getDay()] + " " + d.getDate() + " " + MONS[d.getMonth()]; }
  function fmtLongDay(d) { return DAYS_FULL[d.getDay()] + " " + d.getDate() + " " + MONS[d.getMonth()]; }
  /* Eircode routes to the exact gate; the name alone is a guess */
  function venueInfo(name) { return (D.venues && D.venues[name]) || {}; }
  function mapsUrl(name) {
    var v = venueInfo(name);
    var q = v.eircode ? v.eircode : (name + (v.town ? ", " + v.town : ", Ireland"));
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }
  function venueLine(name) {
    var v = venueInfo(name);
    return name + (v.eircode ? " \u00b7 " + v.eircode : "");
  }

  function ordinal(n) {
    if (!n) return "–";
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* Monday of the fixture's week, so a Saturday and Sunday share one key */
  function weekendKey(f) {
    var d = new Date(f.date + "T12:00:00");
    var mon = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return mon.getFullYear() + "-" + ("0" + (mon.getMonth() + 1)).slice(-2) + "-" + ("0" + mon.getDate()).slice(-2);
  }
  function weekendLabel(key) {
    var mon = new Date(key + "T12:00:00");
    var sat = new Date(mon); sat.setDate(mon.getDate() + 5);
    var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    if (sat.getMonth() === sun.getMonth()) {
      return "Sat " + sat.getDate() + " – Sun " + sun.getDate() + " " + MONS[sun.getMonth()];
    }
    return "Sat " + sat.getDate() + " " + MONS[sat.getMonth()] + " – Sun " + sun.getDate() + " " + MONS[sun.getMonth()];
  }

  /* ------------------------------------------------------------ rugby logic */
  /* league points one side took from a game: 4 win, 2 draw, 1 losing by 7 or fewer, 1 for 4+ tries */
  function isOff(f) { return f.status === "called-off" || f.status === "conceded"; }
  function concededByUs(f) {
    return f.status === "conceded" && f.concededBy && isCD(f.concededBy);
  }
  /* who won a conceded game */
  function walkoverWinner(f) {
    if (f.status !== "conceded" || !f.concededBy) return null;
    return f.concededBy === f.home ? f.away : f.home;
  }

  function matchPoints(f, home) {
    var s = home ? f.homeScore : f.awayScore;
    var o = home ? f.awayScore : f.homeScore;
    var tries = home ? f.homeTries : f.awayTries;
    if (s == null || o == null) return null;
    var r = { pts: 0, tb: false, lb: false, res: s > o ? "W" : (s < o ? "L" : "D") };
    if (s > o) r.pts = 4;
    else if (s === o) r.pts = 2;
    else if (o - s <= 7) { r.pts = 1; r.lb = true; }
    if (comp(f.comp).tryBonus !== false && tries != null && tries >= 4) { r.pts += 1; r.tb = true; }
    return r;
  }

  /* Sportlomo's BP column is the TOTAL; the four-try count is its own column.
     Derive it when an older data.json is still being served. */
  function tryBonusOf(r) {
    if (r.bp4 != null) return r.bp4;
    if (r.bp != null) return Math.max(0, r.bp - (r.bpl || 0));
    return 0;
  }

  function zoneOf(pos, n, z) {
    z = z || {};
    var up = z.autoUp || 0, pu = z.playoffUp || 0, dn = z.autoDown || 0, pd = z.playoffDown || 0;
    if (pos <= up) return "up";
    if (pos <= up + pu) return "po-up";
    if (pos > n - dn) return "down";
    if (pos > n - dn - pd) return "po-down";
    return null;
  }
  var ZONE_TEXT = {
    "up": "Promotion Position",
    "po-up": "Promotion Playoff Position",
    "po-down": "Relegation Playoff Position",
    "down": "Relegation Position"
  };

  /* ------------------------------------------------------------ fixture sets */
  function ourFixtures() { return D.fixtures.filter(function (f) { return isCD(f.home) || isCD(f.away); }); }
  function upcoming() {
    var cut = new Date(Date.now() - 3 * 3600000);
    return ourFixtures().filter(function (f) {
      return f.status === "scheduled" && f.date && parseDT(f) >= cut;
    }).sort(function (a, b) { return parseDT(a) - parseDT(b); });
  }
  function byDay(list) {
    var out = [], cur = null;
    list.forEach(function (f) {
      if (!cur || cur.date !== f.date) { cur = { date: f.date, items: [] }; out.push(cur); }
      cur.items.push(f);
    });
    return out;
  }

  /* ------------------------------------------------------------ shared pieces */
  function scoreline(f) {
    var wrap = el("div", "score");
    var hs = f.homeScore, as = f.awayScore;
    [{ name: f.home, score: hs, tries: f.homeTries, home: true },
     { name: f.away, score: as, tries: f.awayTries, home: false }].forEach(function (s) {
      var decided = hs != null && as != null && hs !== as;
      var won = decided && s.score === Math.max(hs, as);
      var row = el("div", "score-row" + (won ? " won" : (decided ? " lost" : "")));
      var nm = nameNode(s.name, "score-name" + (isCD(s.name) ? " ours" : ""));
      row.appendChild(nm);
      var extra = el("div", "score-extra");
      var mp = comp(f.comp).type === "league" ? matchPoints(f, s.home) : null;
      if (mp && mp.tb) extra.appendChild(el("span", "bp bp-tb", "TB"));
      if (mp && mp.lb) extra.appendChild(el("span", "bp bp-lb", "LB"));
      if (s.tries != null) extra.appendChild(el("span", "score-tries", s.tries + "t"));
      row.appendChild(extra);
      row.appendChild(el("div", "score-num", s.score == null ? "–" : String(s.score)));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function dayLabel(text) {
    var w = el("div", "daylabel");
    w.appendChild(el("span", null, text));
    w.appendChild(el("span", "rule"));
    return w;
  }

  function seg(options, current, onPick) {
    var s = el("div", "seg");
    options.forEach(function (o) {
      var b = el("button", "seg-btn" + (o[0] === current ? " on" : ""), o[1]);
      b.type = "button";
      b.onclick = function () { onPick(o[0]); };
      s.appendChild(b);
    });
    return s;
  }


  /* ------------------------------------------------- season summary */
  /* Plain sentences built from the actual numbers, so it reads like someone
     wrote it rather than a row of statistics. */
  function seasonSummary(c) {
    var me = null;
    (c.standings || []).forEach(function (r) { if (isCD(r.team)) me = r; });
    if (!me || !me.pld) return null;

    var n = (c.standings || []).length;
    var bits = [];
    var rec = me.w + (me.w === 1 ? " win" : " wins");
    if (me.d) rec += ", " + me.d + (me.d === 1 ? " draw" : " draws");
    if (me.l) rec += " and " + me.l + (me.l === 1 ? " defeat" : " defeats");
    else if (me.w === me.pld) rec = me.w + " from " + me.pld;

    var place = ordinal(me.pos) + " of " + n;
    if (me.pos === 1) {
      var second = c.standings[1];
      place = second && second.pts === me.pts ? "top on points difference" : "top of the table";
    }
    bits.push(rec + ", and " + place + ".");

    var diff = me.pf - me.pa;
    bits.push(me.pf + " points scored and " + me.pa + " conceded" +
              (diff > 0 ? ", a difference of +" + diff : "") + ".");

    var myTb = tryBonusOf(me);
    if (c.tryBonus !== false && myTb) {
      bits.push(myTb === me.pld
        ? "A try bonus in every game so far."
        : "Try bonuses in " + myTb + " of " + me.pld + ".");
    }
    if (me.bpl) bits.push(me.bpl + (me.bpl === 1 ? " losing bonus point." : " losing bonus points."));

    var gh = ghostAt(c.id, me.pld);
    if (gh) {
      var d = me.pts - gh.pts;
      bits.push(d > 0
        ? "At the same stage last season the side had " + gh.pts + "; this one has " + me.pts + "."
        : (d < 0
            ? "Last season's side had " + gh.pts + " at this stage, " + Math.abs(d) + " more than now."
            : "Exactly level with last season's side at this stage, on " + me.pts + "."));
    }
    return bits.join(" ");
  }

  /* ------------------------------------------------- on this day */
  function onThisDay() {
    if (!H || !H.seasons) return null;
    var now = new Date();
    var best = null;
    H.seasons.forEach(function (season) {
      (season.competitions || []).forEach(function (c) {
        (c.fixtures || []).forEach(function (f) {
          if (!f.date || f.homeScore == null) return;
          var d = new Date(f.date + "T12:00:00");
          /* distance from today's date, ignoring the year */
          var anniv = new Date(now.getFullYear(), d.getMonth(), d.getDate(), 12);
          var gap = Math.round(Math.abs(anniv - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / 86400000);
          gap = Math.min(gap, 365 - gap);
          if (!best || gap < best.gap) best = { gap: gap, f: f, season: season.label, comp: c };
        });
      });
    });
    return best;
  }

  function onThisDayCard() {
    var hit = onThisDay();
    if (!hit) return null;
    var f = hit.f, ourHome = isCD(f.home);
    var us = ourHome ? f.homeScore : f.awayScore;
    var them = ourHome ? f.awayScore : f.homeScore;
    var res = us > them ? "w" : (us < them ? "l" : "d");
    var d = new Date(f.date + "T12:00:00");

    var card = el("article", "otd rc-" + res);
    var head = el("div", "otd-head");
    head.appendChild(el("span", "rc-badge", res === "w" ? "WON" : res === "l" ? "LOST" : "DREW"));
    var ht = el("div", "otd-when");
    ht.appendChild(el("div", "otd-date", fmtLongDay(d) + " " + d.getFullYear()));
    ht.appendChild(el("div", "otd-meta", hit.season + " · " + (hit.comp.name || "")));
    head.appendChild(ht);
    card.appendChild(head);

    var body = el("div", "otd-body");
    body.appendChild(scorelineRaw(f));
    body.appendChild(el("div", "otd-venue", f.venue || ""));
    card.appendChild(body);
    return { card: card, exact: hit.gap <= 1 };
  }

  /* history fixtures carry no competition the app knows, so draw them plainly */
  function scorelineRaw(f) {
    var wrap = el("div", "score");
    var hs = f.homeScore, as = f.awayScore;
    [{ name: f.home, score: hs, tries: f.homeTries },
     { name: f.away, score: as, tries: f.awayTries }].forEach(function (side) {
      var won = hs != null && as != null && hs !== as && side.score === Math.max(hs, as);
      var row = el("div", "score-row" + (won ? " won" : ""));
      row.appendChild(nameNode(side.name, "score-name" + (isCD(side.name) ? " ours" : "")));
      var extra = el("div", "score-extra");
      if (side.tries != null) extra.appendChild(el("span", "score-tries", side.tries + "t"));
      row.appendChild(extra);
      row.appendChild(el("div", "score-num", side.score == null ? "–" : String(side.score)));
      wrap.appendChild(row);
    });
    return wrap;
  }

  /* ------------------------------------------------- opposition dossier */
  function dossier(f) {
    var c = comp(f.comp);
    if (!c || !c.standings || !c.standings.length) return null;
    var them = opponent(f);
    var row = c.standings.filter(function (r) { return r.team === them; })[0];
    if (!row) return null;

    var theirs = D.fixtures.filter(function (x) {
      return x.comp === c.id && (x.home === them || x.away === them) && x.status === "played";
    });
    var home = { w: 0, p: 0 }, away = { w: 0, p: 0 }, tf = 0, ta = 0;
    theirs.forEach(function (x) {
      var atHome = x.home === them;
      var us = atHome ? x.homeScore : x.awayScore;
      var th = atHome ? x.awayScore : x.homeScore;
      var bucket = atHome ? home : away;
      bucket.p++;
      if (us > th) bucket.w++;
      tf += (atHome ? x.homeTries : x.awayTries) || 0;
      ta += (atHome ? x.awayTries : x.homeTries) || 0;
    });

    /* every previous meeting we hold, this season and last */
    var met = [];
    D.fixtures.forEach(function (x) {
      if (x.status !== "played") return;
      if ((x.home === them && isCD(x.away)) || (x.away === them && isCD(x.home))) met.push(x);
    });
    if (H && H.seasons) {
      H.seasons.forEach(function (season) {
        (season.competitions || []).forEach(function (hc) {
          (hc.fixtures || []).forEach(function (x) {
            if (x.homeScore == null) return;
            if (x.home === them || x.away === them) met.push(x);
          });
        });
      });
    }
    met.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });

    return { team: them, row: row, home: home, away: away, tf: tf, ta: ta,
             met: met.slice(0, 4), n: c.standings.length, compId: c.id };
  }

  function dossierCard(f) {
    var k = dossier(f);
    if (!k) return null;
    var card = el("div", "card dossier");

    var top = el("div", "dos-top");
    var tt = el("div", "dos-title");
    tt.appendChild(nameNode(k.team, "dos-team"));
    tt.appendChild(el("div", "dos-meta", ordinal(k.row.pos) + " of " + k.n + " · " +
      k.row.pts + " pts · " + k.row.pf + "–" + k.row.pa));
    top.appendChild(tt);
    var fw = el("div", "dos-form");
    fw.appendChild(formStrip(k.compId, k.team, 5));
    top.appendChild(fw);
    card.appendChild(top);

    var grid = el("div", "dos-grid");
    function stat(label, value) {
      var b = el("div", "dos-stat");
      b.appendChild(el("div", "dos-v", value));
      b.appendChild(el("div", "dos-k", label));
      grid.appendChild(b);
    }
    stat("at home", k.home.p ? k.home.w + " of " + k.home.p : "–");
    stat("away", k.away.p ? k.away.w + " of " + k.away.p : "–");
    stat("tries for", String(k.tf));
    stat("tries against", String(k.ta));
    card.appendChild(grid);

    if (k.met.length) {
      var h2h = el("div", "dos-h2h");
      h2h.appendChild(el("div", "dos-h2h-l", "LAST MEETINGS"));
      k.met.forEach(function (m) {
        var ourHome = isCD(m.home);
        var us = ourHome ? m.homeScore : m.awayScore;
        var th = ourHome ? m.awayScore : m.homeScore;
        var r = el("div", "dos-row");
        r.appendChild(el("span", "dos-res dr-" + (us > th ? "w" : us < th ? "l" : "d"),
                         us > th ? "W" : us < th ? "L" : "D"));
        r.appendChild(el("span", "dos-score", us + "–" + th));
        r.appendChild(el("span", "dos-where", (ourHome ? "home" : "away") + " · " +
          fmtDay(new Date(m.date + "T12:00:00")) + " " + new Date(m.date + "T12:00:00").getFullYear()));
        h2h.appendChild(r);
      });
      card.appendChild(h2h);
    }
    return card;
  }

  /* ================================================================ MATCHDAY */
  function viewMatchday() {
    var root = el("div", "view");
    var next = upcoming();

    if (next.length) {
      var day = byDay(next)[0];
      var first = day.items[0];
      var d = parseDT(first);
      var venues = {};
      day.items.forEach(function (f) { venues[f.venue] = 1; });
      var oneVenue = Object.keys(venues).length === 1;
      var homeDay = isCD(first.home);

      var hero = el("section", "hero");
      hero.appendChild(el("div", "eyebrow", day.items.length > 1 ? "NEXT CLUB DAY" : "NEXT MATCH"));
      hero.appendChild(el("h2", "hero-title", clubOnly(opponent(first)) + " \u2013 " + (homeDay ? "Home" : "Away")));
      hero.appendChild(el("div", "hero-sub", fmtLongDay(d) + (oneVenue ? " · " + venueLine(first.venue) : "")));
      var wxHost = el("div", "wx-host");
      hero.appendChild(wxHost);
      attachWeather(wxHost, first);

      /* countdown to the first kick-off of the day */
      var cd = el("div", "countdown");
      cd.id = "countdown";
      cd.setAttribute("data-target", d.toISOString());
      var grid = el("div", "cd-grid");
      [["days", "DAYS"], ["hrs", "HRS"], ["min", "MIN"], ["sec", "SEC"]].forEach(function (u, i) {
        if (i) grid.appendChild(el("div", "cd-sep", ":"));
        var cell = el("div", "cd-cell");
        cell.appendChild(el("div", "cd-n", "–"));
        cell.appendChild(el("div", "cd-u", u[1]));
        grid.appendChild(cell);
      });
      cd.appendChild(grid);
      cd.appendChild(el("div", "cd-live", ""));
      cd.appendChild(el("div", "cd-for", "to " + teamLabelFor(first.team) + " kick-off, " + first.time));
      hero.appendChild(cd);

      day.items.forEach(function (f) {
        var row = el("div", "hero-row" + (f.team === "1st" ? " accent" : ""));
        row.appendChild(el("div", "hero-time", f.time || "TBC"));
        var body = el("div", "hero-body");
        var m = el("div", "hero-match");
        m.appendChild(el("span", "nw", teamLabelFor(f.team)));
        m.appendChild(document.createTextNode(" v "));
        m.appendChild(el("span", "nw", opponent(f)));
        body.appendChild(m);
        var meta = [comp(f.comp).short];
        if (f.round && comp(f.comp).type === "cup") meta.push(f.round);
        if (!oneVenue) meta.unshift(f.venue);
        meta.push(f.referee ? "Ref " + f.referee : "Ref TBC");
        body.appendChild(el("div", "hero-meta", meta.join(" · ")));
        row.appendChild(body);
        hero.appendChild(row);
      });

      var acts = el("div", "hero-actions");
      var cal = el("a", "btn btn-primary", "Add to calendar");
      cal.href = "#calendar";
      cal.onclick = function (e) {
        e.preventDefault();
        var t = document.getElementById("calendar");
        if (t) t.scrollIntoView({ behavior: "smooth" });
      };
      acts.appendChild(cal);
      var dir = el("a", "btn btn-ghost", "Directions");
      dir.href = mapsUrl(first.venue);
      dir.target = "_blank"; dir.rel = "noopener";
      acts.appendChild(dir);
      hero.appendChild(acts);
      root.appendChild(hero);

      var lead = day.items.filter(function (x) { return x.team === "1st"; })[0] || first;
      var dos = dossierCard(lead);
      if (dos) {
        root.appendChild(el("div", "label", clubOnly(opponent(lead)).toUpperCase() + " \u00b7 THE OPPOSITION"));
        root.appendChild(dos);
      }
    } else {
      root.appendChild(el("p", "empty", "No fixtures left in the feed."));
    }

    /* ---- last time out: the most recent game for each team ---- */
    var lastCards = [];
    D.teams.forEach(function (t) {
      var mine = ourFixtures().filter(function (f) {
        return f.team === t.id && f.date && f.status !== "scheduled";
      }).sort(function (a, b) { return parseDT(b) - parseDT(a); });
      if (mine.length) lastCards.push(resultCard(mine[0]));
    });
    if (lastCards.length) {
      root.appendChild(el("div", "label", "LAST TIME OUT"));
      var lt = el("div", "stack");
      lastCards.forEach(function (c) { lt.appendChild(c); });
      root.appendChild(lt);
    }

    /* ---- standings ---- */
    var ls = leagues().filter(function (c) { return c.standings && c.standings.length; });
    if (ls.length) {
      root.appendChild(el("div", "label", "STANDINGS"));
      var st = el("div", "stack");
      ls.forEach(function (c) { st.appendChild(standingCard(c)); });
      root.appendChild(st);

      var firstLeague = ls.filter(function (c) { return c.team === "1st"; })[0] || ls[0];
      var sum = seasonSummary(firstLeague);
      if (sum) {
        root.appendChild(el("div", "label", "THE SEASON SO FAR"));
        var sc = el("div", "card summary");
        sc.appendChild(el("p", "sum-text", sum));
        sc.appendChild(el("div", "sum-team", teamLabelFor(firstLeague.team) + " \u00b7 " + firstLeague.name));
        root.appendChild(sc);
      }
    }

    var otd = onThisDayCard();
    if (otd) {
      root.appendChild(el("div", "label", otd.exact ? "ON THIS DAY" : "AROUND THIS TIME LAST SEASON"));
      root.appendChild(otd.card);
    }
    return root;
  }

  function resultCard(f) {
    var ourHome = isCD(f.home);
    var c = comp(f.comp);
    var card = el("article", "rcard");
    var mp = f.status === "played" ? matchPoints(f, ourHome) : null;
    var state;
    if (f.status === "conceded") state = concededByUs(f) ? "l" : "w";
    else if (f.status === "called-off") state = "off";
    else state = mp ? mp.res.toLowerCase() : "d";
    card.classList.add("rc-" + state);

    var head = el("div", "rc-head");
    var badge = state === "off" ? "OFF" : state === "w" ? "WON" : state === "l" ? "LOST" : "DRAW";
    if (f.status === "conceded") badge = concededByUs(f) ? "CONC" : "W/O";
    head.appendChild(el("span", "rc-badge", badge));
    var ht = el("div", "rc-title");
    ht.appendChild(el("div", "rc-team", teamLabelFor(f.team)));
    ht.appendChild(el("div", "rc-meta", c.short + " · " + fmtDay(parseDT(f)) + " · " + f.venue));
    head.appendChild(ht);
    card.appendChild(head);

    var body = el("div", "rc-body");
    if (f.status === "conceded") {
      var ct = el("div", "rc-off");
      ct.appendChild(el("span", "nw", f.home));
      ct.appendChild(document.createTextNode(" v "));
      ct.appendChild(el("span", "nw", f.away));
      body.appendChild(ct);
      body.appendChild(el("div", "rc-note",
        concededByUs(f) ? "Conceded \u00b7 4 points to " + clubOnly(walkoverWinner(f)) + ", 4 docked"
                        : "Walkover \u00b7 " + clubOnly(f.concededBy) + " conceded, 4 points awarded"));
    } else if (f.status === "called-off") {
      var t = el("div", "rc-off");
      t.appendChild(el("span", "nw", f.home));
      t.appendChild(document.createTextNode(" v "));
      t.appendChild(el("span", "nw", f.away));
      body.appendChild(t);
      body.appendChild(el("div", "rc-note", "Called off · no new date yet"));
    } else {
      body.appendChild(scoreline(f));
      var chips = el("div", "chips-row");
      var tries = ourHome ? f.homeTries : f.awayTries;
      if (tries != null) chips.appendChild(el("span", "pill", tries + (tries === 1 ? " try" : " tries")));
      if (mp && mp.tb) chips.appendChild(el("span", "pill pill-gold", "Try bonus"));
      if (mp && mp.lb) chips.appendChild(el("span", "pill pill-gold", "Losing bonus"));
      if (mp && c.type === "league") chips.appendChild(el("span", "pill pill-strong", "+" + mp.pts + " league pts"));
      if (c.type === "cup" && f.round) chips.appendChild(el("span", "pill", f.round));
      body.appendChild(chips);
      if (f.homeScore != null) {
        var sr = el("div", "share-row");
        sr.appendChild(shareButton(f));
        body.appendChild(sr);
      }
    }
    card.appendChild(body);
    return card;
  }

  function standingCard(c) {
    var rows = c.standings;
    var n = rows.length;
    var i = 0;
    rows.forEach(function (r, k) { if (isCD(r.team)) i = k; });
    var me = rows[i];
    var zone = zoneOf(me.pos, n, c.zones);

    var card = el("a", "scard");
    card.href = "#tables";
    card.onclick = function (e) { e.preventDefault(); tableTeam = c.team; go("tables"); };

    var top = el("div", "sc-top");
    top.appendChild(el("div", "sc-pos", ordinal(me.pos)));
    var tt = el("div", "sc-title");
    tt.appendChild(el("div", "sc-team", teamLabelFor(c.team)));
    tt.appendChild(el("div", "sc-comp", c.name));
    top.appendChild(tt);
    top.appendChild(el("div", "sc-pts", me.pts + " pts"));
    card.appendChild(top);

    if (zone) {
      card.appendChild(el("div", "sc-zone zone-" + zone, ZONE_TEXT[zone]));
    } else if (c.note) {
      card.appendChild(el("div", "sc-zone zone-none", c.note));
    }

    /* three-row slice centred on us */
    var from = Math.max(0, Math.min(i - 1, n - 3));
    var mini = el("div", "sc-mini");
    rows.slice(from, from + 3).forEach(function (r) {
      var row = el("div", "sc-row" + (isCD(r.team) ? " ours" : ""));
      var mk = el("span", "mk");
      var rz = zoneOf(r.pos, n, c.zones);
      if (rz) mk.classList.add("mk-" + rz);
      row.appendChild(mk);
      row.appendChild(el("span", "sc-rpos", String(r.pos)));
      row.appendChild(nameNode(r.team, "sc-rname"));
      row.appendChild(el("span", "sc-rpld", "P" + r.pld));
      row.appendChild(el("span", "sc-rpts", String(r.pts)));
      mini.appendChild(row);
    });
    card.appendChild(mini);

    var fr = el("div", "sc-form");
    fr.appendChild(el("span", "sc-form-l", "FORM"));
    fr.appendChild(formStrip(c.id, me.team, 5));
    card.appendChild(fr);

    card.appendChild(el("div", "sc-gap", gapLine(rows, i)));
    return card;
  }

  function gapLine(rows, i) {
    var me = rows[i];
    if (!me.pld) return "No games played yet.";
    if (i === 0) {
      var second = rows[1];
      if (!second) return "Top of the table.";
      if (second.pts === me.pts) return "Top on points difference, level with " + clubOnly(second.team) + ".";
      var g = me.pts - second.pts;
      return g + (g === 1 ? " point" : " points") + " clear of " + clubOnly(second.team) + ".";
    }
    var lead = rows[0];
    var behind = lead.pts - me.pts;
    if (behind === 0) return "Level on points with the leaders, " + clubOnly(lead.team) + ".";
    return behind + (behind === 1 ? " point" : " points") + " off the top, behind " + clubOnly(lead.team) + ".";
  }

  /* ================================================================ FIXTURES */
  var fixFilter = "all";
  function viewFixtures() {
    var root = el("div", "view");
    var chips = el("div", "chips");
    [["all", "All teams"], ["1st", "1st XV"], ["2nd", "2nd XV"], ["cup", "Cups"]].forEach(function (p) {
      var b = el("button", "chip-btn" + (fixFilter === p[0] ? " on" : ""), p[1]);
      b.type = "button";
      b.onclick = function () { fixFilter = p[0]; render(); };
      chips.appendChild(b);
    });
    root.appendChild(chips);

    if (fixFilter === "cup") { cupsInto(root); return root; }

    var list = upcoming().filter(function (f) { return fixFilter === "all" || f.team === fixFilter; });
    if (!list.length) root.appendChild(el("p", "empty", "Nothing scheduled."));
    byDay(list).forEach(function (g) {
      var d = parseDT(g.items[0]);
      var vs = {};
      g.items.forEach(function (f) { vs[f.venue] = 1; });
      var venues = Object.keys(vs);
      root.appendChild(dayLabel(fmtLongDay(d).toUpperCase() + (venues.length === 1 ? " · " + venues[0].toUpperCase() : "")));
      var card = el("div", "card");
      g.items.forEach(function (f, i) { card.appendChild(fixRow(f, i > 0, venues.length > 1)); });
      root.appendChild(card);
    });

    var more = el("button", "linkrow", "Results for the whole division  →");
    more.type = "button";
    more.onclick = function () { go("results"); };
    root.appendChild(more);
    return root;
  }

  function fixRow(f, sep, showVenue) {
    var row = el("div", "fx" + (sep ? " sep" : "") + (f.team === "1st" ? " accent" : ""));
    row.appendChild(el("div", "fx-time", f.time || "TBC"));
    var body = el("div", "fx-body");
    var m = el("div", "fx-match");
    m.appendChild(el("span", "nw", f.home));
    m.appendChild(document.createTextNode(" v "));
    m.appendChild(el("span", "nw", f.away));
    body.appendChild(m);
    var tags = el("div", "fx-tags");
    if (f.team) tags.appendChild(el("span", "tag tag-" + f.team, f.team === "1st" ? "1ST XV" : "2ND XV"));
    var meta = [comp(f.comp).short];
    if (f.round && comp(f.comp).type === "cup") meta.push(f.round);
    if (showVenue) meta.push(f.venue);
    if (f.referee) meta.push(f.referee);
    tags.appendChild(el("span", "fx-meta", meta.join(" · ")));
    body.appendChild(tags);
    row.appendChild(body);
    row.appendChild(el("span", "tag " + (isCD(f.home) ? "tag-home" : "tag-away"), isCD(f.home) ? "HOME" : "AWAY"));
    return row;
  }

  function cupsInto(root) {
    var cups = D.competitions.filter(function (c) { return c.type === "cup"; });
    cups.filter(function (c) { return c.status !== "not-drawn"; }).forEach(function (c) {
      root.appendChild(el("div", "label", c.name.toUpperCase() + " · " + teamLabelFor(c.team).toUpperCase()));
      var card = el("div", "card");
      D.fixtures.filter(function (f) { return f.comp === c.id; })
        .sort(function (a, b) { return parseDT(a) - parseDT(b); })
        .forEach(function (f, i) {
          var mine = isCD(f.home) || isCD(f.away);
          var row = el("div", "res-row" + (i ? " sep" : "") + (mine ? "" : " dim"));
          var body = el("div", "res-body");
          body.appendChild(el("div", "round", (f.round || "").toUpperCase() + (mine ? "" : " · OTHER SIDE OF THE DRAW")));
          if (f.homeScore != null) body.appendChild(scoreline(f));
          else {
            var t = el("div", "res-title");
            t.appendChild(el("span", "nw", f.home));
            t.appendChild(document.createTextNode(" v "));
            t.appendChild(el("span", "nw", f.away));
            body.appendChild(t);
          }
          body.appendChild(el("div", "res-meta",
            fmtDay(parseDT(f)) + " · " + (f.time || "TBC") + " · " + f.venue + (f.referee ? " · " + f.referee : "")));
          row.appendChild(body);
          card.appendChild(row);
        });
      root.appendChild(card);
    });
    var pending = cups.filter(function (c) { return c.status === "not-drawn"; });
    if (pending.length) {
      root.appendChild(el("div", "label", "LATER IN THE SEASON"));
      pending.forEach(function (c) {
        var card = el("div", "card dashed");
        var row = el("div", "comp-row");
        var body = el("div", "comp-body");
        body.appendChild(el("div", "comp-title", c.name));
        body.appendChild(el("div", "comp-meta", "Not drawn yet. It appears here, and in your calendar, the moment it is."));
        row.appendChild(body);
        row.appendChild(el("span", "tag tag-none", "NOT DRAWN"));
        card.appendChild(row);
        root.appendChild(card);
      });
    }
  }

  /* ================================================================ RESULTS */
  var resultsTeam = "1st";
  function viewResults() {
    var root = el("div", "view");
    var ls = leagues();
    root.appendChild(seg(ls.map(function (c) { return [c.team, teamLabelFor(c.team)]; }), resultsTeam,
      function (v) { resultsTeam = v; render(); }));
    var c = ls.filter(function (x) { return x.team === resultsTeam; })[0];
    if (!c) return root;
    root.appendChild(el("div", "label", c.name.toUpperCase() + " · EVERY RESULT"));

    var done = D.fixtures.filter(function (f) {
      return f.comp === c.id && f.date && f.status !== "scheduled";
    });
    if (!done.length) { root.appendChild(el("p", "empty", "No results yet this season.")); return root; }

    var groups = {};
    done.forEach(function (f) { (groups[weekendKey(f)] = groups[weekendKey(f)] || []).push(f); });
    var keys = Object.keys(groups).sort().reverse();
    var total = Object.keys(groups).length;

    root.classList.add("results");
    keys.forEach(function (k, gi) {
      var list = groups[k].sort(function (a, b) {
        var ao = (isCD(a.home) || isCD(a.away)) ? 0 : 1, bo = (isCD(b.home) || isCD(b.away)) ? 0 : 1;
        return ao - bo || parseDT(a) - parseDT(b);
      });
      root.appendChild(dayLabel("WEEKEND " + (total - gi) + " · " + weekendLabel(k).toUpperCase()));
      var card = el("div", "card");
      list.forEach(function (f, i) {
        var mine = isCD(f.home) || isCD(f.away);
        var row = el("div", "res-row" + (i ? " sep" : "") + (mine ? " mine" : ""));
        var body = el("div", "res-body");
        if (f.status === "conceded") {
          var ct = el("div", "res-title");
          ct.appendChild(el("span", "nw", f.home));
          ct.appendChild(document.createTextNode(" v "));
          ct.appendChild(el("span", "nw", f.away));
          body.appendChild(ct);
          var cm = el("div", "res-meta");
          cm.appendChild(el("span", "bp bp-conc", "W/O"));
          cm.appendChild(document.createTextNode(" " + clubOnly(f.concededBy) + " conceded \u00b7 " +
            clubOnly(walkoverWinner(f)) + " awarded the game \u00b7 " + fmtDay(parseDT(f))));
          body.appendChild(cm);
        } else if (f.status === "called-off") {
          var t = el("div", "res-title muted");
          t.appendChild(el("span", "nw", f.home));
          t.appendChild(document.createTextNode(" v "));
          t.appendChild(el("span", "nw", f.away));
          body.appendChild(t);
          body.appendChild(el("div", "res-meta", fmtDay(parseDT(f)) + " · called off"));
        } else {
          body.appendChild(scoreline(f));
          body.appendChild(el("div", "res-meta", fmtDay(parseDT(f)) + " · " + venueLine(f.venue)));
          if (mine) {
            var sr2 = el("div", "share-row");
            sr2.appendChild(shareButton(f));
            body.appendChild(sr2);
          }
        }
        row.appendChild(body);
        card.appendChild(row);
      });
      root.appendChild(card);
    });

    var key = el("div", "legend");
    key.appendChild(legendItem("bp bp-tb", "TB", "try bonus, 4 or more tries"));
    key.appendChild(legendItem("bp bp-lb", "LB", "losing bonus, lost by 7 or fewer"));
    root.appendChild(key);
    return root;
  }

  function legendItem(cls, badge, text) {
    var w = el("div", "legend-item");
    w.appendChild(el("span", cls, badge));
    w.appendChild(el("span", null, text));
    return w;
  }

  /* ----------------------------------------------------------- history */
  /* Rebuild the table after each round from the results we already hold, so form
     and position-by-round need no stored history. */
  function roundsOf(compId) {
    var done = D.fixtures.filter(function (f) {
      return f.comp === compId && f.date && f.status !== "scheduled";
    }).sort(function (a, b) { return parseDT(a) - parseDT(b); });
    var out = [], seen = {};
    done.forEach(function (f) {
      var k = weekendKey(f);
      if (!seen[k]) { seen[k] = { key: k, items: [] }; out.push(seen[k]); }
      seen[k].items.push(f);
    });
    return out;
  }

  function tableAfter(compId, upto) {
    var c = comp(compId);
    var tb = c.tryBonus !== false;
    var rows = {};
    (c.standings || []).forEach(function (r) {
      rows[r.team] = { team: r.team, pld: 0, pf: 0, pa: 0, pts: 0 };
    });
    D.fixtures.filter(function (f) { return f.comp === compId; }).forEach(function (f) {
      [f.home, f.away].forEach(function (t) {
        if (!rows[t]) rows[t] = { team: t, pld: 0, pf: 0, pa: 0, pts: 0 };
      });
    });
    roundsOf(compId).slice(0, upto).forEach(function (g) {
      g.items.forEach(function (f) {
        if (f.status === "conceded" && f.concededBy) {
          var w = walkoverWinner(f);
          if (rows[w]) { rows[w].pld++; rows[w].pts += 4; }
          if (rows[f.concededBy]) { rows[f.concededBy].pld++; rows[f.concededBy].pts -= 4; }
          return;
        }
        if (f.status !== "played" || f.homeScore == null) return;
        [[f.home, true], [f.away, false]].forEach(function (side) {
          var r = rows[side[0]];
          if (!r) return;
          var mp = matchPoints(f, side[1]);
          var sc = side[1] ? f.homeScore : f.awayScore;
          var op = side[1] ? f.awayScore : f.homeScore;
          r.pld++; r.pf += sc; r.pa += op;
          if (mp) r.pts += mp.pts;
        });
      });
    });
    var list = Object.keys(rows).map(function (k) { return rows[k]; });
    list.sort(function (a, b) {
      return (b.pts - a.pts) || ((b.pf - b.pa) - (a.pf - a.pa)) || (b.pf - a.pf) || a.team.localeCompare(b.team);
    });
    list.forEach(function (r, i) { r.pos = i + 1; });
    return list;
  }

  /* W / L / D / walkover per team, oldest first */
  function formOf(compId, team) {
    var out = [];
    D.fixtures.filter(function (f) {
      return f.comp === compId && f.date && f.status !== "scheduled" &&
             (f.home === team || f.away === team);
    }).sort(function (a, b) { return parseDT(a) - parseDT(b); }).forEach(function (f) {
      if (f.status === "conceded" && f.concededBy) {
        out.push({ r: f.concededBy === team ? "C" : "W", f: f });
      } else if (f.status === "called-off") {
        return;
      } else if (f.homeScore != null) {
        var mp = matchPoints(f, f.home === team);
        out.push({ r: mp.res, f: f });
      }
    });
    return out;
  }

  function formStrip(compId, team, max) {
    var wrap = el("div", "form");
    var list = formOf(compId, team);
    if (!list.length) { wrap.appendChild(el("span", "fdot fd-none", "–")); return wrap; }
    list.slice(-(max || 5)).forEach(function (x) {
      var d = el("span", "fdot fd-" + x.r.toLowerCase(), x.r);
      var f = x.f;
      var them = f.home === team ? f.away : f.home;
      d.title = clubOnly(them) + (f.homeScore != null ? " " + f.homeScore + "\u2013" + f.awayScore : " (walkover)");
      wrap.appendChild(d);
    });
    return wrap;
  }

  /* position by round, drawn as an inline SVG */
  function positionChart(compId, team) {
    var rounds = roundsOf(compId);
    if (rounds.length < 2) return null;
    var n = (comp(compId).standings || []).length || 8;
    var pts = [];
    for (var i = 1; i <= rounds.length; i++) {
      var t = tableAfter(compId, i);
      for (var k = 0; k < t.length; k++) if (t[k].team === team) pts.push(t[k].pos);
    }
    if (pts.length < 2) return null;

    var W = 300, H = 108, padL = 22, padR = 10, padT = 12, padB = 20;
    var iw = W - padL - padR, ih = H - padT - padB;
    var x = function (i) { return padL + (pts.length === 1 ? iw / 2 : iw * i / (pts.length - 1)); };
    var y = function (p) { return padT + ih * (p - 1) / (n - 1); };

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", "poschart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "League position after each round: " + pts.join(", "));
    function add(tag, attrs, text) {
      var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (var a in attrs) e.setAttribute(a, attrs[a]);
      if (text != null) e.textContent = text;
      svg.appendChild(e);
      return e;
    }
    [1, n].forEach(function (p) {
      add("line", { x1: padL, y1: y(p), x2: W - padR, y2: y(p), class: "pc-grid" });
      add("text", { x: padL - 6, y: y(p) + 3.5, class: "pc-ax", "text-anchor": "end" }, String(p));
    });
    var dpath = pts.map(function (p, i) { return (i ? "L" : "M") + x(i) + " " + y(p); }).join(" ");
    add("path", { d: dpath, class: "pc-line" });
    pts.forEach(function (p, i) {
      add("circle", { cx: x(i), cy: y(p), r: i === pts.length - 1 ? 4 : 2.6,
                      class: "pc-dot" + (i === pts.length - 1 ? " pc-now" : "") });
    });
    add("text", { x: x(pts.length - 1), y: y(pts[pts.length - 1]) - 9, class: "pc-now-l",
                  "text-anchor": "end" }, ordinal(pts[pts.length - 1]));
    add("text", { x: padL, y: H - 5, class: "pc-ax" }, "R1");
    add("text", { x: W - padR, y: H - 5, class: "pc-ax", "text-anchor": "end" }, "R" + pts.length);
    return svg;
  }



  function svgEl(tag, attrs, text) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var a in attrs) {
      if (a === "style") e.style.cssText = attrs[a];
      else e.setAttribute(a, attrs[a]);
    }
    if (text != null) e.textContent = text;
    return e;
  }

  /* ----------------------------------------------------------- weather */
  /* Open-Meteo: no key, CORS open, forecast about 16 days out. If the call
     fails the strip simply never appears — the fixture still reads fine. */
  var WMO = {
    0: ["Clear", "sun"], 1: ["Mostly clear", "sun"], 2: ["Partly cloudy", "cloud"],
    3: ["Overcast", "cloud"], 45: ["Fog", "fog"], 48: ["Freezing fog", "fog"],
    51: ["Light drizzle", "rain"], 53: ["Drizzle", "rain"], 55: ["Heavy drizzle", "rain"],
    56: ["Freezing drizzle", "rain"], 57: ["Freezing drizzle", "rain"],
    61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"],
    66: ["Freezing rain", "rain"], 67: ["Freezing rain", "rain"],
    71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"],
    77: ["Snow grains", "snow"], 80: ["Showers", "rain"], 81: ["Showers", "rain"],
    82: ["Heavy showers", "rain"], 85: ["Snow showers", "snow"], 86: ["Snow showers", "snow"],
    95: ["Thunderstorms", "storm"], 96: ["Thunderstorms", "storm"], 99: ["Thunderstorms", "storm"]
  };

  function windArrow(deg) {
    var dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round((deg % 360) / 22.5) % 16];
  }

  function wxIcon(kind) {
    var g = svgEl("svg", { viewBox: "0 0 24 24", class: "wx-ico", "aria-hidden": "true" });
    function add(tag, a) { g.appendChild(svgEl(tag, a)); }
    if (kind === "sun") {
      add("circle", { cx: 12, cy: 12, r: 4.4, class: "wx-sun" });
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4;
        add("line", { x1: 12 + Math.cos(a) * 7, y1: 12 + Math.sin(a) * 7,
                      x2: 12 + Math.cos(a) * 9.2, y2: 12 + Math.sin(a) * 9.2, class: "wx-ray" });
      }
      return g;
    }
    add("path", { d: "M7 17h9a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.7 1.4A3.4 3.4 0 0 0 7 17z",
                  class: "wx-cloud" });
    if (kind === "rain") {
      [9, 13, 17].forEach(function (x, i) {
        add("line", { x1: x, y1: 19, x2: x - 1.6, y2: 22.2, class: "wx-drop",
                      style: "animation-delay:" + (i * 0.22) + "s" });
      });
    } else if (kind === "snow") {
      [9, 13, 17].forEach(function (x, i) {
        add("circle", { cx: x, cy: 20.6, r: 1.1, class: "wx-flk",
                        style: "animation-delay:" + (i * 0.25) + "s" });
      });
    } else if (kind === "storm") {
      add("path", { d: "M13 18l-3 4h2.6L11 25.5 16 20h-2.6L15 18z", class: "wx-bolt" });
    } else if (kind === "fog") {
      [19.5, 22].forEach(function (y) {
        add("line", { x1: 6, y1: y, x2: 18, y2: y, class: "wx-fog" });
      });
    }
    return g;
  }

  /* one line of weather for a fixture, appended once the forecast arrives */
  function attachWeather(host, f) {
    var v = venueInfo(f.venue);
    if (!v || v.lat == null || v.lon == null || !f.date) return;
    var kick = parseDT(f);
    var days = Math.round((kick - new Date()) / 86400000);
    if (days < 0 || days > 14) return;

    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + v.lat +
      "&longitude=" + v.lon +
      "&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability," +
      "weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m" +
      "&timezone=Europe%2FDublin&start_date=" + f.date + "&end_date=" + f.date;

    fetch(url, { mode: "cors" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (!host.isConnected) return;
        var h = d && d.hourly;
        if (!h || !h.time || !h.time.length) return;
        var want = f.date + "T" + (f.time && f.time.length === 5 ? f.time.slice(0, 3) : "15:") + "00";
        var i = h.time.indexOf(want);
        if (i < 0) i = Math.min(15, h.time.length - 1);

        var code = h.weather_code[i];
        var meta = WMO[code] || ["", "cloud"];
        var strip = el("div", "wx");
        strip.appendChild(wxIcon(meta[1]));
        var txt = el("div", "wx-txt");
        var top = el("div", "wx-top");
        top.appendChild(el("span", "wx-temp", Math.round(h.temperature_2m[i]) + "°"));
        top.appendChild(el("span", "wx-desc", meta[0]));
        txt.appendChild(top);
        var bits = [];
        var gust = Math.round(h.wind_gusts_10m[i]);
        bits.push(Math.round(h.wind_speed_10m[i]) + " km/h " + windArrow(h.wind_direction_10m[i]) +
                  (gust >= 40 ? ", gusting " + gust : ""));
        var pop = h.precipitation_probability ? h.precipitation_probability[i] : null;
        if (pop != null) bits.push(pop + "% rain");
        var feels = Math.round(h.apparent_temperature[i]);
        if (Math.abs(feels - Math.round(h.temperature_2m[i])) >= 2) bits.push("feels " + feels + "°");
        txt.appendChild(el("div", "wx-sub", bits.join(" · ")));
        strip.appendChild(txt);
        if (gust >= 55) strip.appendChild(el("span", "wx-warn", "WINDY"));
        host.appendChild(strip);
      })
      .catch(function () { /* no forecast, no strip */ });
  }

  /* ----------------------------------------------------------- history */
  function lastSeason(compId) {
    if (!H || !H.seasons || !H.seasons.length) return null;
    for (var i = H.seasons.length - 1; i >= 0; i--) {
      var found = (H.seasons[i].competitions || []).filter(function (c) { return c.id === compId; })[0];
      if (found) return { label: H.seasons[i].label, comp: found };
    }
    return null;
  }

  /* where last season's side stood after the same number of games */
  function ghostAt(compId, round) {
    var prev = lastSeason(compId);
    if (!prev || !prev.comp.progress || !prev.comp.progress.length) return null;
    var pr = prev.comp.progress;
    var upto = pr.filter(function (x) { return x.round <= round; });
    var cum = upto.length ? upto[upto.length - 1].cum : 0;
    var avail = prev.comp.available || 70;
    var finalCum = pr[pr.length - 1].cum;
    return {
      label: prev.label, comp: prev.comp,
      round: Math.min(round, pr.length), pts: cum, available: avail,
      frac: Math.min(1, cum / avail),
      finalPts: finalCum, finalFrac: Math.min(1, finalCum / avail),
      finalPos: prev.comp.final ? prev.comp.final.pos : null,
      rounds: pr.length
    };
  }

  /* ----------------------------------------------------------- Everest */
  /* Base Camp is the end of preseason. The summit is the title: every league
     point available across the season, climbed. Real Everest altitudes. */
  var EV = {
    base: 5364,
    summit: 8849,
    camps: [
      { alt: 5364, tag: "BC", name: "Base Camp",  note: "Preseason done, the league starts here" },
      { alt: 5943, tag: "C1", name: "Camp I",     note: "Through the Khumbu Icefall" },
      { alt: 6400, tag: "C2", name: "Camp II",    note: "Into the Western Cwm" },
      { alt: 7162, tag: "C3", name: "Camp III",   note: "On the Lhotse Face" },
      { alt: 7920, tag: "C4", name: "Camp IV",    note: "South Col, the death zone" },
      { alt: 8849, tag: "", name: "The Summit",  note: "League title" }
    ]
  };

  function everestState(c) {
    var me = null;
    (c.standings || []).forEach(function (r) { if (isCD(r.team)) me = r; });
    if (!me) return null;
    var teams = (c.standings || []).length || 8;
    var rounds = (teams - 1) * 2;
    var perGame = c.tryBonus !== false ? 5 : 4;
    var available = rounds * perGame;
    var pts = Math.max(0, me.pts);
    var frac = available ? Math.min(1, pts / available) : 0;
    var alt = EV.base + frac * (EV.summit - EV.base);

    var at = EV.camps[0], next = null, atIdx = 0;
    for (var i = 0; i < EV.camps.length; i++) {
      if (alt + 0.5 >= EV.camps[i].alt) { at = EV.camps[i]; atIdx = i; }
      else { next = EV.camps[i]; break; }
    }
    return {
      atIdx: atIdx,
      pts: pts, available: available, rounds: rounds, played: me.pld,
      frac: frac, alt: alt, at: at, next: next,
      climbed: Math.round(alt - EV.base),
      toGo: Math.round(EV.summit - alt)
    };
  }

  /* Remember the highest camp each viewer has seen, so a new one lands as a
     moment rather than a number that quietly changed. Per phone, per team. */
  function seenCamp(compId, idx) {
    var key = "cd-everest-" + compId;
    var prev = null;
    try {
      var raw = localStorage.getItem(key);
      if (raw !== null) prev = parseInt(raw, 10);
      localStorage.setItem(key, String(idx));
    } catch (e) { /* private window, blocked storage: no celebration, no error */ }
    return (prev !== null && !isNaN(prev) && idx > prev) ? prev : null;
  }

  var everestAnim = null;
  function stopEverest() {
    if (everestAnim) { cancelAnimationFrame(everestAnim); everestAnim = null; }
  }

  function everestCard(c) {
    var st = everestState(c);
    if (!st) return null;

    var wrap = el("div", "card everest");
    var stage = el("div", "ev-head");
    var left = el("div", "ev-stage");
    left.appendChild(el("div", "ev-stage-name", st.at.name));
    left.appendChild(el("div", "ev-stage-note", st.at.note));
    stage.appendChild(left);
    var alt = el("div", "ev-alt");
    var num = el("div", "ev-alt-n", "0");
    alt.appendChild(num);
    alt.appendChild(el("div", "ev-alt-u", "METRES"));
    stage.appendChild(alt);
    wrap.appendChild(stage);

    var W = 340, H = 250;
    var svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + H, class: "ev-svg", role: "img",
      "aria-label": "Season progress up Everest: " + Math.round(st.alt) +
                    " metres, " + st.at.name + ", " + st.pts + " of " + st.available + " league points"
    });

    var defs = svgEl("defs");
    var sky = svgEl("linearGradient", { id: "evSky", x1: "0", y1: "0", x2: "0", y2: "1" });
    sky.appendChild(svgEl("stop", { offset: "0", "stop-color": "#0E1726" }));
    sky.appendChild(svgEl("stop", { offset: "0.55", "stop-color": "#2A2435" }));
    sky.appendChild(svgEl("stop", { offset: "1", "stop-color": "#6E4733" }));
    defs.appendChild(sky);
    var rock = svgEl("linearGradient", { id: "evRock", x1: "0", y1: "0", x2: "0", y2: "1" });
    rock.appendChild(svgEl("stop", { offset: "0", "stop-color": "#4A4740" }));
    rock.appendChild(svgEl("stop", { offset: "1", "stop-color": "#17150F" }));
    defs.appendChild(rock);
    svg.appendChild(defs);

    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#evSky)" }));
    [[52, 44, 0.9], [96, 28, 0.6], [150, 52, 0.5], [214, 24, 0.8], [268, 48, 0.6], [304, 32, 0.9],
     [24, 70, 0.5], [128, 16, 0.7], [292, 70, 0.45]].forEach(function (p) {
      svg.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: 1.1, fill: "#F4F1EA",
                                        opacity: p[2], class: "ev-star" }));
    });

    svg.appendChild(svgEl("path", {
      d: "M-4 196 L40 148 L74 174 L112 132 L148 168 L188 120 L228 166 L268 128 L308 170 L344 146 L344 254 L-4 254 Z",
      fill: "#211C18", opacity: ".9"
    }));
    svg.appendChild(svgEl("path", {
      d: "M-8 254 L198 28 L258 104 L298 78 L348 254 Z", fill: "url(#evRock)"
    }));
    svg.appendChild(svgEl("path", {
      d: "M198 28 L229 62 L216 58 L205 70 L193 56 L180 68 L168 58 Z", fill: "#EDE8DE", opacity: ".93"
    }));
    svg.appendChild(svgEl("path", {
      d: "M198 28 L229 62 L223 64 L198 36 L176 62 L168 58 Z", fill: "#FFFFFF", opacity: ".35"
    }));

    var ROUTE = "M58 204 C 84 180 96 166 118 142 " +
                "C 136 122 148 106 162 86 C 174 68 182 50 198 28";
    svg.appendChild(svgEl("path", { d: ROUTE, class: "ev-route-bg" }));
    var route = svgEl("path", { d: ROUTE, class: "ev-route" });
    svg.appendChild(route);

    /* summit flag */
    var flag = svgEl("g", { class: "ev-flag" });
    flag.appendChild(svgEl("line", { x1: 198, y1: 28, x2: 198, y2: 8, class: "ev-pole" }));
    flag.appendChild(svgEl("path", { d: "M198 9 L217 14 L198 20 Z", class: "ev-flagcloth" }));
    svg.appendChild(flag);

    /* camps, placed along the route at their share of the climb */
    var campDots = [];
    EV.camps.forEach(function (cp) {
      var f = (cp.alt - EV.base) / (EV.summit - EV.base);
      var g = svgEl("g", { class: "ev-camp", "data-f": f });
      g.appendChild(svgEl("circle", { r: 3.4, class: "ev-camp-ring" }));
      if (cp.tag) g.appendChild(svgEl("text", { class: "ev-camp-t", x: -8, y: 3.5,
                                                "text-anchor": "end" }, cp.tag));
      svg.appendChild(g);
      campDots.push(g);
    });

    /* last season over the same ground, for pace rather than decoration */
    var gh = ghostAt(c.id, st.played);
    var ghostEls = null;
    if (gh) {
      var gRoute = svgEl("path", { d: ROUTE, class: "ev-ghost-route" });
      svg.appendChild(gRoute);
      var gFinal = svgEl("g", { class: "ev-ghost-final" });
      gFinal.appendChild(svgEl("line", { x1: -7, y1: 0, x2: 7, y2: 0, class: "ev-ghost-tick" }));
      svg.appendChild(gFinal);
      var gMark = svgEl("g", { class: "ev-ghost" });
      gMark.appendChild(svgEl("circle", { r: 4.6, class: "ev-ghost-dot" }));
      svg.appendChild(gMark);
      ghostEls = { route: gRoute, mark: gMark, final: gFinal };
    }

    var climber = svgEl("g", { class: "ev-climber" });
    climber.appendChild(svgEl("circle", { r: 9, class: "ev-halo" }));
    climber.appendChild(svgEl("circle", { r: 3.6, class: "ev-dot" }));
    var burst = svgEl("g", { class: "ev-burst" });
    for (var bi = 0; bi < 14; bi++) {
      var ang = bi * (Math.PI * 2 / 14);
      var spark = svgEl("circle", { r: 1.7, cx: 0, cy: 0, class: "ev-spark" });
      spark.style.setProperty("--dx", (Math.cos(ang) * 26).toFixed(1) + "px");
      spark.style.setProperty("--dy", (Math.sin(ang) * 26).toFixed(1) + "px");
      spark.style.animationDelay = (bi * 0.012) + "s";
      burst.appendChild(spark);
    }
    climber.appendChild(burst);
    svg.appendChild(climber);

    var snow = svgEl("g", { class: "ev-snow" });
    for (var i = 0; i < 18; i++) {
      var fl = svgEl("circle", { cx: (i * 37 % W), cy: -4, r: 0.7 + (i % 3) * 0.45, class: "ev-flake" });
      fl.style.animationDuration = (7 + (i % 5) * 2.4) + "s";
      fl.style.animationDelay = (-(i * 1.37) % 9) + "s";
      fl.style.setProperty("--sway", ((i % 4) * 7 - 10) + "px");
      snow.appendChild(fl);
    }
    svg.appendChild(snow);
    wrap.appendChild(svg);

    var foot = el("div", "ev-foot");
    var bar = el("div", "ev-bar");
    var fill = el("div", "ev-bar-fill");
    bar.appendChild(fill);
    EV.camps.forEach(function (cp) {
      var t = el("span", "ev-bar-tick");
      t.style.left = ((cp.alt - EV.base) / (EV.summit - EV.base) * 100) + "%";
      bar.appendChild(t);
    });
    foot.appendChild(bar);
    var line = el("div", "ev-line");
    line.appendChild(el("span", "ev-strong", st.pts + " of " + st.available));
    line.appendChild(el("span", null, " league points climbed · round " + st.played +
      " of " + st.rounds + " · " + st.toGo.toLocaleString() + " m to the summit"));
    foot.appendChild(line);
    if (st.next) {
      foot.appendChild(el("div", "ev-next",
        "Next: " + st.next.name + " at " + st.next.alt.toLocaleString() + " m — " +
        Math.ceil((st.next.alt - st.alt) / (EV.summit - EV.base) * st.available) + " more points"));
    }
    if (gh) {
      var gAlt = EV.base + gh.frac * (EV.summit - EV.base);
      var diff = Math.round(st.alt - gAlt);
      var grow = el("div", "ev-ghost-line");
      grow.appendChild(el("span", "ev-ghost-key"));
      var word = diff > 0 ? "ahead of them" : (diff < 0 ? "behind them" : "level");
      var txt = gh.label + " at this stage: " + Math.round(gAlt).toLocaleString() + " m on " +
                gh.pts + " points \u00b7 ";
      txt += diff === 0 ? "level" : (Math.abs(diff).toLocaleString() + " m " + word);
      grow.appendChild(el("span", null, txt));
      foot.appendChild(grow);
      foot.appendChild(el("div", "ev-ghost-sub",
        "They finished " + (gh.finalPos ? ordinal(gh.finalPos) + " on " : "on ") + gh.finalPts +
        " points, the dash further up the route."));
    }
    wrap.appendChild(foot);

    /* --- the climb, animated once the card is on screen --- */
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var len = 0;
    function place(el2, f) {
      var pt = route.getPointAtLength(len * Math.max(0, Math.min(1, f)));
      el2.setAttribute("transform", "translate(" + pt.x + "," + pt.y + ")");
    }
    function paint(f) {
      var shown = EV.base + f * (EV.summit - EV.base);
      num.textContent = Math.round(shown).toLocaleString();
      place(climber, f);
      if (ghostEls) {
        var gf = gh.frac * (st.frac ? Math.min(1, f / st.frac) : 1);
        place(ghostEls.mark, gf);
        place(ghostEls.final, gh.finalFrac);
        ghostEls.route.style.strokeDasharray = len;
        ghostEls.route.style.strokeDashoffset = len * (1 - gf);
      }
      fill.style.width = (f * 100) + "%";
      route.style.strokeDasharray = len;
      route.style.strokeDashoffset = len * (1 - f);
      campDots.forEach(function (g) {
        g.classList.toggle("reached", parseFloat(g.getAttribute("data-f")) <= f + 0.001);
      });
    }

    var fromIdx = seenCamp(c.id, st.atIdx);
    function celebrate() {
      if (fromIdx === null) return;
      var reached = campDots[st.atIdx];
      if (reached) reached.classList.add("flare");
      wrap.classList.add("ev-party");
      var banner = el("div", "ev-banner",
        (st.at.name === "The Summit" ? "SUMMIT" : st.at.name.toUpperCase()) + " REACHED");
      wrap.appendChild(banner);
      requestAnimationFrame(function () { banner.classList.add("in"); });
      setTimeout(function () {
        banner.classList.remove("in");
        setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 600);
      }, 4200);
    }

    requestAnimationFrame(function () {
      try { len = route.getTotalLength(); } catch (e) { len = 300; }
      campDots.forEach(function (g) { place(g, parseFloat(g.getAttribute("data-f"))); });
      if (reduce) { paint(st.frac); celebrate(); return; }
      var t0 = null, dur = 2200;
      stopEverest();
      (function step(t) {
        if (t0 === null) t0 = t;
        var k = Math.min(1, (t - t0) / dur);
        var eased = 1 - Math.pow(1 - k, 3);
        paint(st.frac * eased);
        if (k < 1) everestAnim = requestAnimationFrame(step);
        else { everestAnim = null; celebrate(); }
      })(performance.now());
    });

    return wrap;
  }

  /* ================================================================ TABLES */
  var tableTeam = "1st";
  function viewTables() {
    var root = el("div", "view");
    var ls = leagues();
    root.appendChild(seg(ls.map(function (c) { return [c.team, teamLabelFor(c.team)]; }), tableTeam,
      function (v) { tableTeam = v; render(); }));
    var c = ls.filter(function (x) { return x.team === tableTeam; })[0];
    if (!c) return root;
    root.appendChild(el("div", "label", c.name.toUpperCase()));

    if (!c.standings || !c.standings.length) {
      var none = el("div", "card");
      var msg = el("div", "comp-row");
      var b = el("div", "comp-body");
      b.appendChild(el("div", "comp-title", "Table not available right now"));
      b.appendChild(el("div", "comp-meta", "The last read of the league feed did not include a table. Fixtures and results are unaffected."));
      msg.appendChild(b);
      none.appendChild(msg);
      root.appendChild(none);
      return root;
    }

    var tb = c.tryBonus !== false;
    var n = c.standings.length;
    var tbl = el("div", "card table");
    var head = el("div", "trow thead");
    ["", "#", "TEAM", "P", "W", "D", "L", "TB", "LB", "PTS"].forEach(function (h, i) {
      head.appendChild(el("div", "tc tc" + i, h));
    });
    tbl.appendChild(head);

    c.standings.forEach(function (r) {
      var row = el("div", "trow" + (isCD(r.team) ? " ours" : ""));
      var z = zoneOf(r.pos, n, c.zones);
      var mk = el("div", "tc tc0");
      if (z) mk.classList.add("mk-" + z);
      row.appendChild(mk);
      row.appendChild(el("div", "tc tc1", String(r.pos)));
      var name = el("div", "tc tc2");
      name.appendChild(nameNode(r.team, "tname"));
      var sub = el("div", "tsub");
      sub.appendChild(el("span", null,
        r.pld ? (r.pf + "–" + r.pa + " · " + (r.diff > 0 ? "+" : "") + r.diff) : "no games played"));
      sub.appendChild(formStrip(c.id, r.team, 5));
      name.appendChild(sub);
      row.appendChild(name);
      [r.pld, r.w, r.d, r.l].forEach(function (v, i) {
        row.appendChild(el("div", "tc tc" + (i + 3), String(v == null ? 0 : v)));
      });
      row.appendChild(el("div", "tc tc7" + (tb ? "" : " na"), tb ? String(tryBonusOf(r)) : "–"));
      row.appendChild(el("div", "tc tc8", String(r.bpl == null ? 0 : r.bpl)));
      row.appendChild(el("div", "tc tc9 pts", String(r.pts)));
      tbl.appendChild(row);
    });
    root.appendChild(tbl);

    var z0 = c.zones || {};
    var hasZones = (z0.autoUp || z0.playoffUp || z0.playoffDown || z0.autoDown);
    var notes = el("div", "notes");
    if (hasZones) {
      var key = el("div", "zkey");
      ["up", "po-up", "po-down", "down"].forEach(function (z) {
        var it = el("div", "zkey-item");
        it.appendChild(el("span", "zdot mk-" + z));
        it.appendChild(el("span", null, ZONE_TEXT[z]));
        key.appendChild(it);
      });
      root.appendChild(key);
      notes.appendChild(el("p", null,
        "Top team is promoted. 2nd plays off against the second-last team in the division above. " +
        "Bottom team is relegated. Second-last plays off against the 2nd team in the division below."));
    }
    var chart = positionChart(c.id, teamLabelFor(c.team));
    if (chart) {
      root.appendChild(el("div", "label", "OUR POSITION BY ROUND"));
      var cc = el("div", "card chartcard");
      cc.appendChild(chart);
      root.appendChild(cc);
    }
    var ev = everestCard(c);
    if (ev) {
      root.appendChild(el("div", "label", "THE EVEREST JOURNEY"));
      root.appendChild(ev);
    }
    if (c.note) notes.appendChild(el("p", "note-strong", c.note));
    notes.appendChild(el("p", null,
      "TB try bonus: 4 or more tries in a game. LB losing bonus: lost by 7 points or fewer. " +
      (tb ? "Together they make the bonus points total Sportlomo shows as BP."
          : "This competition does not award a try bonus.")));
    if (c.standingsSource === "computed") {
      notes.appendChild(el("p", null, "Calculated from results, so it will not show a points deduction or an awarded game."));
    }
    root.appendChild(notes);
    return root;
  }

  /* ----------------------------------------------------------- share card */
  function shareCard(f) {
    var ourHome = isCD(f.home);
    var W = 1080, H = 1080;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var g = cv.getContext("2d");

    g.fillStyle = "#141210"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(212,165,60,.5)"; g.lineWidth = 6;
    g.strokeRect(34, 34, W - 68, H - 68);

    function draw() {
      g.textAlign = "center";
      g.fillStyle = "#D4A53C";
      g.font = "700 30px Oswald, system-ui, sans-serif";
      var c = comp(f.comp);
      g.fillText((c.short || "").toUpperCase() + "  \u00b7  " + fmtDay(parseDT(f)).toUpperCase(), W / 2, 300);

      var hs = f.homeScore, as = f.awayScore;
      var rows = [[f.home, hs], [f.away, as]];
      var yy = 440;
      rows.forEach(function (r) {
        var win = hs != null && as != null && hs !== as && r[1] === Math.max(hs, as);
        g.textAlign = "left";
        g.fillStyle = win ? "#FFFFFF" : "#A8A092";
        g.font = (win ? "700 " : "500 ") + "52px 'Source Sans 3', system-ui, sans-serif";
        g.fillText(r[0], 120, yy);
        g.textAlign = "right";
        g.fillStyle = win ? "#D4A53C" : "#7A766D";
        g.font = "600 96px Oswald, system-ui, sans-serif";
        g.fillText(r[1] == null ? "\u2013" : String(r[1]), W - 120, yy + 14);
        yy += 150;
      });

      g.strokeStyle = "rgba(212,165,60,.28)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(120, 690); g.lineTo(W - 120, 690); g.stroke();

      g.textAlign = "center";
      g.fillStyle = "#A8A092";
      g.font = "400 34px 'Source Sans 3', system-ui, sans-serif";
      g.fillText(venueInfo(f.venue).club ? f.venue : f.venue, W / 2, 760);
      g.fillStyle = "#D4A53C";
      g.font = "500 26px Oswald, system-ui, sans-serif";
      g.fillText("CILL DARA RFC", W / 2, 980);
      return cv;
    }

    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        g.drawImage(img, W / 2 - 90, 80, 180, 180);
        resolve(draw());
      };
      img.onerror = function () { resolve(draw()); };
      img.src = "crest-192.png";
    });
  }

  function shareButton(f) {
    var b = el("button", "sharebtn");
    b.type = "button";
    b.innerHTML = "";
    b.appendChild(el("span", "sh-ico", "\u21AA"));
    b.appendChild(el("span", null, "Share"));
    b.onclick = function () {
      b.disabled = true;
      shareCard(f).then(function (cv) {
        cv.toBlob(function (blob) {
          b.disabled = false;
          if (!blob) return;
          var name = "cill-dara-" + (f.date || "result") + ".png";
          var file = new File([blob], name, { type: "image/png" });
          var text = f.home + " " + f.homeScore + " \u2013 " + f.awayScore + " " + f.away;
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], text: text }).catch(function () {});
          } else {
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          }
        }, "image/png");
      });
    };
    return b;
  }

  /* ================================================================ SHELL */
  var tab = "matchday";
  var TABS = [["matchday", "Matchday"], ["fixtures", "Fixtures"], ["results", "Results"], ["tables", "Tables"]];
  var ticker = null;

  function go(t) {
    tab = t;
    if (history.replaceState) history.replaceState(null, "", "#" + t);
    render();
  }

  function render() {
    var main = $("#main");
    stopEverest();
    main.innerHTML = "";
    var v = tab === "fixtures" ? viewFixtures()
          : tab === "results" ? viewResults()
          : tab === "tables" ? viewTables()
          : viewMatchday();
    main.appendChild(v);
    main.appendChild(footer());
    Array.prototype.forEach.call(document.querySelectorAll(".navbtn"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-tab") === tab);
    });
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    startTicker();
  }

  function startTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    var box = document.getElementById("countdown");
    if (!box) return;
    var target = new Date(box.getAttribute("data-target"));
    var nums = box.querySelectorAll(".cd-n");
    var live = box.querySelector(".cd-live");
    function tick() {
      var ms = target - new Date();
      if (ms <= 0) {
        box.classList.add("is-live");
        live.textContent = ms > -2 * 3600000 ? "Kicking off now" : "Under way";
        return;
      }
      var s = Math.floor(ms / 1000);
      var v = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60];
      for (var i = 0; i < 4; i++) nums[i].textContent = i === 0 ? String(v[0]) : ("0" + v[i]).slice(-2);
    }
    tick();
    ticker = setInterval(tick, 1000);
  }

  function footer() {
    var f = el("footer", "footer");
    f.id = "calendar";
    f.appendChild(el("div", "label", "SUBSCRIBE TO THE FIXTURES"));
    var card = el("div", "card");
    [["cill-dara-all.ics", "Everything", "Both teams, league and cups"],
     ["cill-dara-1st.ics", teamLabelFor("1st"), "League and cup fixtures"],
     ["cill-dara-2nd.ics", teamLabelFor("2nd"), "Seconds league fixtures"]].forEach(function (c, i) {
      var a = el("a", "stand-row" + (i ? " sep" : ""));
      a.href = c[0];
      var body = el("div", "stand-body");
      body.appendChild(el("div", "stand-title", c[1]));
      body.appendChild(el("div", "stand-meta", c[2]));
      a.appendChild(body);
      a.appendChild(el("div", "chev", "↓"));
      card.appendChild(a);
    });
    f.appendChild(card);
    f.appendChild(el("div", "stamp", "Source: Leinster Rugby fixtures feed · last read " +
      new Date(D.updated).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })));
    var credit = el("div", "credit");
    credit.appendChild(el("span", "credit-rule"));
    credit.appendChild(el("span", "credit-text", "Created by Aaron Kane"));
    credit.appendChild(el("span", "credit-rule"));
    f.appendChild(credit);
    return f;
  }

  /* data.json older than two days usually means the phone is offline */
  function flagStale(d) {
    var age = (Date.now() - new Date(d.updated)) / 86400000;
    if (age < 2) return;
    var bar = el("div", "stalebar",
      "Showing saved fixtures from " + new Date(d.updated).toLocaleDateString("en-IE", { dateStyle: "medium" }) +
      ". Reconnect for the latest.");
    document.body.insertBefore(bar, document.getElementById("main"));
  }

  /* light, dark, or whatever the phone is set to */
  function initTheme() {
    var btn = $("#theme");
    if (!btn) return;
    function current() {
      var set = document.documentElement.getAttribute("data-theme");
      if (set) return set;
      return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark" : "light";
    }
    function apply(t) {
      document.documentElement.setAttribute("data-theme", t);
      try { localStorage.setItem("cd-theme", t); } catch (e) { /* private window */ }
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#141210");
    }
    btn.onclick = function () { apply(current() === "dark" ? "light" : "dark"); };
  }

  function boot(data) {
    D = data;
    initTheme();
    $("#clubname").textContent = D.club.name;
    if (D.club.tagline) $("#tagline").textContent = D.club.tagline;
    var fines = $("#fines");
    if (D.links && D.links.fines) fines.href = D.links.fines;
    else fines.style.display = "none";
    var nav = $("#nav");
    TABS.forEach(function (t) {
      var b = el("button", "navbtn", t[1]);
      b.type = "button";
      b.setAttribute("data-tab", t[0]);
      b.onclick = function () { go(t[0]); };
      nav.appendChild(b);
    });
    var h = (location.hash || "").replace("#", "");
    if (h === "next") h = "matchday";
    if (TABS.some(function (t) { return t[0] === h; })) tab = h;
    render();
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  if (window.__DATA__) boot(window.__DATA__);
  else {
    /* history is a bonus: if it is missing the app behaves exactly as before */
    Promise.all([
      fetch("data.json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
      fetch("history.json", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
    ]).then(function (both) {
      H = both[1];
      boot(both[0]);
      flagStale(both[0]);
    }).catch(function (e) {
      $("#main").innerHTML = '<p class="empty">Could not load the fixtures (' + e.message + ').</p>';
    });
  }
})();
