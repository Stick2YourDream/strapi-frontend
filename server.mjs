import "dotenv/config";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const STATIC_DIR =
  process.env.STATIC_DIR || path.join(__dirname, "dist");
const STRAPI_TARGET =
  process.env.STRAPI_TARGET || "http://127.0.0.1:1337";
const PORT = Number(process.env.PORT || 4173);
const PROXY_TIMEOUT_MS = Math.max(5000, Number(process.env.PROXY_TIMEOUT_MS || 30000));
const READINESS_TIMEOUT_MS = Math.max(
  500,
  Number(process.env.READINESS_TIMEOUT_MS || 2500)
);
const STATIC_DIR_ABS = path.resolve(STATIC_DIR);
const proxyTargetUrl = new URL(STRAPI_TARGET);
const SHARE_SOURCE_SET = new Set(["user", "group", "admin"]);
const SHARE_PREVIEW_TIMEOUT_MS = 5000;
const ASSET_HASHED_PATH_RE = /[\\/]+assets[\\/].*\.[a-z0-9_-]{8,}\.[a-z0-9]+$/i;
const HTML_CACHE_CONTROL = "no-cache, must-revalidate";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

app.set("trust proxy", true);
app.disable("x-powered-by");

const proxyAgent =
  proxyTargetUrl.protocol === "https:"
    ? new https.Agent({
        keepAlive: true,
        maxSockets: 120,
        maxFreeSockets: 24,
        timeout: PROXY_TIMEOUT_MS,
      })
    : new http.Agent({
        keepAlive: true,
        maxSockets: 120,
        maxFreeSockets: 24,
        timeout: PROXY_TIMEOUT_MS,
      });

const isSecureRequest = (req) => {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return Boolean(req.secure || forwardedProto === "https");
};

const applySecurityHeaders = (res, req) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"
  );
  if (isSecureRequest(req)) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
};

const resolvePrerenderedHtml = (requestPath) => {
  const pathname = String(requestPath || "/");
  if (!pathname || pathname === "/") {
    return path.join(STATIC_DIR_ABS, "index.html");
  }

  const normalized = path.posix.normalize(pathname);
  const relativePath = normalized.replace(/^\/+/, "");
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes("\0")) {
    return null;
  }

  const candidate = path.resolve(STATIC_DIR_ABS, relativePath, "index.html");
  if (!candidate.startsWith(STATIC_DIR_ABS)) {
    return null;
  }

  return fs.existsSync(candidate) ? candidate : null;
};

const applyStaticCacheHeaders = (res, filePath) => {
  const normalizedPath = String(filePath || "").toLowerCase();
  const basename = path.basename(normalizedPath);
  if (
    basename === "index.html" ||
    basename === "sw.js" ||
    basename === "manifest.webmanifest"
  ) {
    res.setHeader("Cache-Control", HTML_CACHE_CONTROL);
    return;
  }
  if (ASSET_HASHED_PATH_RE.test(normalizedPath)) {
    res.setHeader("Cache-Control", IMMUTABLE_CACHE_CONTROL);
    return;
  }
  res.setHeader("Cache-Control", STATIC_CACHE_CONTROL);
};

const normalizeSource = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  return SHARE_SOURCE_SET.has(raw) ? raw : "user";
};

const clipText = (value, limit) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const resolveRequestOrigin = (req) => {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(req.get("host") || "").trim();
  if (!host) return "";
  const protocol = forwardedProto || (req.secure ? "https" : req.protocol || "http");
  return `${protocol}://${host}`;
};

const toAbsoluteUrl = (value, origin) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!origin) return raw;
  if (raw.startsWith("/")) return `${origin}${raw}`;
  return `${origin}/${raw}`;
};

const renderShareHtml = ({ title, description, image, canonicalUrl, redirectUrl }) => {
  const safeTitle = escapeHtml(clipText(title, 120) || "Your Social Place");
  const safeDescription = escapeHtml(
    clipText(description, 260) || "Your Social Place shared post"
  );
  const safeImage = escapeHtml(image);
  const safeCanonical = escapeHtml(canonicalUrl);
  const safeRedirect = escapeHtml(redirectUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <meta name="robots" content="noindex, nofollow" />
    <link rel="canonical" href="${safeCanonical}" />
    <meta property="og:site_name" content="Your Social Place" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:url" content="${safeCanonical}" />
    <meta property="og:image" content="${safeImage}" />
    <meta property="og:image:secure_url" content="${safeImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeImage}" />
    <meta http-equiv="refresh" content="0;url=${safeRedirect}" />
  </head>
  <body>
    <p>Opening post… <a href="${safeRedirect}">Continue</a></p>
    <script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
  </body>
</html>`;
};

app.use((req, res, next) => {
  applySecurityHeaders(res, req);
  next();
});

app.get("/healthz", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
});

const checkStrapiReadiness = async () => {
  const target = new URL("/api", STRAPI_TARGET).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

app.get("/readyz", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const ready = await checkStrapiReadiness();
  if (!ready) {
    res.status(503).json({ status: "degraded", upstream: "strapi-unreachable" });
    return;
  }
  res.status(200).json({ status: "ready" });
});

const buildProxyMiddleware = (options = {}) =>
  createProxyMiddleware({
    target: STRAPI_TARGET,
    changeOrigin: true,
    ws: true,
    xfwd: true,
    agent: proxyAgent,
    proxyTimeout: PROXY_TIMEOUT_MS,
    timeout: PROXY_TIMEOUT_MS,
    logLevel: "warn",
    onError: (error, _req, res) => {
      if (res.headersSent) return;
      res.statusCode = 502;
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: "upstream_unavailable",
          message: "Service temporarily unavailable.",
        })
      );
      // eslint-disable-next-line no-console
      console.warn("[proxy] upstream request failed", error);
    },
    ...options,
  });

app.get("/share/post", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const source = normalizeSource(req.query?.source);
  const id = String(req.query?.id || req.query?.post || "").trim();
  if (!id) {
    res.redirect(302, "/");
    return;
  }

  const requestOrigin =
    resolveRequestOrigin(req) ||
    String(process.env.VITE_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  const safeOrigin = requestOrigin || "https://yoursocialplace.com";
  const canonicalUrl = `${safeOrigin}/share/post?source=${encodeURIComponent(
    source
  )}&id=${encodeURIComponent(id)}`;
  const redirectUrl = `${safeOrigin}/dashboard?post=${encodeURIComponent(
    id
  )}&source=${encodeURIComponent(source)}`;
  const defaultImage = `${safeOrigin}/logo2.png`;

  let title = "Your Social Place shared post";
  let description = "Open this post on Your Social Place.";
  let image = defaultImage;

  try {
    const previewUrl = new URL("/api/share-preview/post", STRAPI_TARGET);
    previewUrl.searchParams.set("source", source);
    previewUrl.searchParams.set("id", id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SHARE_PREVIEW_TIMEOUT_MS);
    try {
      const response = await fetch(previewUrl.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const data = payload?.data;
        const nextTitle = clipText(data?.title, 120);
        const nextDescription = clipText(data?.description, 260);
        const nextImage = toAbsoluteUrl(data?.image, safeOrigin);
        if (nextTitle) title = nextTitle;
        if (nextDescription) description = nextDescription;
        if (nextImage) image = nextImage;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[share-card] preview fetch failed source=${source} id=${id}`, error);
  }

  res.status(200).type("html").send(
    renderShareHtml({
      title,
      description,
      image,
      canonicalUrl,
      redirectUrl,
    })
  );
});

app.use(
  "/strapi",
  buildProxyMiddleware({
    pathRewrite: { "^/strapi": "" },
  })
);

app.use(
  "/api",
  buildProxyMiddleware({
    pathRewrite: (path) => `/api${path}`,
  })
);

app.use(
  "/uploads",
  buildProxyMiddleware()
);

app.use(
  express.static(STATIC_DIR, {
    maxAge: "1h",
    index: false,
    setHeaders: applyStaticCacheHeaders,
  })
);

app.get("*", (req, res) => {
  res.setHeader("Cache-Control", HTML_CACHE_CONTROL);
  const prerenderedFile = resolvePrerenderedHtml(req.path);
  if (prerenderedFile) {
    res.sendFile(prerenderedFile);
    return;
  }
  res.sendFile(path.join(STATIC_DIR_ABS, "index.html"));
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[web-front] listening on :${PORT} | serving ${STATIC_DIR} | /strapi -> ${STRAPI_TARGET}`
  );
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 120_000;

const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`[web-front] received ${signal}, shutting down...`);
  const forceExitTimer = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error("[web-front] force exiting after shutdown timeout");
    process.exit(1);
  }, 15_000);
  forceExitTimer.unref();

  server.close(() => {
    proxyAgent.destroy();
    clearTimeout(forceExitTimer);
    // eslint-disable-next-line no-console
    console.log("[web-front] shutdown complete");
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
