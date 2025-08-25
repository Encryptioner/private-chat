/**
 * Service Worker for caching application shell, runtime resources, and model files.
 */
const VERSION = "v1.0.4";
const STATIC_CACHE = `static-${VERSION}`;
const MODEL_CACHE = `models-${VERSION}`;

const CORE_ASSETS = ["/", "/index.html", "/favicon.svg"];

async function safePut(cacheName, request, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(cacheName);
  const reqObj = typeof request === "string" ? new Request(request) : request;
  cache.put(reqObj, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(CORE_ASSETS);
      const manifestUrls = ["/.vite/manifest.json", "/manifest.json"];
      for (const mUrl of manifestUrls) {
        try {
          const resp = await fetch(mUrl, { cache: "no-cache" });
          if (!resp.ok) continue;
          const manifest = await resp.json();
          const toAdd = new Set();
          for (const key in manifest) {
            const entry = manifest[key];
            if (entry.file) toAdd.add("/" + entry.file.replace(/^\/?/, ""));
            if (entry.css) entry.css.forEach((f) => toAdd.add("/" + f.replace(/^\/?/, "")));
            if (entry.assets) entry.assets.forEach((f) => toAdd.add("/" + f.replace(/^\/?/, "")));
          }
          if (toAdd.size) await cache.addAll([...toAdd]);
          console.debug("Precached files:", toAdd);
        } catch {
          console.debug(e);
          // try next path
        }
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => ![APP_SHELL_CACHE, RUNTIME_CACHE, MODEL_CACHE].includes(k)).map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const isNavigation = request.mode === "navigate";

  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const net = await fetch(request);
          safePut(STATIC_CACHE, "/index.html", net.clone());
          return net;
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match("/index.html")) || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Static resources: Stale-while-revalidate
  if (/\.(js|css|wasm)(\?|$)/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((resp) => safePut(STATIC_CACHE, request, resp))
          .catch(() => null);
        return cached || fetchPromise || new Response("Offline", { status: 503 });
      })()
    );
    return;
  }

  // All other requests: network falling back to any cache
  event.respondWith(
    (async () => {
      try {
        const net = await fetch(request);
        return net;
      } catch {
        const keys = await caches.keys();
        for (const k of keys) {
          const cache = await caches.open(k);
          const match = await cache.match(request);
          if (match) return match;
        }
        return new Response("Offline", { status: 503 });
      }
    })()
  );
});
