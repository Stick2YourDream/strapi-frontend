type MediaFormat = {
  url?: string;
  width?: number;
  height?: number;
};

type MediaFormats = {
  thumbnail?: MediaFormat;
  small?: MediaFormat;
  medium?: MediaFormat;
  large?: MediaFormat;
};

type MediaCandidate = {
  url?: string;
  formats?: MediaFormats;
};

export type MediaPickKind = "avatar" | "post" | "cover" | "original";
export type MediaPickSize = keyof MediaFormats | "original";

type MediaPickOptions = {
  kind?: MediaPickKind;
  size?: MediaPickSize;
  apiBase?: string;
};

const DEFAULT_PICK_ORDER: Record<MediaPickKind, MediaPickSize[]> = {
  avatar: ["thumbnail", "small", "medium", "large", "original"],
  post: ["large", "original", "medium", "small", "thumbnail"],
  cover: ["large", "medium", "small", "thumbnail", "original"],
  original: ["original", "large", "medium", "small", "thumbnail"],
};

const resolveApiBase = () => (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
const resolveMediaBase = () => String(import.meta.env.VITE_MEDIA_BASE_URL || "").trim();
const shouldRewriteToOrigin =
  String(import.meta.env.VITE_MEDIA_REWRITE_TO_ORIGIN || "").toLowerCase() === "true";

const normalizeMediaEntry = (entry: any) => {
  if (typeof entry === "string") return { url: entry };
  return entry?.attributes ?? entry ?? {};
};

const resolveCandidate = (mediaField: any) => {
  if (!mediaField) return null;
  const data = mediaField?.data ?? mediaField;
  const candidate = Array.isArray(data) ? data[0] : data;
  return candidate ?? (Array.isArray(mediaField) ? mediaField[0] : null);
};

const toAbsoluteUrl = (value?: string, apiBase?: string) => {
  if (!value) return undefined;
  if (value.startsWith("/")) {
    const base = apiBase ?? resolveApiBase();
    return base ? `${base}${value}` : value;
  }
  try {
    const url = new URL(value);
    const mediaBase = resolveMediaBase();
    if (mediaBase && url.pathname.startsWith("/uploads/")) {
      if (mediaBase.startsWith("/")) {
        return `${window.location.origin}${mediaBase}${url.pathname}${url.search}`.replace(
          /\/{2,}/g,
          "/"
        );
      }
      return `${mediaBase.replace(/\/+$/, "")}${url.pathname}${url.search}`;
    }
    if (typeof window !== "undefined") {
      const currentHost = window.location.hostname;
      const currentPort = window.location.port;
      const currentProtocol = window.location.protocol;
      const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      const isCurrentLocal = currentHost === "localhost" || currentHost === "127.0.0.1";
      if (isLocalHost && !isCurrentLocal) {
        url.protocol = currentProtocol;
        url.hostname = currentHost;
        url.port = currentPort;
        return url.toString();
      }
      if (shouldRewriteToOrigin && url.pathname.startsWith("/uploads/")) {
        return `${window.location.origin}${url.pathname}${url.search}`;
      }
      if (url.hostname === currentHost) {
        if (url.protocol !== currentProtocol) {
          url.protocol = currentProtocol;
        }
        if (currentPort && url.port !== currentPort) {
          url.port = currentPort;
        }
        return url.toString();
      }
    }
    return url.toString();
  } catch {
    return value;
  }
};

const resolveMediaUrls = (mediaField: any, apiBase?: string) => {
  const candidate = resolveCandidate(mediaField);
  if (!candidate) return null;
  const attrs = normalizeMediaEntry(candidate) as MediaCandidate;
  const formats = attrs.formats ?? {};
  return {
    original: toAbsoluteUrl(attrs.url, apiBase),
    thumbnail: toAbsoluteUrl(formats.thumbnail?.url, apiBase),
    small: toAbsoluteUrl(formats.small?.url, apiBase),
    medium: toAbsoluteUrl(formats.medium?.url, apiBase),
    large: toAbsoluteUrl(formats.large?.url, apiBase),
  };
};

export const pickMediaUrl = (mediaField: any, options: MediaPickOptions = {}) => {
  const urls = resolveMediaUrls(mediaField, options.apiBase);
  if (!urls) return undefined;
  if (options.size) {
    return urls[options.size] ?? urls.original;
  }
  const order = DEFAULT_PICK_ORDER[options.kind || "post"];
  for (const key of order) {
    const value = urls[key];
    if (value) return value;
  }
  return undefined;
};

export const pickMediaUrls = (
  mediaField: any,
  options: MediaPickOptions = {}
): string[] => {
  if (!mediaField) return [];
  const data = mediaField?.data ?? mediaField;
  const items = Array.isArray(data) ? data : Array.isArray(mediaField) ? mediaField : [];
  if (!Array.isArray(items)) return [];
  return items
    .map((entry) => pickMediaUrl(entry, options))
    .filter((url): url is string => typeof url === "string");
};
