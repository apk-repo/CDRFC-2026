/* League Hub — Cill Dara RFC. Renders from data.json (or window.__DATA__). */
(function () {
  "use strict";

  var D = null;

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
      hero.appendChild(el("div", "hero-sub", fmtLongDay(d) + (oneVenue ? " · " + first.venue : "")));

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
      dir.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(first.venue + ", Ireland");
      dir.target = "_blank"; dir.rel = "noopener";
      acts.appendChild(dir);
      hero.appendChild(acts);
      root.appendChild(hero);
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
    }
    return root;
  }

  function resultCard(f) {
    var ourHome = isCD(f.home);
    var c = comp(f.comp);
    var card = el("article", "rcard");
    var mp = f.status === "played" ? matchPoints(f, ourHome) : null;
    var state = f.status === "called-off" ? "off" : (mp ? mp.res.toLowerCase() : "d");
    card.classList.add("rc-" + state);

    var head = el("div", "rc-head");
    head.appendChild(el("span", "rc-badge",
      state === "off" ? "OFF" : state === "w" ? "WON" : state === "l" ? "LOST" : "DRAW"));
    var ht = el("div", "rc-title");
    ht.appendChild(el("div", "rc-team", teamLabelFor(f.team)));
    ht.appendChild(el("div", "rc-meta", c.short + " · " + fmtDay(parseDT(f)) + " · " + f.venue));
    head.appendChild(ht);
    card.appendChild(head);

    var body = el("div", "rc-body");
    if (f.status === "called-off") {
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
      return f.comp === c.id && f.date && (f.status === "played" || f.status === "called-off");
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
        if (f.status === "called-off") {
          var t = el("div", "res-title muted");
          t.appendChild(el("span", "nw", f.home));
          t.appendChild(document.createTextNode(" v "));
          t.appendChild(el("span", "nw", f.away));
          body.appendChild(t);
          body.appendChild(el("div", "res-meta", fmtDay(parseDT(f)) + " · called off"));
        } else {
          body.appendChild(scoreline(f));
          body.appendChild(el("div", "res-meta", fmtDay(parseDT(f)) + " · " + f.venue));
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
      name.appendChild(el("div", "tsub", r.pld ? (r.pf + "–" + r.pa + " · " + (r.diff > 0 ? "+" : "") + r.diff) : "no games played"));
      row.appendChild(name);
      [r.pld, r.w, r.d, r.l].forEach(function (v, i) {
        row.appendChild(el("div", "tc tc" + (i + 3), String(v == null ? 0 : v)));
      });
      row.appendChild(el("div", "tc tc7" + (tb ? "" : " na"), tb ? String(r.bp == null ? 0 : r.bp) : "–"));
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
    if (c.note) notes.appendChild(el("p", "note-strong", c.note));
    notes.appendChild(el("p", null,
      "TB try bonus: 4 or more tries in a game. LB losing bonus: lost by 7 points or fewer." +
      (tb ? "" : " This competition does not award a try bonus.")));
    if (c.standingsSource === "computed") {
      notes.appendChild(el("p", null, "Calculated from results, so it will not show a points deduction or an awarded game."));
    }
    root.appendChild(notes);
    return root;
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

  function boot(data) {
    D = data;
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

  if (window.__DATA__) boot(window.__DATA__);
  else {
    fetch("data.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(boot)
      .catch(function (e) {
        $("#main").innerHTML = '<p class="empty">Could not load the fixtures (' + e.message + ').</p>';
      });
  }
})();
