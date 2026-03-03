import axios from "axios";
import api from "../api/strapi";

type UnknownRecord = Record<string, unknown>;

export type NewsArticle = {
  id: string;
  title: string;
  url: string;
  summary?: string;
  image?: string;
  source?: string;
  provider?: string;
  publishedAt?: string;
};

export type NewsAsset = {
  id: string;
  url?: string;
  filename?: string;
  contentType?: string;
  size?: number;
  parentUrl?: string;
};

export type NewsPage = {
  id: string;
  url?: string;
  title?: string;
  finalHtml?: string;
};

export type NewsQueryParams = {
  search?: string;
  source?: string;
  provider?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
};

export type NewsAssetQueryParams = {
  search?: string;
  parent_url?: string;
  content_type?: string;
  filename?: string;
  limit?: number;
  offset?: number;
};

export type NewsPageQueryParams = {
  search?: string;
  url?: string;
  orig_html?: string;
  head_html?: string;
  body_html?: string;
  final_html?: string;
  limit?: number;
  offset?: number;
};

export type NewsReadable = {
  url?: string;
  title?: string;
  author?: string;
  content?: string;
  html?: string;
  text?: string;
  publishedAt?: string;
  source?: string;
  provider?: string;
};

const NEWS_PROXY_PATH = "/news";
const NEWS_PROXY_BASE = String(import.meta.env.VITE_NEWS_PROXY_URL || "")
  .trim()
  .replace(/\/+$/, "");
const NEWS_DIRECT_BASE = (import.meta.env.VITE_NEWS_API_URL ||
  "https://newsapp_backend.rousehouse.net"
).replace(/\/$/, "");
const NEWS_ACCESS_MODE = String(import.meta.env.VITE_NEWS_ACCESS_MODE || "proxy");
const FORCE_READABLE_LIST =
  String(import.meta.env.VITE_NEWS_FORCE_READABLE_LIST || "").toLowerCase() === "true";
type NewsRequestParams = Record<string, string | number | undefined>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});

const readString = (value: unknown) => (typeof value === "string" ? value : undefined);

const readNestedString = (value: unknown, key: string) => {
  if (!isRecord(value)) return undefined;
  return readString(value[key]);
};

const readNamedValue = (value: unknown) => {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  return (
    readString(value.name) ||
    readString(value.title) ||
    readString(value.label) ||
    readString(value.display_name) ||
    readString(value.displayName)
  );
};

const readImageCandidate = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = readImageCandidate(entry);
      if (candidate) return candidate;
    }
  }
  if (isRecord(value)) {
    return (
      readString(value.url) ||
      readString(value.src) ||
      readString(value.image) ||
      readString(value.thumbnail) ||
      readString(value.thumbnail_url) ||
      readString(value.thumbnailUrl)
    );
  }
  return undefined;
};

const stripHtml = (value?: string) => {
  if (!value) return value;
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

const extractImageFromHtml = (value?: string) => {
  if (!value) return undefined;
  const metaMatch =
    value.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    value.match(/<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    value.match(/<meta[^>]+property=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (metaMatch?.[1]) return metaMatch[1];
  const imgMatch = value.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch?.[1];
};

const buildHeaders = () => {
  const apiKey = import.meta.env.VITE_NEWS_API_KEY;
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
};

const shouldUseDirectOnly = NEWS_ACCESS_MODE === "direct";
const canFallbackToDirect =
  NEWS_ACCESS_MODE === "fallback" ||
  (NEWS_ACCESS_MODE === "proxy" &&
    (Boolean(import.meta.env.VITE_NEWS_API_URL) ||
      Boolean(import.meta.env.VITE_NEWS_API_KEY)));

const requestNews = async (
  path: string,
  params?: NewsRequestParams,
  mode: "proxy" | "direct" = "proxy"
) => {
  try {
    const res =
      mode === "direct"
        ? await axios.get(`${NEWS_DIRECT_BASE}${path}`, {
            params,
            headers: buildHeaders(),
          })
        : NEWS_PROXY_BASE
        ? await axios.get(`${NEWS_PROXY_BASE}${path}`, {
            params,
            headers: buildHeaders(),
          })
        : await api.get(`${NEWS_PROXY_PATH}${path}`, {
            params,
            headers: buildHeaders(),
          });
    return res.data;
  } catch (error: any) {
    if (
      mode === "proxy" &&
      canFallbackToDirect &&
      error?.response?.status &&
      error.response.status >= 400
    ) {
      return requestNews(path, params, "direct");
    }
    if (mode === "proxy" && canFallbackToDirect && !error?.response) {
      return requestNews(path, params, "direct");
    }
    throw error;
  }
};

const requestNewsMeta = async (path: string) => {
  if (NEWS_ACCESS_MODE !== "direct") {
    return requestNews(path, undefined, shouldUseDirectOnly ? "direct" : "proxy");
  }
  try {
    return await requestNews(path, undefined, "proxy");
  } catch {
    return requestNews(path, undefined, "direct");
  }
};

const normalizeAssetUrl = (value?: string) => {
  if (!value) return undefined;
  if (value.startsWith("/")) {
    return `${NEWS_DIRECT_BASE}${value}`;
  }
  return value;
};

const normalizeArticle = (item: unknown, index: number): NewsArticle | null => {
  const record = asRecord(item);
  const url =
    readString(record.url) ||
    readString(record.link) ||
    readString(record.article_url) ||
    readString(record.articleUrl) ||
    readString(record.source_url) ||
    readString(record.sourceUrl);
  if (!url) return null;

  const title =
    readString(record.title) ||
    readString(record.headline) ||
    readString(record.name) ||
    readString(record.summary) ||
    url;
  const summaryRaw =
    readString(record.summary) ||
    readString(record.description) ||
    readString(record.excerpt) ||
    readString(record.content);
  const summary =
    summaryRaw && summaryRaw.includes("<") ? stripHtml(summaryRaw) : summaryRaw;
  const image =
    readString(record.image) ||
    readString(record.image_url) ||
    readString(record.imageUrl) ||
    readString(record.urlToImage) ||
    readString(record.url_to_image) ||
    readString(record.thumbnail) ||
    readString(record.thumbnail_url) ||
    readString(record.thumbnailUrl) ||
    readImageCandidate(record.image) ||
    readImageCandidate(record.images) ||
    readImageCandidate(record.media) ||
    readImageCandidate(record.assets) ||
    extractImageFromHtml(summaryRaw) ||
    extractImageFromHtml(readString(record.content)) ||
    extractImageFromHtml(readString(record.description));
  const normalizedImage = normalizeAssetUrl(image);
  const source =
    readNamedValue(record.source) ||
    readNestedString(record.source, "name") ||
    readNestedString(record.source, "title") ||
    readString(record.source_title) ||
    readString(record.source_name) ||
    readString(record.sourceName) ||
    readString(record.feed) ||
    readString(record.feed_title) ||
    readString(record.feedTitle);
  const provider =
    readNamedValue(record.provider) ||
    readNestedString(record.provider, "name") ||
    readNestedString(record.provider, "title") ||
    readString(record.provider_name) ||
    readString(record.providerName) ||
    readString(record.publisher) ||
    readString(record.publisher_name) ||
    readString(record.publisherName);
  const publishedAt =
    readString(record.published_at) ||
    readString(record.publishedAt) ||
    readString(record.date) ||
    readString(record.created_at) ||
    readString(record.createdAt);
  const rawId =
    readString(record.id) || readString(record.article_id) || readString(record.articleId);

  return {
    id: rawId || `${index}-${url}`,
    title,
    url,
    summary,
    image: normalizedImage,
    source,
    provider,
    publishedAt,
  };
};

const extractStatKeys = (payload: unknown, key: "providers" | "sources") => {
  const record = asRecord(payload);
  const data = isRecord(record.data) ? record.data : record;
  const candidate = data[key];
  const readEntry = (entry: unknown) => {
    if (typeof entry === "string") return entry;
    if (!isRecord(entry)) return undefined;
    const primaryKey = key === "providers" ? "provider" : "source";
    return (
      readString(entry[primaryKey]) ||
      readString(entry.name) ||
      readString(entry.value) ||
      readString(entry.label) ||
      readString(entry.id)
    );
  };
  if (Array.isArray(candidate)) {
    return candidate
      .map((entry) => readEntry(entry) || String(entry))
      .filter(Boolean);
  }
  if (isRecord(candidate)) {
    return Object.keys(candidate).filter(Boolean);
  }
  if (Array.isArray(data)) {
    return data
      .map((entry) => readEntry(entry) || String(entry))
      .filter(Boolean);
  }
  if (isRecord(data)) {
    return Object.keys(data).filter(Boolean);
  }
  return [];
};

const extractStatValue = (payload: unknown) => {
  const record = asRecord(payload);
  const data = isRecord(record.data) ? record.data : record;
  if (typeof data === "number") return data;
  if (typeof data === "string") return Number(data) || 0;
  if (Array.isArray(data) && data.length === 1) {
    const value = data[0];
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value) || 0;
  }
  if (isRecord(data)) {
    const value = data.value ?? data.count ?? data.total ?? data.size ?? data.last_updated;
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value) || 0;
  }
  return 0;
};

const readErrorMessage = (payload: unknown) => {
  const record = asRecord(payload);
  const errorCandidate = isRecord(record.error)
    ? record.error
    : isRecord(record.data)
    ? (record.data as UnknownRecord).error
    : undefined;
  if (typeof errorCandidate === "string") return errorCandidate;
  if (isRecord(errorCandidate)) {
    return (
      readString(errorCandidate.message) ||
      readString(errorCandidate.detail) ||
      readString(errorCandidate.error) ||
      undefined
    );
  }
  return undefined;
};

const throwIfError = (payload: unknown) => {
  const message = readErrorMessage(payload);
  if (message) {
    throw new Error(message);
  }
};

const extractStatString = (payload: unknown) => {
  const record = asRecord(payload);
  const data = isRecord(record.data) ? record.data : record;
  if (typeof data === "string") return data;
  if (isRecord(data)) {
    const value = data.value ?? data.last_updated ?? data.lastUpdated;
    return typeof value === "string" ? value : "";
  }
  return "";
};

export const fetchNewsArticles = async (params: NewsQueryParams) => {
  const mode = shouldUseDirectOnly ? "direct" : "proxy";
  const useReadableList = FORCE_READABLE_LIST;
  const primaryPath = useReadableList ? "/articles/readable" : "/articles";
  try {
    const payload = await requestNews(primaryPath, params, mode);
    throwIfError(payload);
    const rows = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.articles)
      ? payload.articles
      : Array.isArray(payload)
      ? payload
      : [];
    const mapped = rows
      .map((item: unknown, index: number) => normalizeArticle(item, index))
      .filter(Boolean) as NewsArticle[];
    return mapped;
  } catch (error) {
    if (!useReadableList) {
      throw error;
    }
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 400 || status === 422) {
        const payload = await requestNews("/articles", params, mode);
        throwIfError(payload);
        const rows = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.articles)
          ? payload.articles
          : Array.isArray(payload)
          ? payload
          : [];
        return rows
          .map((item: unknown, index: number) => normalizeArticle(item, index))
          .filter(Boolean) as NewsArticle[];
      }
    }
    throw error;
  }
};

export const fetchNewsProviders = async () => {
  const payload = await requestNews(
    "/stats/providers",
    undefined,
    shouldUseDirectOnly ? "direct" : "proxy"
  );
  throwIfError(payload);
  return extractStatKeys(payload, "providers");
};

export const fetchNewsSources = async () => {
  const payload = await requestNews(
    "/stats/sources",
    undefined,
    shouldUseDirectOnly ? "direct" : "proxy"
  );
  throwIfError(payload);
  return extractStatKeys(payload, "sources");
};

export const fetchNewsContentTypes = async () => {
  const payload = await requestNewsMeta("/stats/content_types");
  throwIfError(payload);
  const record = asRecord(payload);
  const data = isRecord(record.data) ? record.data : record;
  if (Array.isArray(data)) return data.map((item) => String(item)).filter(Boolean);
  if (isRecord(data)) return Object.keys(data).filter(Boolean);
  return [];
};

export const fetchNewsAssetCount = async () => {
  const payload = await requestNewsMeta("/stats/asset_count");
  throwIfError(payload);
  return extractStatValue(payload);
};

export const fetchNewsArticleCount = async () => {
  const payload = await requestNewsMeta("/stats/article_count");
  throwIfError(payload);
  return extractStatValue(payload);
};

export const fetchNewsPageCount = async () => {
  const payload = await requestNewsMeta("/stats/page_count");
  throwIfError(payload);
  return extractStatValue(payload);
};

export const fetchNewsAssetSize = async () => {
  const payload = await requestNewsMeta("/stats/asset_size");
  throwIfError(payload);
  return extractStatValue(payload);
};

export const fetchNewsArticleSize = async () => {
  const payload = await requestNewsMeta("/stats/article_size");
  throwIfError(payload);
  return extractStatValue(payload);
};

export const fetchNewsPageSize = async () => {
  const payload = await requestNewsMeta("/stats/page_size");
  throwIfError(payload);
  return extractStatValue(payload);
};

export const fetchNewsLastUpdated = async () => {
  const payload = await requestNewsMeta("/stats/last_updated");
  throwIfError(payload);
  return extractStatString(payload);
};

const normalizeAsset = (item: unknown, index: number): NewsAsset => {
  const record = asRecord(item);
  return {
    id: readString(record.id) || `${index}`,
    url: normalizeAssetUrl(
      readString(record.url) ||
        readString(record.asset_url) ||
        readString(record.assetUrl)
    ),
    filename: readString(record.filename) || readString(record.name),
    contentType:
      readString(record.content_type) || readString(record.contentType),
    size:
      typeof record.size === "number"
        ? record.size
        : Number(record.size) || undefined,
    parentUrl:
      readString(record.parent_url) || readString(record.parentUrl),
  };
};

export const fetchNewsAssets = async (params: NewsAssetQueryParams) => {
  const payload = await requestNews(
    "/assets",
    params,
    shouldUseDirectOnly ? "direct" : "proxy"
  );
  throwIfError(payload);
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.assets)
    ? payload.assets
    : Array.isArray(payload)
    ? payload
    : [];
  return rows.map((item: unknown, index: number) => normalizeAsset(item, index));
};

const normalizePage = (item: unknown, index: number): NewsPage => {
  const record = asRecord(item);
  return {
    id: readString(record.id) || `${index}`,
    url: readString(record.url),
    title: readString(record.title),
    finalHtml:
      readString(record.final_html) ||
      readString(record.finalHtml) ||
      readString(record.body_html) ||
      readString(record.bodyHtml),
  };
};

export const fetchNewsPages = async (params: NewsPageQueryParams) => {
  const payload = await requestNews(
    "/pages",
    params,
    shouldUseDirectOnly ? "direct" : "proxy"
  );
  throwIfError(payload);
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.pages)
    ? payload.pages
    : Array.isArray(payload)
    ? payload
    : [];
  return rows.map((item: unknown, index: number) => normalizePage(item, index));
};

export const fetchNewsReadable = async (url: string, home?: string) => {
  const payload = await requestNews(
    "/articles/readable",
    { url, home },
    shouldUseDirectOnly ? "direct" : "proxy"
  );
  throwIfError(payload);
  if (typeof payload === "string") {
    return { url, html: payload } as NewsReadable;
  }
  if (isRecord(payload) && typeof payload.data === "string") {
    return { url, html: payload.data } as NewsReadable;
  }
  const record = asRecord(payload?.data) ? asRecord(payload.data) : asRecord(payload);
  return {
    url: readString(record.url) || url,
    title:
      readString(record.title) ||
      readString(record.headline) ||
      readString(record.name) ||
      undefined,
    author:
      readString(record.author) ||
      readString(record.byline) ||
      readString(record.creator) ||
      undefined,
    content:
      readString(record.content) ||
      readString(record.text) ||
      readString(record.summary) ||
      readString(record.description) ||
      undefined,
    html:
      readString(record.html) ||
      readString(record.body_html) ||
      readString(record.bodyHtml) ||
      readString(record.final_html) ||
      readString(record.finalHtml) ||
      undefined,
    text: readString(record.text) || undefined,
    publishedAt:
      readString(record.publishedAt) ||
      readString(record.published_at) ||
      readString(record.date) ||
      readString(record.created_at) ||
      readString(record.createdAt),
    source: readNamedValue(record.source) || readString(record.source),
    provider: readString(record.provider) || undefined,
  } as NewsReadable;
};
