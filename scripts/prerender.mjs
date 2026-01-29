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
      title: "Your Social Place | Motivational social network without all the fluff",
      description:
        "Your Social Place is a community driven motivational social network where real people share dreams, goals, progress, and help uplift each other.",
      url: "https://yoursocialplace.com/",
    },
  },
  {
    path: "/terms",
    meta: {
      title: "Terms & Conditions | Your Social Place",
      description:
        "Review the Your Social Place terms and conditions for community guidelines, safety, and platform usage.",
      url: "https://yoursocialplace.com/terms",
    },
  },
  {
    path: "/privacy",
    meta: {
      title: "Privacy Policy | Your Social Place",
      description:
        "Learn how Your Social Place collects, uses, and protects your information.",
      url: "https://yoursocialplace.com/privacy",
    },
  },
  {
    path: "/guidelines",
    meta: {
      title: "Community Guidelines | Your Social Place",
      description:
        "Read the Your Social Place community guidelines for constructive feedback, safety, and reporting.",
      url: "https://yoursocialplace.com/guidelines",
    },
  },
  {
    path: "/cookies",
    meta: {
      title: "Cookie Policy | Your Social Place",
      description:
        "Read the Your Social Place Cookie Policy and manage your analytics preferences.",
      url: "https://yoursocialplace.com/cookies",
    },
  },
  {
    path: "/safety",
    meta: {
      title: "Safety & Moderation | Your Social Place",
      description:
        "Learn how Your Social Place keeps the community safe with clear rules, fast reporting, and thoughtful moderation.",
      url: "https://yoursocialplace.com/safety",
    },
  },
  {
    path: "/report",
    meta: {
      title: "Reporting | Your Social Place",
      description:
        "Report a user or post and learn what happens next at Your Social Place.",
      url: "https://yoursocialplace.com/report",
    },
  },
  {
    path: "/login",
    meta: {
      title: "Login | Your Social Place",
      description:
        "Log in to Your Social Place to share progress updates and stay accountable with your support network.",
      url: "https://yoursocialplace.com/login",
      robots: "noindex, nofollow",
    },
  },
  {
    path: "/register",
    meta: {
      title: "Register | Your Social Place",
      description:
        "Create a Your Social Place account to join a motivational support network that celebrates progress and accountability.",
      url: "https://yoursocialplace.com/register",
      robots: "noindex, nofollow",
    },
  },
  {
    path: "/apps",
    meta: {
      title: "Apps & Downloads | Your Social Place",
      description:
        "Download YSP Live, the Windows control helper, or install the Your Social Place PWA on any device.",
      url: "https://yoursocialplace.com/apps",
    },
  },
  {
    path: "/downloads",
    meta: {
      title: "Apps & Downloads | Your Social Place",
      description:
        "Download YSP Live, the Windows control helper, or install the Your Social Place PWA on any device.",
      url: "https://yoursocialplace.com/apps",
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
  if (meta.robots) {
    next = replaceMetaContent(next, "name", "robots", meta.robots);
  }
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
