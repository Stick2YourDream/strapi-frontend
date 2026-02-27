import { useEffect } from "react";
import {
  DEFAULT_ROBOTS_DIRECTIVES,
  NOINDEX_ROBOTS_DIRECTIVES,
  isPrivateSeoPath,
} from "../constants/seo";

type MetaOptions = {
  title: string;
  description: string;
  type?: string;
  canonical?: string;
  robots?: string;
  keywords?: string;
  image?: string;
  imageAlt?: string;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const SEO_JSONLD_ID = "app-seo-jsonld";

const normalizePath = (value: string) => {
  if (!value) return "/";
  const noQuery = value.split("?")[0] || "/";
  const noHash = noQuery.split("#")[0] || "/";
  if (noHash === "/") return "/";
  return noHash.endsWith("/") ? noHash.slice(0, -1) : noHash;
};

const buildAbsoluteUrl = (base: string, path: string) => {
  const safeBase = trimTrailingSlash(base);
  if (!path) return safeBase || path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${safeBase}${safePath}`;
};

const upsertMeta = (name: string, value: string, useProperty = false) => {
  const selector = useProperty
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  let tag = document.querySelector(selector) as HTMLMetaElement | null;
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(useProperty ? "property" : "name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", value);
};

const removeMeta = (name: string, useProperty = false) => {
  const selector = useProperty
    ? `meta[property="${name}"]`
    : `meta[name="${name}"]`;
  const tag = document.querySelector(selector);
  if (tag?.parentNode) {
    tag.parentNode.removeChild(tag);
  }
};

const upsertLink = (rel: string, href: string) => {
  let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", rel);
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
};

const upsertJsonLd = (data: Record<string, unknown>) => {
  let script = document.getElementById(SEO_JSONLD_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id = SEO_JSONLD_ID;
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.text = JSON.stringify(data);
};

const removeJsonLd = () => {
  const script = document.getElementById(SEO_JSONLD_ID);
  if (script?.parentNode) {
    script.parentNode.removeChild(script);
  }
};

export const usePageMeta = ({
  title,
  description,
  type,
  canonical,
  robots,
  keywords,
  image,
  imageAlt,
}: MetaOptions) => {
  useEffect(() => {
    const safeTitle = title.trim();
    const safeDescription = description.trim();
    const siteName = String(import.meta.env.VITE_APP_NAME || "").trim() || "Your Social Place";
    const baseUrlRaw = String(import.meta.env.VITE_PUBLIC_SITE_URL || "").trim();
    const baseUrl = baseUrlRaw ? trimTrailingSlash(baseUrlRaw) : window.location.origin;
    const currentPath = normalizePath(window.location.pathname || "/");
    const isPrivatePath = isPrivateSeoPath(currentPath);
    const canonicalUrl = canonical
      ? buildAbsoluteUrl(baseUrl, canonical.trim())
      : buildAbsoluteUrl(baseUrl, currentPath);
    const robotsDirectives = isPrivatePath
      ? NOINDEX_ROBOTS_DIRECTIVES
      : robots || DEFAULT_ROBOTS_DIRECTIVES;
    const keywordsContent = keywords?.trim();
    const metaImage = buildAbsoluteUrl(baseUrl, (image || "/logo.png").trim());
    const metaImageAlt = (imageAlt || safeTitle).trim();
    const lang = (document.documentElement.lang || "en").toLowerCase();
    const ogLocale = lang.includes("-")
      ? lang.replace("-", "_")
      : lang === "en"
      ? "en_US"
      : lang;
    document.title = safeTitle;

    upsertMeta("description", safeDescription);
    upsertMeta("robots", robotsDirectives);
    upsertMeta("googlebot", robotsDirectives);
    if (keywordsContent) {
      upsertMeta("keywords", keywordsContent);
    } else {
      removeMeta("keywords");
    }
    upsertMeta("og:title", safeTitle, true);
    upsertMeta("og:description", safeDescription, true);
    upsertMeta("og:type", type || "website", true);
    upsertMeta("og:site_name", siteName, true);
    upsertMeta("og:locale", ogLocale, true);
    upsertMeta("og:url", canonicalUrl, true);
    upsertMeta("twitter:title", safeTitle);
    upsertMeta("twitter:description", safeDescription);
    upsertMeta("twitter:url", canonicalUrl);
    if (metaImage) {
      upsertMeta("og:image", metaImage, true);
      upsertMeta("twitter:image", metaImage);
      upsertMeta("twitter:card", "summary_large_image");
      upsertMeta("og:image:alt", metaImageAlt, true);
      upsertMeta("twitter:image:alt", metaImageAlt);
      if (metaImage.startsWith("https://")) {
        upsertMeta("og:image:secure_url", metaImage, true);
      }
    } else {
      upsertMeta("twitter:card", "summary");
    }

    upsertLink("canonical", canonicalUrl);

    if (isPrivatePath) {
      removeJsonLd();
      return;
    }

    const organizationId = `${baseUrl}/#organization`;
    const websiteId = `${baseUrl}/#website`;
    const webPageId = `${canonicalUrl}#webpage`;

    upsertJsonLd({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": organizationId,
          name: siteName,
          url: `${baseUrl}/`,
          logo: `${baseUrl}/logo.png`,
        },
        {
          "@type": "WebSite",
          "@id": websiteId,
          url: `${baseUrl}/`,
          name: siteName,
          publisher: { "@id": organizationId },
        },
        {
          "@type": "WebPage",
          "@id": webPageId,
          url: canonicalUrl,
          name: safeTitle,
          description: safeDescription,
          inLanguage: lang,
          isPartOf: { "@id": websiteId },
          about: { "@id": organizationId },
        },
      ],
    });
  }, [title, description, type, canonical, robots, keywords, image, imageAlt]);
};
