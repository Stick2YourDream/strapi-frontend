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
    document.title = safeTitle;

    upsertMeta("description", safeDescription);
    upsertMeta("robots", robots || "index, follow");
    if (keywords) {
      upsertMeta("keywords", keywords);
    }
    upsertMeta("og:title", safeTitle, true);
    upsertMeta("og:description", safeDescription, true);
    upsertMeta("og:type", type || "website", true);
    upsertMeta("og:url", canonical || window.location.href, true);
    upsertMeta("twitter:title", safeTitle);
    upsertMeta("twitter:description", safeDescription);
    if (image) {
      upsertMeta("og:image", image, true);
      upsertMeta("twitter:image", image);
      upsertMeta("twitter:card", "summary_large_image");
      const altText = imageAlt || safeTitle;
      upsertMeta("og:image:alt", altText, true);
      upsertMeta("twitter:image:alt", altText);
    }

    const canonicalUrl = canonical || window.location.href;
    upsertLink("canonical", canonicalUrl);
  }, [title, description, type, canonical, robots, keywords, image, imageAlt]);
};
