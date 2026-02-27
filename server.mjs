import "dotenv/config";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const STATIC_DIR =
  process.env.STATIC_DIR || path.join(__dirname, "dist");
const STRAPI_TARGET =
  process.env.STRAPI_TARGET || "http://127.0.0.1:1337";
const PORT = Number(process.env.PORT || 4173);
const STATIC_DIR_ABS = path.resolve(STATIC_DIR);
const SHARE_SOURCE_SET = new Set(["user", "group", "admin"]);
const SHARE_PREVIEW_TIMEOUT_MS = 5000;

app.set("trust proxy", true);
app.disable("x-powered-by");

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

app.get("/share/post", async (req, res) => {
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
  const defaultImage = `${safeOrigin}/logo.png`;

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
  createProxyMiddleware({
    target: STRAPI_TARGET,
    changeOrigin: true,
    ws: true,
    pathRewrite: { "^/strapi": "" },
    logLevel: "warn",
  })
);

app.use(
  "/api",
  createProxyMiddleware({
    target: STRAPI_TARGET,
    changeOrigin: true,
    ws: true,
    pathRewrite: (path) => `/api${path}`,
    logLevel: "warn",
  })
);

app.use(
  "/uploads",
  createProxyMiddleware({
    target: STRAPI_TARGET,
    changeOrigin: true,
    ws: true,
    logLevel: "warn",
  })
);

app.use(express.static(STATIC_DIR, { maxAge: "1h" }));

app.get("*", (req, res) => {
  const prerenderedFile = resolvePrerenderedHtml(req.path);
  if (prerenderedFile) {
    res.sendFile(prerenderedFile);
    return;
  }
  res.sendFile(path.join(STATIC_DIR_ABS, "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[web-front] listening on :${PORT} | serving ${STATIC_DIR} | /strapi -> ${STRAPI_TARGET}`
  );
});
