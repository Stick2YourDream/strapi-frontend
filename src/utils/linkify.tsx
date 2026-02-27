import type { ReactNode } from "react";

const URL_REGEX =
  /\b((?:https?:\/\/)?(?:www\.)?(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?)(?:\/[^\s]*)?/gi;
const TRAILING_PUNCTUATION = /[),.!?]+$/;

const normalizeLink = (raw: string) => {
  const cleaned = raw.replace(TRAILING_PUNCTUATION, "");
  const hasProtocol = /^https?:\/\//i.test(cleaned);
  if (hasProtocol) {
    return { cleaned, href: cleaned };
  }
  const isLocalhost = /^(?:www\.)?localhost(?::\d+)?(?:\/|$)/i.test(cleaned);
  const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/.test(cleaned);
  const protocol = isLocalhost || isIpv4 ? "http" : "https";
  return { cleaned, href: `${protocol}://${cleaned}` };
};

export const linkifyText = (text: string): ReactNode => {
  const safeText = String(text || "");
  if (!safeText) return "";
  const matches = Array.from(safeText.matchAll(URL_REGEX));
  if (!matches.length) return safeText;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((match, index) => {
    const raw = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      nodes.push(safeText.slice(lastIndex, start));
    }

    const prevChar = start > 0 ? safeText[start - 1] : "";
    if (prevChar === "@") {
      nodes.push(raw);
      lastIndex = start + raw.length;
      return;
    }

    const { cleaned, href } = normalizeLink(raw);
    const suffix = raw.slice(cleaned.length);

    nodes.push(
      <a
        key={`${href}-${start}-${index}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => event.stopPropagation()}
      >
        {cleaned}
      </a>
    );

    if (suffix) {
      nodes.push(suffix);
    }

    lastIndex = start + raw.length;
  });

  if (lastIndex < safeText.length) {
    nodes.push(safeText.slice(lastIndex));
  }

  return nodes;
};
