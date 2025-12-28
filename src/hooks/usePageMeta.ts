import { useEffect } from "react";

type MetaOptions = {
  title: string;
  description: string;
  type?: string;
  canonical?: string;
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

export const usePageMeta = ({ title, description, type, canonical }: MetaOptions) => {
  useEffect(() => {
    const safeTitle = title.trim();
    const safeDescription = description.trim();
    document.title = safeTitle;

    upsertMeta("description", safeDescription);
    upsertMeta("og:title", safeTitle, true);
    upsertMeta("og:description", safeDescription, true);
    upsertMeta("og:type", type || "website", true);
    upsertMeta("og:url", canonical || window.location.href, true);
    upsertMeta("twitter:title", safeTitle);
    upsertMeta("twitter:description", safeDescription);

    const canonicalUrl = canonical || window.location.href;
    upsertLink("canonical", canonicalUrl);
  }, [title, description, type, canonical]);
};
