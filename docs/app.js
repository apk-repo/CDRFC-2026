/* League Hub — Cill Dara RFC. Renders from data.json (or window.__DATA__). */
(function () {
  "use strict";

  var TODAY = new Date();
  var D = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function comp(id) { return D.competitions.filter(function (c) { return c.id === id; })[0]; }
  function isCD(name) { return /^Cill Dara/.test(name); }

  function parseDT(f) {
    var t = (f.time && /^\d{2}:\d{2}$/.test(f.time)) ? f.time : "12:00";
    return new Date(f.date + "T" + t + ":00");
  }
  var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtDay(d) { return DAYS[d.getDay()] + " " + d.getDate() + " " + MONS[d.getMonth()]; }
  function fmtLongDay(d) {
    var full = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return full[d.getDay()] + " " + d.getDate() + " " + MONS[d.getMonth()];
  }
  function daysAway(d) {
    var a = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
    var b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((b - a) / 86400000);
  }
  function awayLabel(n) {
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n < 0) return Math.abs(n) + " days ago";
    if (n < 14) return "In " + n + " days";
    return "In " + Math.round(n / 7) + " weeks";
  }

  /* ---- scoreline: name left, score in its own right-hand column ---- */
  function scoreline(f) {
    var wrap = el("div", "score");
    var hs = f.homeScore, as = f.awayScore;
    [{ name: f.home, score: hs, tries: f.homeTries },
     { name: f.away, score: as, tries: f.awayTries }].forEach(function (s) {
      var won = hs != null && as != null && hs !== as && s.score === Math.max(hs, as);
      var row = el("div", "score-row" + (won ? " won" : ""));
      var nm = el("div", "score-name", s.name);
      if (isCD(s.name)) nm.classList.add("ours");
      row.appendChild(nm);
      row.appendChild(el("div", "score-tries", s.tries != null ? s.tries + "t" : ""));
      row.appendChild(el("div", "score-num", s.score == null ? "\u2013" : String(s.score)));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function resultBadge(f) {
    if (f.status === "called-off") return el("span", "badge badge-off", "OFF");
    if (f.homeScore == null) return null;
    var ourHome = isCD(f.home);
    var us = ourHome ? f.homeScore : f.awayScore;
    var them = ourHome ? f.awayScore : f.homeScore;
    if (us > them) return el("span", "badge badge-w", "W");
    if (us < them) return el("span", "badge badge-l", "L");
    return el("span", "badge badge-d", "D");
  }

  function ourFixtures() {
    return D.fixtures.filter(function (f) { return isCD(f.home) || isCD(f.away); });
  }
  function upcoming() {
    return ourFixtures().filter(function (f) {
      return f.status === "scheduled" && parseDT(f) >= new Date(TODAY.getTime() - 3 * 3600000);
    }).sort(function (a, b) { return parseDT(a) - parseDT(b); });
  }
  function past() {
    return ourFixtures().filter(function (f) {
      return f.status !== "scheduled" || parseDT(f) < TODAY;
    }).sort(function (a, b) { return parseDT(b) - parseDT(a); });
  }

  /* group consecutive fixtures that share a calendar date */
  function byDay(list) {
    var out = [], cur = null;
    list.forEach(function (f) {
      if (!cur || cur.date !== f.date) { cur = { date: f.date, items: [] }; out.push(cur); }
      cur.items.push(f);
    });
    return out;
  }

  /* ================= Next ================= */
  function viewNext() {
    var root = el("div", "view");
    var next = upcoming();
    if (!next.length) { root.appendChild(el("p", "empty", "No fixtures left in the feed.")); return root; }

    var day = byDay(next)[0];
    var d = parseDT(day.items[0]);
    var venues = {};
    day.items.forEach(function (f) { venues[f.venue] = 1; });
    var oneVenue = Object.keys(venues).length === 1;
    var first = day.items[0];
    var homeDay = isCD(first.home);

    var hero = el("div", "hero");
    var top = el("div", "hero-top");
    top.appendChild(el("div", "eyebrow", day.items.length > 1 ? "NEXT CLUB DAY" : "NEXT FIXTURE"));
    top.appendChild(el("span", "chip", awayLabel(daysAway(d))));
    hero.appendChild(top);
    hero.appendChild(el("h2", "hero-title",
      fmtDay(d) + " · " + (homeDay ? "home to " : "away to ") +
      (isCD(first.home) ? first.away : first.home).replace(/ \d(st|nd|rd|th) XV$/, "")));
    if (oneVenue) hero.appendChild(el("div", "hero-sub", first.venue + (day.items.length > 1 ? " · both teams, one trip" : "")));

    day.items.forEach(function (f) {
      var row = el("div", "hero-row" + (f.team === "1st" ? " accent" : ""));
      row.appendChild(el("div", "hero-time", f.time));
      var body = el("div", "hero-body");
      var teamLabel = f.team === "1st" ? "Cill Dara 1st XV" : "Cill Dara 2nd XV";
      var opp = isCD(f.home) ? f.away : f.home;
      body.appendChild(el("div", "hero-match", teamLabel + " v " + opp));
      var meta = [comp(f.comp).short];
      if (f.round && comp(f.comp).type === "cup") meta.push(f.round);
      meta.push(f.referee ? "Ref " + f.referee : "Ref TBC");
      if (!oneVenue) meta.unshift(f.venue);
      body.appendChild(el("div", "hero-meta", meta.join(" · ")));
      row.appendChild(body);
      hero.appendChild(row);
    });

    var acts = el("div", "hero-actions");
    var cal = el("a", "btn btn-primary", "Add to calendar");
    cal.href = "#calendar";
    acts.appendChild(cal);
    var dir = el("a", "btn btn-ghost", "Directions");
    dir.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(first.venue + ", Ireland");
    dir.target = "_blank"; dir.rel = "noopener";
    acts.appendChild(dir);
    hero.appendChild(acts);
    root.appendChild(hero);

    /* last time out */
    var recent = past().slice(0, 2);
    if (recent.length) {
      root.appendChild(el("div", "label", "LAST TIME OUT"));
      var card = el("div", "card");
      recent.forEach(function (f, i) {
        var row = el("div", "res-row" + (i ? " sep" : ""));
        var b = resultBadge(f);
        if (b) row.appendChild(b);
        var body = el("div", "res-body");
        if (f.status === "called-off") {
          body.appendChild(el("div", "res-title",
            (f.team === "1st" ? "Cill Dara 1st XV" : "Cill Dara 2nd XV") + " v " + (isCD(f.home) ? f.away : f.home)));
          body.appendChild(el("div", "res-meta", "Called off · not yet refixed"));
        } else {
          body.appendChild(scoreline(f));
          body.appendChild(el("div", "res-meta", fmtDay(parseDT(f)) + " · " + f.venue + " · " + comp(f.comp).short));
        }
        row.appendChild(body);
        card.appendChild(row);
      });
      root.appendChild(card);
    }

    /* standings snapshot */
    root.appendChild(el("div", "label", "STANDINGS"));
    var sc = el("div", "card");
    D.competitions.filter(function (c) { return c.type === "league"; }).forEach(function (c, i) {
      var pos = 0, row0 = null;
      c.standings.forEach(function (r) { if (isCD(r.team)) { pos = r.pos; row0 = r; } });
      var a = el("a", "stand-row" + (i ? " sep" : ""));
      a.href = "#tables";
      a.appendChild(el("div", "stand-pos", ordinal(pos)));
      var body = el("div", "stand-body");
      body.appendChild(el("div", "stand-title", teamLabelFor(c.team) + " · " + c.short));
      body.appendChild(el("div", "stand-meta", row0 ? (row0.pts + " pts from " + row0.pld) : "–"));
      a.appendChild(body);
      a.appendChild(el("div", "chev", "›"));
      sc.appendChild(a);
    });
    root.appendChild(sc);
    return root;
  }

  function ordinal(n) {
    if (!n) return "–";
    var s = ["th","st","nd","rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function teamLabelFor(id) { return id === "1st" ? "Cill Dara 1st XV" : "Cill Dara 2nd XV"; }

  /* ================= Tables ================= */
  var tableTeam = "1st";
  function viewTables() {
    var root = el("div", "view");
    var leagues = D.competitions.filter(function (c) { return c.type === "league"; });
    var seg = el("div", "seg");
    leagues.forEach(function (c) {
      var b = el("button", "seg-btn" + (c.team === tableTeam ? " on" : ""), teamLabelFor(c.team));
      b.type = "button";
      b.onclick = function () { tableTeam = c.team; render(); };
      seg.appendChild(b);
    });
    root.appendChild(seg);

    var c = leagues.filter(function (x) { return x.team === tableTeam; })[0];
    root.appendChild(el("div", "label", c.name.toUpperCase()));

    var hasBP = c.standings.some(function (r) { return r.bp != null; });
    var head = el("div", "trow thead");
    ["", "#", "TEAM", "P", "W", "D", "L", hasBP ? "BP" : "BPL", "PTS"].forEach(function (h, i) {
      head.appendChild(el("div", "tc tc" + i, h));
    });
    var tbl = el("div", "card table");
    tbl.appendChild(head);

    c.standings.forEach(function (r) {
      var row = el("div", "trow" + (isCD(r.team) ? " ours" : ""));
      var mk = el("div", "tc tc0");
      if (r.pos <= c.promotion) mk.classList.add("mk-up");
      if (r.pos > c.standings.length - c.relegation) mk.classList.add("mk-down");
      row.appendChild(mk);
      row.appendChild(el("div", "tc tc1", String(r.pos)));
      var name = el("div", "tc tc2");
      name.appendChild(el("div", "tname", r.team));
      name.appendChild(el("div", "tsub", r.pld ? (r.pf + " for · " + r.pa + " against · " + (r.diff > 0 ? "+" : "") + r.diff) : "no games played"));
      row.appendChild(name);
      [r.pld, r.w, r.d, r.l, (hasBP ? r.bp : r.bpl)].forEach(function (v, i) {
        row.appendChild(el("div", "tc tc" + (i + 3), String(v == null ? 0 : v)));
      });
      row.appendChild(el("div", "tc tc8 pts", String(r.pts)));
      tbl.appendChild(row);
    });
    root.appendChild(tbl);

    var key = el("div", "key");
    var k1 = el("div", "key-item"); k1.appendChild(el("span", "dot up")); k1.appendChild(el("span", null, "Promotion"));
    var k2 = el("div", "key-item"); k2.appendChild(el("span", "dot down")); k2.appendChild(el("span", null, "Relegation"));
    key.appendChild(k1); key.appendChild(k2);
    root.appendChild(key);
    return root;
  }

  /* ================= Fixtures ================= */
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

    function keep(f) {
      if (fixFilter === "all") return true;
      if (fixFilter === "cup") return comp(f.comp).type === "cup";
      return f.team === fixFilter;
    }

    var up = upcoming().filter(keep);
    byDay(up).forEach(function (g) {
      var d = parseDT(g.items[0]);
      var venues = {}; g.items.forEach(function (f) { venues[f.venue] = 1; });
      var vs = Object.keys(venues);
      var head = fmtLongDay(d).toUpperCase();
      if (vs.length === 1) head += " · " + vs[0].toUpperCase();
      root.appendChild(dayLabel(head));
      var card = el("div", "card");
      g.items.forEach(function (f, i) { card.appendChild(fixRow(f, i > 0, vs.length > 1)); });
      root.appendChild(card);
    });

    var pastList = past().filter(keep);
    if (pastList.length) {
      root.appendChild(dayLabel("PLAYED"));
      var pc = el("div", "card");
      pastList.forEach(function (f, i) {
        var row = el("div", "res-row" + (i ? " sep" : ""));
        var b = resultBadge(f);
        if (b) row.appendChild(b);
        var body = el("div", "res-body");
        if (f.status === "called-off") {
          body.appendChild(el("div", "res-title", teamLabelFor(f.team) + " v " + (isCD(f.home) ? f.away : f.home)));
          body.appendChild(el("div", "res-meta", fmtDay(parseDT(f)) + " · called off · not yet refixed"));
        } else {
          body.appendChild(scoreline(f));
          body.appendChild(el("div", "res-meta", fmtDay(parseDT(f)) + " · " + f.venue + " · " + comp(f.comp).short + (f.round ? " · " + f.round : "")));
        }
        row.appendChild(body);
        pc.appendChild(row);
      });
      root.appendChild(pc);
    }
    return root;
  }

  function dayLabel(text) {
    var w = el("div", "daylabel");
    w.appendChild(el("span", null, text));
    w.appendChild(el("span", "rule"));
    return w;
  }

  function fixRow(f, sep, showVenue) {
    var row = el("div", "fx" + (sep ? " sep" : "") + (f.team === "1st" ? " accent" : ""));
    row.appendChild(el("div", "fx-time", f.time || "TBC"));
    var body = el("div", "fx-body");
    body.appendChild(el("div", "fx-match", f.home + " v " + f.away));
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

  /* ================= Cups ================= */
  function viewCups() {
    var root = el("div", "view");
    root.appendChild(el("div", "label", "RUNNING NOW"));
    var live = el("div", "card");
    D.competitions.filter(function (c) { return c.status !== "not-drawn"; }).forEach(function (c, i) {
      var row = el("div", "comp-row" + (i ? " sep" : ""));
      var body = el("div", "comp-body");
      body.appendChild(el("div", "comp-title", c.name));
      body.appendChild(el("div", "comp-meta", compSummary(c)));
      row.appendChild(body);
      row.appendChild(el("span", "tag tag-" + c.team, c.team === "1st" ? "1ST XV" : "2ND XV"));
      live.appendChild(row);
    });
    root.appendChild(live);

    var cupComp = D.competitions.filter(function (c) { return c.type === "cup" && c.status === "live"; })[0];
    if (cupComp) {
      root.appendChild(el("div", "label", cupComp.name.toUpperCase() + " · OUR RUN"));
      var card = el("div", "card");
      D.fixtures.filter(function (f) { return f.comp === cupComp.id; })
        .sort(function (a, b) { return parseDT(a) - parseDT(b); })
        .forEach(function (f, i) {
          var mine = isCD(f.home) || isCD(f.away);
          var row = el("div", "res-row" + (i ? " sep" : "") + (mine ? "" : " dim"));
          var b = mine ? resultBadge(f) : null;
          if (b) row.appendChild(b);
          var body = el("div", "res-body");
          body.appendChild(el("div", "round", (f.round || "").toUpperCase() + (mine ? "" : " · other side of the draw")));
          if (f.homeScore != null) body.appendChild(scoreline(f));
          else body.appendChild(el("div", "res-title", f.home + " v " + f.away));
          body.appendChild(el("div", "res-meta", fmtDay(parseDT(f)) + " · " + f.time + " · " + f.venue + (f.referee ? " · " + f.referee : " · ref TBC")));
          row.appendChild(body);
          card.appendChild(row);
        });
      root.appendChild(card);
    }

    var pending = D.competitions.filter(function (c) { return c.status === "not-drawn"; });
    if (pending.length) {
      root.appendChild(el("div", "label", "LATER IN THE SEASON"));
      pending.forEach(function (c) {
        var card = el("div", "card dashed");
        var row = el("div", "comp-row");
        var body = el("div", "comp-body");
        body.appendChild(el("div", "comp-title", c.name));
        body.appendChild(el("div", "comp-meta", "Nothing in the feed yet. It appears here the moment a round is drawn."));
        row.appendChild(body);
        row.appendChild(el("span", "tag tag-none", "NOT DRAWN"));
        card.appendChild(row);
        root.appendChild(card);
      });
    }
    return root;
  }

  function compSummary(c) {
    if (c.type === "league") {
      var r = c.standings.filter(function (x) { return isCD(x.team); })[0];
      if (!r) return c.short;
      var left = c.standings.length * 2 - 2 - r.pld;
      return ordinal(r.pos) + " of " + c.standings.length + " · " + r.pts + " pts · " + left + " left to play";
    }
    var ours = D.fixtures.filter(function (f) { return f.comp === c.id && (isCD(f.home) || isCD(f.away)); });
    var next = ours.filter(function (f) { return f.status === "scheduled"; })[0];
    return next ? (next.round + " · " + fmtDay(parseDT(next))) : "knockout";
  }

  /* ================= shell ================= */
  var tab = "next";
  var TABS = [["next", "Next"], ["tables", "Tables"], ["fixtures", "Fixtures"], ["cups", "Cups"]];

  function render() {
    var main = $("#main");
    main.innerHTML = "";
    if (tab === "next") main.appendChild(viewNext());
    else if (tab === "tables") main.appendChild(viewTables());
    else if (tab === "fixtures") main.appendChild(viewFixtures());
    else main.appendChild(viewCups());
    main.appendChild(footer());
    Array.prototype.forEach.call(document.querySelectorAll(".navbtn"), function (b) {
      b.classList.toggle("on", b.dataset.tab === tab);
    });
    main.scrollTop = 0;
  }

  function footer() {
    var f = el("div", "footer");
    f.id = "calendar";
    f.appendChild(el("div", "label", "SUBSCRIBE"));
    var card = el("div", "card");
    [["cill-dara-all.ics", "Everything", "Both teams, league and cups"],
     ["cill-dara-1st.ics", "Cill Dara 1st XV", "League and cup fixtures"],
     ["cill-dara-2nd.ics", "Cill Dara 2nd XV", "Seconds league fixtures"]].forEach(function (c, i) {
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
    return f;
  }

  function boot(data) {
    D = data;
    $("#clubname").textContent = D.club.name;
    var fines = $("#fines");
    if (D.links && D.links.fines) { fines.href = D.links.fines; } else { fines.style.display = "none"; }
    var nav = $("#nav");
    TABS.forEach(function (t) {
      var b = el("button", "navbtn", t[1]);
      b.type = "button";
      b.dataset.tab = t[0];
      b.onclick = function () { tab = t[0]; location.hash = t[0]; render(); };
      nav.appendChild(b);
    });
    var h = (location.hash || "").replace("#", "");
    if (TABS.some(function (t) { return t[0] === h; })) tab = h;
    render();
  }

  if (window.__DATA__) { boot(window.__DATA__); }
  else {
    fetch("data.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(boot)
      .catch(function (e) {
        document.getElementById("main").innerHTML =
          '<p class="empty">Could not load data.json (' + e.message + ').</p>';
      });
  }
})();
