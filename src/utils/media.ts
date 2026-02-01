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
    return `${base}${value}`;
  }
  return value;
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
