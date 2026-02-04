const VERSION = "v3";
const APP_SHELL_CACHE = `ysp-app-shell-${VERSION}`;
const RUNTIME_CACHE = `ysp-runtime-${VERSION}`;
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/screenshots/screenshot-wide.png",
  "/screenshots/screenshot-narrow.png",
];

const resolveUrl = (url) => new URL(url || "/", self.location.origin).href;
const isCacheableResponse = (response) =>
  response &&
  response.ok &&
  response.status !== 206 &&
  !response.headers.has("Content-Range");

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch (error) {
        console.warn("Service worker precache failed:", error);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("ysp-"))
          .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
};

const networkFirst = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    const fallback = await caches.match("/index.html");
    return fallback || Response.error();
  }
};

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (isCacheableResponse(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  const response = cached || (await fetchPromise);
  return response || Response.error();
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.headers.has("range")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "pwa-sync") {
    return;
  }

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      clients.forEach((client) => {
        client.postMessage({ type: "pwa-sync" });
      });
    })()
  );
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "pwa-periodic-sync") {
    return;
  }

  event.waitUntil(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.add("/");
    })()
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (error) {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || "Your Social Place";
  const options = {
    body: payload.body || "You have new updates waiting.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: payload.url || "/",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationUrl = resolveUrl(event.notification?.data?.url);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client && client.url !== notificationUrl) {
            await client.navigate(notificationUrl);
          }
          return;
        }
      }

      await self.clients.openWindow(notificationUrl);
    })()
  );
});
