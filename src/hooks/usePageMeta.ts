import { useEffect, useState } from "react";
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

type LiveSeoOverride = {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  keywords: string[];
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const SEO_JSONLD_ID = "app-seo-jsonld";
const LIVE_SEO_CACHE_MS = 60_000;
const liveSeoCache = new Map<string, { expiresAt: number; config: LiveSeoOverride | null }>();

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

const resolveApiBaseForSeo = () => {
  const raw = String(import.meta.env.VITE_API_URL || "").trim();
  if (typeof window === "undefined") {
    return raw || "http://localhost:1337/api";
  }
  if (!raw) return "/api";
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?/i.test(raw);
  if (isLocalTarget && !isLocalHost) return "/api";
  return raw;
};

const normalizeLiveSeoConfig = (value: unknown): LiveSeoOverride | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const keywords = Array.isArray(source.keywords)
    ? source.keywords
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const title = String(source.title || "").trim();
  const description = String(source.description || "").trim();
  const canonical = String(source.canonical || "").trim();
  const robots = String(source.robots || "").trim();
  if (!title && !description && !canonical && !robots && !keywords.length) {
    return null;
  }
  return {
    title,
    description,
    canonical,
    robots,
    keywords,
  };
};

const buildLiveSeoEndpoint = (path: string) => {
  const apiBase = trimTrailingSlash(resolveApiBaseForSeo());
  const safePath = normalizePath(path);
  return `${apiBase}/seo/live-config?path=${encodeURIComponent(safePath)}`;
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
  const currentPath = normalizePath(window.location.pathname || "/");
  const [liveOverride, setLiveOverride] = useState<LiveSeoOverride | null>(null);

  useEffect(() => {
    if (isPrivateSeoPath(currentPath)) {
      setLiveOverride(null);
      return;
    }

    const endpoint = buildLiveSeoEndpoint(currentPath);
    const cached = liveSeoCache.get(endpoint);
    if (cached && cached.expiresAt > Date.now()) {
      setLiveOverride(cached.config);
      return;
    }

    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          liveSeoCache.set(endpoint, {
            expiresAt: Date.now() + LIVE_SEO_CACHE_MS,
            config: null,
          });
          setLiveOverride(null);
          return;
        }
        const payload = (await response.json()) as { config?: unknown } | null;
        const config = normalizeLiveSeoConfig(payload?.config);
        liveSeoCache.set(endpoint, {
          expiresAt: Date.now() + LIVE_SEO_CACHE_MS,
          config,
        });
        setLiveOverride(config);
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        setLiveOverride(null);
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, [currentPath]);

  useEffect(() => {
    const fallbackTitle = title.trim();
    const fallbackDescription = description.trim();
    const safeTitle = (liveOverride?.title || fallbackTitle).trim();
    const safeDescription = (liveOverride?.description || fallbackDescription).trim();
    const siteName = String(import.meta.env.VITE_APP_NAME || "").trim() || "Your Social Place";
    const baseUrlRaw = String(import.meta.env.VITE_PUBLIC_SITE_URL || "").trim();
    const baseUrl = baseUrlRaw ? trimTrailingSlash(baseUrlRaw) : window.location.origin;
    const isPrivatePath = isPrivateSeoPath(currentPath);
    const canonicalOverride = String(liveOverride?.canonical || "").trim();
    const canonicalSource = canonicalOverride || canonical?.trim() || currentPath;
    const canonicalUrl = buildAbsoluteUrl(baseUrl, canonicalSource);
    const robotsDirectives = isPrivatePath
      ? NOINDEX_ROBOTS_DIRECTIVES
      : (liveOverride?.robots || robots || DEFAULT_ROBOTS_DIRECTIVES).trim();
    const keywordsContent =
      liveOverride?.keywords?.length
        ? liveOverride.keywords.join(", ")
        : keywords?.trim();
    const metaImage = buildAbsoluteUrl(baseUrl, (image || "/logo2.png").trim());
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
          logo: `${baseUrl}/logo2.png`,
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
  }, [title, description, type, canonical, robots, keywords, image, imageAlt, currentPath, liveOverride]);
};
