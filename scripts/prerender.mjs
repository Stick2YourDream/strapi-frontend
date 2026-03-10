import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const ssgDir = path.join(rootDir, "dist-ssg");
const BASE_URL = "https://yoursocialplace.com";

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
      title: "Motivational Social Network | Your Social Place",
      description:
        "Your Social Place is a community driven motivational social network where real people share dreams, goals, progress, and help uplift each other.",
      url: `${BASE_URL}/`,
    },
  },
  {
    path: "/terms",
    meta: {
      title: "Terms & Conditions | Your Social Place",
      description:
        "Review the Your Social Place terms and conditions for community guidelines, safety, and platform usage.",
      url: `${BASE_URL}/terms`,
    },
  },
  {
    path: "/marketplace-policy",
    meta: {
      title: "Marketplace Policy | Your Social Place",
      description:
        "Review marketplace policies for listings, transactions, and community trust on Your Social Place.",
      url: `${BASE_URL}/marketplace-policy`,
    },
  },
  {
    path: "/marketplace-fee-disclosure",
    meta: {
      title: "Marketplace Fee Disclosure | Your Social Place",
      description:
        "Understand marketplace fees and payout details for sellers on Your Social Place.",
      url: `${BASE_URL}/marketplace-fee-disclosure`,
    },
  },
  {
    path: "/privacy",
    meta: {
      title: "Privacy Policy | Your Social Place",
      description:
        "Learn how Your Social Place collects, uses, and protects your information.",
      url: `${BASE_URL}/privacy`,
    },
  },
  {
    path: "/guidelines",
    meta: {
      title: "Community Guidelines | Your Social Place",
      description:
        "Read the Your Social Place community guidelines for constructive feedback, safety, and reporting.",
      url: `${BASE_URL}/guidelines`,
    },
  },
  {
    path: "/cookies",
    meta: {
      title: "Cookie Policy | Your Social Place",
      description:
        "Read the Your Social Place Cookie Policy and manage your analytics preferences.",
      url: `${BASE_URL}/cookies`,
    },
  },
  {
    path: "/safety",
    meta: {
      title: "Safety & Moderation | Your Social Place",
      description:
        "Learn how Your Social Place keeps the community safe with clear rules, fast reporting, and thoughtful moderation.",
      url: `${BASE_URL}/safety`,
    },
  },
  {
    path: "/report",
    meta: {
      title: "Reporting | Your Social Place",
      description:
        "Report a user or post and learn what happens next at Your Social Place.",
      url: `${BASE_URL}/report`,
    },
  },
  {
    path: "/support",
    meta: {
      title: "Support & Contact | Your Social Place",
      description:
        "Contact support, report safety concerns, and get help with your Your Social Place account.",
      url: `${BASE_URL}/support`,
    },
  },
  {
    path: "/what-makes-us-different",
    meta: {
      title: "What Makes Us Different | Your Social Place",
      description:
        "See what sets Your Social Place apart with real accountability, live support, and authentic community.",
      url: `${BASE_URL}/what-makes-us-different`,
    },
  },
  {
    path: "/login",
    meta: {
      title: "Login | Your Social Place",
      description:
        "Log in to Your Social Place to share progress updates and stay accountable with your support network.",
      url: `${BASE_URL}/login`,
      robots: "noindex, nofollow, noarchive, nosnippet, max-image-preview:none, max-video-preview:-1",
    },
  },
  {
    path: "/register",
    meta: {
      title: "Register | Your Social Place",
      description:
        "Create a Your Social Place account to join a motivational support network that celebrates progress and accountability.",
      url: `${BASE_URL}/register`,
      robots: "noindex, nofollow, noarchive, nosnippet, max-image-preview:none, max-video-preview:-1",
    },
  },
  {
    path: "/apps",
    meta: {
      title: "Apps & Downloads | Your Social Place",
      description:
        "Download YSP Live, the Windows control helper, or install the Your Social Place PWA on any device.",
      url: `${BASE_URL}/apps`,
    },
  },
  {
    path: "/downloads",
    meta: {
      title: "Downloads | Your Social Place",
      description:
        "Download YSP Live, the Windows control helper, or install the Your Social Place PWA on any device.",
      url: `${BASE_URL}/downloads`,
    },
  },
  {
    path: "/forums",
    meta: {
      title: "Forums | Your Social Place",
      description:
        "Uplifting forums built for encouragement, progress, and positive support.",
      url: `${BASE_URL}/forums`,
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

const buildJsonLd = (meta) => {
  const canonicalTarget = meta.canonical || meta.url;
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${BASE_URL}/#organization`,
          name: "Your Social Place",
          url: `${BASE_URL}/`,
          logo: `${BASE_URL}/logo2.png`,
        },
        {
          "@type": "WebSite",
          "@id": `${BASE_URL}/#website`,
          url: `${BASE_URL}/`,
          name: "Your Social Place",
          publisher: { "@id": `${BASE_URL}/#organization` },
        },
        {
          "@type": "WebPage",
          "@id": `${canonicalTarget}#webpage`,
          url: canonicalTarget,
          name: meta.title,
          description: meta.description,
          isPartOf: { "@id": `${BASE_URL}/#website` },
          about: { "@id": `${BASE_URL}/#organization` },
        },
      ],
    },
    null,
    2
  );
};

const replaceJsonLd = (html, jsonLd) =>
  html.replace(
    /<script[^>]+id="app-seo-jsonld"[^>]*>[\s\S]*?<\/script>/i,
    `<script id="app-seo-jsonld" type="application/ld+json">\n${jsonLd}\n    </script>`
  );

const applyMeta = (html, meta) => {
  const canonicalTarget = meta.canonical || meta.url;
  let next = replaceTitle(html, meta.title);
  next = replaceMetaContent(next, "name", "description", meta.description);
  if (meta.robots) {
    next = replaceMetaContent(next, "name", "robots", meta.robots);
    next = replaceMetaContent(next, "name", "googlebot", meta.robots);
  }
  next = replaceMetaContent(next, "property", "og:title", meta.title);
  next = replaceMetaContent(next, "property", "og:description", meta.description);
  next = replaceMetaContent(next, "property", "og:url", canonicalTarget);
  next = replaceMetaContent(next, "name", "twitter:title", meta.title);
  next = replaceMetaContent(next, "name", "twitter:description", meta.description);
  next = replaceLinkHref(next, "canonical", canonicalTarget);
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
  const withJsonLd = replaceJsonLd(withMeta, buildJsonLd(route.meta));

  const outPath =
    route.path === "/"
      ? path.join(distDir, "index.html")
      : path.join(distDir, route.path, "index.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, withJsonLd, "utf-8");
});
