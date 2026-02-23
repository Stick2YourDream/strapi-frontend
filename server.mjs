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

app.use((req, res, next) => {
  applySecurityHeaders(res, req);
  next();
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
