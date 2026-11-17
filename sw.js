// Service Worker: macht die App offline startbar.
// Strategie: erst Netzwerk (damit Updates ankommen), sonst Cache.
// Die Daten selbst werden offline von Firestore zwischengespeichert.
const CACHE = "haushalt-v1";
const SHELL = [
  "./", "./index.html", "./style.css", "./app.js", "./firebase-config.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Nur eigene Dateien und die Firebase-Skripte cachen
  const erlaubt = url.origin === location.origin || url.hostname === "www.gstatic.com";
  if (!erlaubt) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        const kopie = res.clone();
        caches.open(CACHE).then((c) => c.put(req, kopie));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
