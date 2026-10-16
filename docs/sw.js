/* Cill Dara RFC — offline shell.
   Shell files: cache first, refreshed in the background.
   data.json:   network first, falling back to the last copy, so a pitch with no
                signal still shows the fixtures you had this morning. */
var VERSION = "v4";
var SHELL = "shell-" + VERSION;
var DATA = "data-" + VERSION;
var FILES = [
  "./", "./index.html", "./app.js", "./style.css",
  "./crest-96.png", "./crest-192.png", "./crest-512.png", "./wallpaper.html",
  "./favicon-32.png", "./apple-touch-icon.png", "./manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(FILES.map(function (f) {
      return c.add(f).catch(function () { /* a missing optional file must not fail the install */ });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      if (k !== SHELL && k !== DATA) return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith("data.json") || url.pathname.endsWith("history.json")) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(DATA).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || new Response('{"error":"offline"}', { headers: { "Content-Type": "application/json" } });
        });
      })
    );
    return;
  }

  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
