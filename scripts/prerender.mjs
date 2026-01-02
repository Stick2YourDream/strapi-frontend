import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const ssgDir = path.join(rootDir, "dist-ssg");

const templatePath = path.join(distDir, "index.html");
const template = fs.readFileSync(templatePath, "utf-8");

const entryCandidates = fs
  .readdirSync(ssgDir)
  .filter((name) => name.startsWith("entry-ssg.") && (name.endsWith(".js") || name.endsWith(".mjs")));
if (!entryCandidates.length) {
  throw new Error("Unable to find SSR entry in dist-ssg (expected entry-ssg.js/mjs).");
}
const ssgBundle = pathToFileURL(path.join(ssgDir, entryCandidates[0])).href;
const { render } = await import(ssgBundle);

const routes = [
  {
    path: "/",
    meta: {
      title: "Stick2YourDreams Connect | Motivational support network",
      description:
        "Stick2YourDreams Connect is a motivational support network where friends celebrate progress, share updates, and keep each other accountable.",
      url: "https://yoursocialplace.com/",
    },
  },
  {
    path: "/terms",
    meta: {
      title: "Terms & Conditions | Stick2YourDreams Connect",
      description:
        "Review the Stick2YourDreams Connect terms and conditions for community guidelines, safety, and platform usage.",
      url: "https://yoursocialplace.com/terms",
    },
  },
];

const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const replaceMetaContent = (html, attr, key, value) => {
  const regex = new RegExp(`(<meta[^>]+${attr}="${key}"[^>]*content=")[^"]*(")`, "i");
  return html.replace(regex, `$1${escapeHtml(value)}$2`);
};

const replaceLinkHref = (html, rel, href) => {
  const regex = new RegExp(`(<link[^>]+rel="${rel}"[^>]*href=")[^"]*(")`, "i");
  return html.replace(regex, `$1${escapeHtml(href)}$2`);
};

const replaceTitle = (html, title) =>
  html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);

const applyMeta = (html, meta) => {
  let next = replaceTitle(html, meta.title);
  next = replaceMetaContent(next, "name", "description", meta.description);
  next = replaceMetaContent(next, "property", "og:title", meta.title);
  next = replaceMetaContent(next, "property", "og:description", meta.description);
  next = replaceMetaContent(next, "property", "og:url", meta.url);
  next = replaceMetaContent(next, "name", "twitter:title", meta.title);
  next = replaceMetaContent(next, "name", "twitter:description", meta.description);
  next = replaceLinkHref(next, "canonical", meta.url);
  return next;
};

const injectHtml = (html, appHtml) => {
  if (!html.includes("<!--ssg-outlet-->")) {
    throw new Error("Missing <!--ssg-outlet--> placeholder in index.html");
  }
  return html.replace("<!--ssg-outlet-->", appHtml);
};

routes.forEach((route) => {
  const { html } = render(route.path);
  const withApp = injectHtml(template, html);
  const withMeta = applyMeta(withApp, route.meta);

  const outPath =
    route.path === "/"
      ? path.join(distDir, "index.html")
      : path.join(distDir, route.path, "index.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, withMeta, "utf-8");
});
