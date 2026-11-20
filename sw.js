const CACHE_PREFIX = "understudy-audit";
const CACHE_VERSION = "v11";
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const APP_URL = new URL("./audit-app.html", self.location.href).href;
const APP_SHELL = [
  "./audit-app.html",
  "./discovery.js",
  "./meetings.js",
  "./meeting-ui.js",
  "./meeting-icons.js",
  "./meetings.css",
  "./manifest.webmanifest",
  "./icons/audit-192.png",
  "./icons/audit-512.png",
  "./icons/audit-maskable-512.png",
  "./icons/audit-apple-180.png"
];

// Only a navigation to the app page itself may refresh the cached app shell.
// Any other page in scope (the index redirect, a 404) must never overwrite it.
function isAppNavigation(requestUrl) {
  const url = new URL(requestUrl);
  const app = new URL(APP_URL);
  return url.origin === app.origin && url.pathname === app.pathname;
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(`${CACHE_PREFIX}-`) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (!isAppNavigation(request.url)) {
      // Network first; offline, fall back to the cached app shell without caching this page.
      event.respondWith(fetch(request).catch(() => caches.match(APP_URL)));
      return;
    }
    event.respondWith(
      fetch(request)
        .then(async response => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(APP_URL, response.clone());
          }
          return response;
        })
        .catch(() => caches.match(APP_URL))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true })
      .then(cached => cached || fetch(request))
  );
});
