/* sw.js — offline primero.
   App: caché primero (versionado por build). Rutina: red primero con tope de espera (3G), caché si no hay señal.
   scripts/build.mjs reemplaza las dos líneas marcadas; sin build funciona igual, sin precarga. */
const VERSION = "dev"; // build:version
const ASSETS = []; // build:assets
const CACHE = `gluteo-${VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("gluteo-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/rutinas/")) { event.respondWith(networkFirst(req)); return; }
  // Siempre "./": Cloudflare redirige /index.html → / (308), y Safari rechaza navegar con una redirección cacheada.
  if (req.mode === "navigate") {
    event.respondWith(caches.match("./").then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(cacheFirst(req));
});
