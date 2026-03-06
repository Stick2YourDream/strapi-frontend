const VERSION = "v8";
const APP_SHELL_CACHE = `ysp-app-shell-${VERSION}`;
const STATIC_RUNTIME_CACHE = `ysp-runtime-static-${VERSION}`;
const MEDIA_RUNTIME_CACHE = `ysp-runtime-media-${VERSION}`;
const DATA_RUNTIME_CACHE = `ysp-runtime-data-${VERSION}`;
const KNOWN_CACHES = new Set([
  APP_SHELL_CACHE,
  STATIC_RUNTIME_CACHE,
  MEDIA_RUNTIME_CACHE,
  DATA_RUNTIME_CACHE,
]);
const NETWORK_TIMEOUT_MS = 8000;
const MAX_STATIC_RUNTIME_ENTRIES = 160;
const MAX_MEDIA_RUNTIME_ENTRIES = 180;
const MAX_DATA_RUNTIME_ENTRIES = 90;
const MAX_STATIC_RUNTIME_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_RUNTIME_BYTES = 8 * 1024 * 1024;
const MAX_DATA_RUNTIME_BYTES = 700 * 1024;
const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "code",
  "jwt",
  "challengeid",
  "challenge",
  "redirect",
  "signature",
  "state",
]);
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/logo2.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/screenshots/screenshot-wide.png",
  "/screenshots/screenshot-narrow.png",
];

const resolveUrl = (url) => new URL(url || "/", self.location.origin).href;
const parseResponseContentLength = (response) => {
  const raw = response?.headers?.get("content-length") || "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const hasNoStoreDirective = (response) => {
  const cacheControl = String(response?.headers?.get("cache-control") || "").toLowerCase();
  return cacheControl.includes("no-store") || cacheControl.includes("private");
};
const isCacheableResponse = (response) =>
  response &&
  response.ok &&
  response.status !== 206 &&
  !response.headers.has("Content-Range") &&
  !hasNoStoreDirective(response) &&
  !response.headers.has("set-cookie");
const isStaticImagePath = (path) =>
  String(path || "").startsWith("/assets/") ||
  String(path || "").startsWith("/icons/") ||
  String(path || "").startsWith("/screenshots/") ||
  String(path || "") === "/logo2.png";
const hasSensitiveQueryParams = (url) =>
  Array.from(url.searchParams.keys()).some((key) =>
    SENSITIVE_QUERY_KEYS.has(String(key || "").toLowerCase())
  );
const trimCacheEntries = async (cacheName, maxEntries) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const overflow = keys.length - maxEntries;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((entry) => cache.delete(entry)));
};
const putCacheEntry = async (cacheName, request, response, maxEntries, maxBytes) => {
  if (!isCacheableResponse(response)) return;
  const contentLength = parseResponseContentLength(response);
  if (contentLength !== null && contentLength > maxBytes) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    await trimCacheEntries(cacheName, maxEntries);
  } catch (error) {
    console.warn("Service worker cache write failed:", error);
  }
};

const fetchWithTimeout = async (request, timeoutMs = NETWORK_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

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
          .filter((key) => !KNOWN_CACHES.has(key))
          .map((key) => caches.delete(key))
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (error) {
          console.warn("Service worker navigation preload enable failed:", error);
        }
      }
      await self.clients.claim();
    })()
  );
});

const cacheFirst = async (request, cacheName, maxEntries, maxBytes) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  await putCacheEntry(cacheName, request, response, maxEntries, maxBytes);
  return response;
};

const networkFirst = async (
  request,
  cacheName,
  maxEntries,
  maxBytes,
  preloadResponsePromise = Promise.resolve(undefined)
) => {
  const cache = await caches.open(cacheName);
  try {
    const preloadedResponse = await preloadResponsePromise.catch(() => undefined);
    if (preloadedResponse) {
      await putCacheEntry(cacheName, request, preloadedResponse, maxEntries, maxBytes);
      return preloadedResponse;
    }
    const response = await fetchWithTimeout(request);
    if (response.status >= 500) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    await putCacheEntry(cacheName, request, response, maxEntries, maxBytes);
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    const fallback = await caches.match("/index.html");
    return fallback || Response.error();
  }
};

const staleWhileRevalidate = async (request, cacheName, maxEntries, maxBytes) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetchWithTimeout(request)
    .then(async (response) => {
      await putCacheEntry(cacheName, request, response, maxEntries, maxBytes);
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
  const requestPath = requestUrl.pathname || "/";
  if (
    requestPath.startsWith("/api") ||
    requestPath.startsWith("/strapi") ||
    requestPath.startsWith("/share/post")
  ) {
    return;
  }

  if (request.headers.has("range")) {
    return;
  }

  if (request.mode === "navigate") {
    if (hasSensitiveQueryParams(requestUrl)) {
      event.respondWith(
        fetchWithTimeout(request).catch(async () => {
          const fallback = await caches.match("/index.html");
          return fallback || Response.error();
        })
      );
      return;
    }
    event.respondWith(
      networkFirst(
        request,
        DATA_RUNTIME_CACHE,
        MAX_DATA_RUNTIME_ENTRIES,
        MAX_DATA_RUNTIME_BYTES,
        event.preloadResponse
      )
    );
    return;
  }

  if (["script", "style", "font"].includes(request.destination)) {
    event.respondWith(
      cacheFirst(
        request,
        STATIC_RUNTIME_CACHE,
        MAX_STATIC_RUNTIME_ENTRIES,
        MAX_STATIC_RUNTIME_BYTES
      )
    );
    return;
  }

  if (request.destination === "image") {
    if (isStaticImagePath(requestPath)) {
      event.respondWith(
        cacheFirst(
          request,
          STATIC_RUNTIME_CACHE,
          MAX_STATIC_RUNTIME_ENTRIES,
          MAX_STATIC_RUNTIME_BYTES
        )
      );
    } else {
      event.respondWith(
        staleWhileRevalidate(
          request,
          MEDIA_RUNTIME_CACHE,
          MAX_MEDIA_RUNTIME_ENTRIES,
          MAX_MEDIA_RUNTIME_BYTES
        )
      );
    }
    return;
  }

  event.respondWith(
    staleWhileRevalidate(
      request,
      DATA_RUNTIME_CACHE,
      MAX_DATA_RUNTIME_ENTRIES,
      MAX_DATA_RUNTIME_BYTES
    )
  );
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
      const response = await fetch("/").catch(() => undefined);
      if (response) {
        await putCacheEntry(
          DATA_RUNTIME_CACHE,
          new Request("/"),
          response,
          MAX_DATA_RUNTIME_ENTRIES,
          MAX_DATA_RUNTIME_BYTES
        );
      }
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
