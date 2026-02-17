import { useEffect } from "react";

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

const upsertLink = (rel: string, href: string) => {
  let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", rel);
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
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
    const canonicalUrl = canonical
      ? buildAbsoluteUrl(baseUrl, canonical.trim())
      : `${baseUrl}${window.location.pathname || "/"}`;
    const metaImage = (image || "").trim() || `${baseUrl}/logo.png`;
    const metaImageAlt = (imageAlt || safeTitle).trim();
    const lang = (document.documentElement.lang || "en").toLowerCase();
    const ogLocale = lang.includes("-")
      ? lang.replace("-", "_")
      : lang === "en"
      ? "en_US"
      : lang;
    document.title = safeTitle;

    upsertMeta("description", safeDescription);
    upsertMeta(
      "robots",
      robots || "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
    );
    if (keywords) {
      upsertMeta("keywords", keywords);
    }
    upsertMeta("og:title", safeTitle, true);
    upsertMeta("og:description", safeDescription, true);
    upsertMeta("og:type", type || "website", true);
    upsertMeta("og:site_name", siteName, true);
    upsertMeta("og:locale", ogLocale, true);
    upsertMeta("og:url", canonicalUrl, true);
    upsertMeta("twitter:title", safeTitle);
    upsertMeta("twitter:description", safeDescription);
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
  }, [title, description, type, canonical, robots, keywords, image, imageAlt]);
};
