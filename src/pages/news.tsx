// src/pages/news.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/dashboard.css";
import "../css/news.css";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { usePageMeta } from "../hooks/usePageMeta";
import {
  fetchNewsArticles,
  fetchNewsAssets,
  fetchNewsArticleCount,
  fetchNewsArticleSize,
  fetchNewsAssetCount,
  fetchNewsAssetSize,
  fetchNewsContentTypes,
  fetchNewsLastUpdated,
  fetchNewsPageCount,
  fetchNewsPageSize,
  fetchNewsPages,
  fetchNewsProviders,
  fetchNewsReadable,
  fetchNewsSources,
  type NewsArticle,
  type NewsAsset,
  type NewsReadable,
} from "../utils/news-api";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 400;
const IMAGE_LOOKUP_LIMIT = 12;

const QUICK_TOPICS = [
  "Community",
  "Technology",
  "Health",
  "Business",
  "Sports",
  "Entertainment",
  "Science",
  "World",
];

const FEMALE_VOICE_HINTS = [
  "female",
  "woman",
  "zira",
  "samantha",
  "victoria",
  "karen",
  "jenny",
  "tessa",
  "joanna",
  "amy",
  "emma",
];

const MALE_VOICE_HINTS = [
  "male",
  "man",
  "david",
  "alex",
  "mark",
  "daniel",
  "john",
  "guy",
  "fred",
  "tom",
];

const formatRelativeTime = (value?: string | Date | null) => {
  if (!value) return "Updated just now";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated just now";
  const diffMs = Date.now() - date.getTime();
  if (diffMs <= 0) return "Updated just now";
  if (diffMs < 60000) return "Updated just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
};

const formatNewsTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  if (diffMs <= 0) return "Just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatBytes = (value?: number) => {
  if (!value || !Number.isFinite(value)) return "0 MB";
  const mb = value / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

const sortArticlesByPublishedAt = (
  items: NewsArticle[],
  order: "newest" | "oldest"
) => {
  const factor = order === "newest" ? -1 : 1;
  return [...items].sort((a, b) => {
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return (aTime - bTime) * factor;
  });
};

const mergeOptions = (primary: string[], fallback: string[], selected?: string) => {
  const set = new Set<string>();
  primary.forEach((value) => value && set.add(value));
  fallback.forEach((value) => value && set.add(value));
  if (selected) set.add(selected);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i;

const isImageAsset = (asset: NewsAsset) => {
  if (asset.contentType?.startsWith("image/")) return true;
  if (asset.url && IMAGE_EXT_PATTERN.test(asset.url)) return true;
  if (asset.filename && IMAGE_EXT_PATTERN.test(asset.filename)) return true;
  return false;
};

export default function News() {
  const navigate = useNavigate();
  const { profile, appSettings } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const profileNewsEnabled = profile?.notificationSettings?.newsEnabled !== false;
  const newsroomEnabled = appSettings?.newsroomEnabled !== false;
  const newsEnabled = profileNewsEnabled && newsroomEnabled;

  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [source, setSource] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [maxPageSeen, setMaxPageSeen] = useState(1);
  const [providers, setProviders] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [contentTypes, setContentTypes] = useState<string[]>([]);
  const [articleCount, setArticleCount] = useState(0);
  const [assetCount, setAssetCount] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [articleSize, setArticleSize] = useState(0);
  const [assetSize, setAssetSize] = useState(0);
  const [pageSize, setPageSize] = useState(0);
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<string>("");
  const [statsError, setStatsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeArticle, setActiveArticle] = useState<NewsArticle | null>(null);
  const [readableArticle, setReadableArticle] = useState<NewsReadable | null>(null);
  const [readableLoading, setReadableLoading] = useState(false);
  const [readableError, setReadableError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [speechRate, setSpeechRate] = useState(1);
  const [isReading, setIsReading] = useState(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const loadIdRef = useRef(0);
  const imageCacheRef = useRef<Record<string, string>>({});
  const lastFilterKeyRef = useRef("");
  const lastPageRef = useRef(1);
  const speechIndexRef = useRef(0);
  const speechTextRef = useRef("");
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  usePageMeta({
    title: "Newsroom | Your Social Place",
    description:
      "Explore curated headlines, trending topics, and shareable stories from the Your Social Place community.",
    type: "website",
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    if (!newsEnabled) return;
    let active = true;

    const loadMeta = async () => {
      try {
        const results = await Promise.allSettled([
          fetchNewsProviders(),
          fetchNewsSources(),
          fetchNewsContentTypes(),
          fetchNewsArticleCount(),
          fetchNewsAssetCount(),
          fetchNewsPageCount(),
          fetchNewsArticleSize(),
          fetchNewsAssetSize(),
          fetchNewsPageSize(),
          fetchNewsLastUpdated(),
        ]);
        if (!active) return;
        const [
          providerResult,
          sourceResult,
          contentTypeResult,
          articleCountResult,
          assetCountResult,
          pageCountResult,
          articleSizeResult,
          assetSizeResult,
          pageSizeResult,
          lastUpdatedResult,
        ] = results;
        const hasAnyStats = results.some((result) => result.status === "fulfilled");
        setStatsError(hasAnyStats ? null : "Stats are temporarily unavailable.");

        if (providerResult.status === "fulfilled") {
          const providerList = providerResult.value as string[];
          setProviders(
            Array.from(new Set(providerList)).sort((a, b) => a.localeCompare(b))
          );
        }
        if (sourceResult.status === "fulfilled") {
          const sourceList = sourceResult.value as string[];
          setSources(
            Array.from(new Set(sourceList)).sort((a, b) => a.localeCompare(b))
          );
        }
        if (contentTypeResult.status === "fulfilled") {
          const contentTypeList = contentTypeResult.value as string[];
          setContentTypes(
            Array.from(new Set(contentTypeList)).sort((a, b) => a.localeCompare(b))
          );
        }
        if (articleCountResult.status === "fulfilled") {
          setArticleCount((articleCountResult.value as number) || 0);
        }
        if (assetCountResult.status === "fulfilled") {
          setAssetCount((assetCountResult.value as number) || 0);
        }
        if (pageCountResult.status === "fulfilled") {
          setPageCount((pageCountResult.value as number) || 0);
        }
        if (articleSizeResult.status === "fulfilled") {
          setArticleSize((articleSizeResult.value as number) || 0);
        }
        if (assetSizeResult.status === "fulfilled") {
          setAssetSize((assetSizeResult.value as number) || 0);
        }
        if (pageSizeResult.status === "fulfilled") {
          setPageSize((pageSizeResult.value as number) || 0);
        }
        if (lastUpdatedResult.status === "fulfilled") {
          setStatsUpdatedAt((lastUpdatedResult.value as string) || "");
        }
      } catch {
        if (active) {
          setStatsError("Stats are temporarily unavailable.");
        }
      }
    };

    loadMeta();
    return () => {
      active = false;
    };
  }, [newsEnabled]);

  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!speechSupported) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length) {
        setVoices(list);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === loadVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [speechSupported]);

  const preferredVoice = useMemo(() => {
    if (!voices.length) return null;
    const hints = voiceGender === "female" ? FEMALE_VOICE_HINTS : MALE_VOICE_HINTS;
    const candidates = voices.filter((voice) => voice.lang?.startsWith("en"));
    const list = candidates.length ? candidates : voices;
    const match = list.find((voice) => {
      const value = `${voice.name} ${voice.voiceURI}`.toLowerCase();
      return hints.some((hint) => value.includes(hint));
    });
    return match || list[0] || null;
  }, [voiceGender, voices]);

  const stopSpeech = useCallback(() => {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    speechUtteranceRef.current = null;
    speechIndexRef.current = 0;
    setIsReading(false);
    setIsSpeechPaused(false);
  }, [speechSupported]);

  const loadArticles = useCallback(
    async (page: number) => {
      if (!newsEnabled) return;
      const loadId = ++loadIdRef.current;
      setLoading(true);
      setError(null);
      const safePage = Math.max(1, page);
      const nextOffset = (safePage - 1) * PAGE_SIZE;
      try {
        const items = await fetchNewsArticles({
          search: query || undefined,
          provider: provider || undefined,
          source: source || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        const sortedItems = sortArticlesByPublishedAt(items, sortOrder);
        setArticles(sortedItems);
        setHasMore(items.length >= PAGE_SIZE);
        setMaxPageSeen((prev) => {
          const nextValue = items.length >= PAGE_SIZE ? safePage + 1 : safePage;
          return Math.max(prev, nextValue);
        });
        setLastUpdated(new Date());

        const hydrateImages = async () => {
          const missing = items
            .filter((article) => !article.image && article.url)
            .slice(0, IMAGE_LOOKUP_LIMIT);
          if (!missing.length) return;
          const queue = [...missing];
          const workerCount = Math.min(4, queue.length);
          const workers = Array.from({ length: workerCount }, async () => {
            while (queue.length) {
              const article = queue.shift();
              if (!article?.url) continue;
              const cached = imageCacheRef.current[article.url];
              if (cached) {
                if (loadId === loadIdRef.current) {
                  setArticles((prev) =>
                    prev.map((entry) =>
                      entry.url === article.url && !entry.image
                        ? { ...entry, image: cached }
                        : entry
                    )
                  );
                }
                continue;
              }
              try {
                const assets = await fetchNewsAssets({
                  parent_url: article.url,
                  limit: 4,
                  offset: 0,
                });
                const imageUrl = assets.find((asset: NewsAsset) => isImageAsset(asset))
                  ?.url;
                if (imageUrl) {
                  imageCacheRef.current[article.url] = imageUrl;
                  if (loadId === loadIdRef.current) {
                    setArticles((prev) =>
                      prev.map((entry) =>
                        entry.url === article.url && !entry.image
                          ? { ...entry, image: imageUrl }
                          : entry
                      )
                    );
                  }
                }
              } catch {
                // ignore asset lookup failures
              }
            }
          });
          await Promise.all(workers);
        };

        void hydrateImages();
      } catch {
        setError("Unable to load headlines right now.");
      } finally {
        setLoading(false);
      }
    },
    [endDate, newsEnabled, provider, query, source, startDate, sortOrder]
  );

  useEffect(() => {
    if (!activeArticle?.url) {
      setReadableArticle(null);
      setReadableError(null);
      setReadableLoading(false);
      return;
    }
    let active = true;
    const articleUrl = activeArticle.url;
    const hydrateFromPages = async (base?: NewsReadable | null) => {
      const pages = await fetchNewsPages({ url: articleUrl, limit: 1, offset: 0 });
      const page = pages[0];
      if (!page?.finalHtml) return false;
      if (!active) return true;
      setReadableArticle({
        ...(base || {}),
        url: base?.url || articleUrl,
        title: base?.title || activeArticle?.title,
        publishedAt: base?.publishedAt || activeArticle?.publishedAt,
        source: base?.source || activeArticle?.source,
        provider: base?.provider || activeArticle?.provider,
        html: page.finalHtml,
      });
      return true;
    };
    setReadableLoading(true);
    setReadableError(null);
    stopSpeech();
    const loadReadable = async () => {
      try {
        const result = await fetchNewsReadable(articleUrl);
        if (!active) return;
        const hasBody = Boolean(result?.text || result?.content || result?.html);
        if (hasBody) {
          setReadableArticle(result);
          return;
        }
        const hydrated = await hydrateFromPages(result);
        if (!hydrated) {
          setReadableArticle(result);
          setReadableError("Unable to load the read-only view.");
        }
      } catch {
        if (!active) return;
        try {
          const hydrated = await hydrateFromPages(null);
          if (!hydrated) {
            setReadableArticle(null);
            setReadableError("Unable to load the read-only view.");
          }
        } catch {
          if (!active) return;
          setReadableArticle(null);
          setReadableError("Unable to load the read-only view.");
        }
      } finally {
        if (!active) return;
        setReadableLoading(false);
      }
    };
    void loadReadable();
    return () => {
      active = false;
    };
  }, [activeArticle, stopSpeech]);

  useEffect(() => {
    if (!newsEnabled) return;
    setCurrentPage(1);
    setMaxPageSeen(1);
  }, [query, provider, source, startDate, endDate, sortOrder, newsEnabled]);

  const filterKey = `${query}|${provider}|${source}|${startDate}|${endDate}|${sortOrder}`;

  useEffect(() => {
    if (!newsEnabled) return;
    const filterChanged = lastFilterKeyRef.current !== filterKey;
    const pageChanged = lastPageRef.current !== currentPage;
    if (!filterChanged && !pageChanged) return;
    const delay = filterChanged ? SEARCH_DEBOUNCE_MS : 0;
    const handle = window.setTimeout(() => {
      lastFilterKeyRef.current = filterKey;
      lastPageRef.current = currentPage;
      loadArticles(currentPage);
    }, delay);
    return () => window.clearTimeout(handle);
  }, [currentPage, filterKey, loadArticles, newsEnabled]);

  useEffect(() => {
    if (newsEnabled) return;
    lastFilterKeyRef.current = "";
    lastPageRef.current = 1;
  }, [newsEnabled]);

  const clearFilters = () => {
    setQuery("");
    setProvider("");
    setSource("");
    setStartDate("");
    setEndDate("");
  };

  const filterSummary = useMemo(() => {
    const parts = [];
    if (provider) parts.push(provider);
    if (source) parts.push(source);
    if (startDate || endDate) parts.push("Date range");
    return parts.length ? parts.join(" | ") : "All sources";
  }, [provider, source, startDate, endDate]);
  const isFiltered = Boolean(query || provider || source || startDate || endDate);
  const totalPages = useMemo(() => {
    if (!isFiltered && articleCount > 0) {
      return Math.max(1, Math.ceil(articleCount / PAGE_SIZE));
    }
    return Math.max(1, maxPageSeen);
  }, [articleCount, isFiltered, maxPageSeen]);
  const canGoNext = isFiltered ? hasMore : currentPage < totalPages;
  const pageItems = useMemo(() => {
    if (totalPages <= 1) return [1];
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, currentPage - 2);
    const end = Math.min(totalPages - 1, currentPage + 2);
    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) {
      items.push(page);
    }
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);
    return items;
  }, [currentPage, totalPages]);
  const derivedProviders = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((article) => {
      if (article.provider) set.add(article.provider);
    });
    return Array.from(set);
  }, [articles]);
  const derivedSources = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((article) => {
      if (article.source) set.add(article.source);
    });
    return Array.from(set);
  }, [articles]);
  const providerOptions = useMemo(
    () => mergeOptions(providers, derivedProviders, provider),
    [derivedProviders, provider, providers]
  );
  const sourceOptions = useMemo(
    () => mergeOptions(sources, derivedSources, source),
    [derivedSources, source, sources]
  );
  const statsUpdatedLabel = statsUpdatedAt
    ? formatRelativeTime(statsUpdatedAt)
    : "Updating";
  const statsUnavailable = Boolean(statsError);
  const articleCountDisplay = statsUnavailable
    ? articles.length
      ? `${articles.length}+`
      : "--"
    : articleCount.toLocaleString();
  const assetCountDisplay = statsUnavailable ? "--" : assetCount.toLocaleString();
  const pageCountDisplay = statsUnavailable ? "--" : pageCount.toLocaleString();
  const catalogCountDisplay = statsUnavailable
    ? "--"
    : contentTypes.length
    ? contentTypes.length
    : "-";

  const topStories = useMemo(() => {
    if (!articles.length) return [];
    const sorted = sortArticlesByPublishedAt(articles, "newest");
    return sorted.slice(0, 4);
  }, [articles]);
  const topStoryIds = useMemo(
    () => new Set(topStories.map((article) => article.id)),
    [topStories]
  );
  const mainArticles = useMemo(
    () => articles.filter((article) => !topStoryIds.has(article.id)),
    [articles, topStoryIds]
  );

  const readableTitle = readableArticle?.title || activeArticle?.title || "Article";
  const readableAuthor = readableArticle?.author;
  const readableMetaLine = useMemo(() => {
    const meta = [
      readableArticle?.source || activeArticle?.source,
      readableArticle?.provider || activeArticle?.provider,
    ].filter(Boolean);
    return meta.length ? meta.join(" | ") : "Daily Signal";
  }, [activeArticle?.provider, activeArticle?.source, readableArticle?.provider, readableArticle?.source]);
  const readableTime = formatNewsTime(
    readableArticle?.publishedAt || activeArticle?.publishedAt
  );
  const readableText = useMemo(() => {
    const rawText =
      readableArticle?.text ||
      readableArticle?.content ||
      readableArticle?.html ||
      activeArticle?.summary ||
      "";
    if (!rawText) return "";
    if (rawText.includes("<") && typeof window !== "undefined") {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawText, "text/html");
        return (doc.body?.innerText || doc.body?.textContent || "")
          .replace(/\s+\n/g, "\n")
          .trim();
      } catch {
        return rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    return rawText.replace(/\s+\n/g, "\n").trim();
  }, [activeArticle?.summary, readableArticle?.content, readableArticle?.html, readableArticle?.text]);
  const readableParagraphs = useMemo(() => {
    if (!readableText) return [];
    return readableText
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }, [readableText]);
  const fallbackParagraphs = useMemo(() => {
    if (readableParagraphs.length) return readableParagraphs;
    if (activeArticle?.summary) return [activeArticle.summary];
    return [];
  }, [activeArticle?.summary, readableParagraphs]);
  const hasFallbackParagraphs = fallbackParagraphs.length > 0;

  useEffect(() => {
    speechTextRef.current = readableText;
    speechIndexRef.current = 0;
    if (!readableText) {
      stopSpeech();
    }
  }, [readableText, stopSpeech]);

  const startSpeech = useCallback(
    (startIndex = 0, rateOverride?: number) => {
      if (!speechSupported) return;
      const text = readableText.trim();
      if (!text) return;
      const startAt = Math.max(0, Math.min(startIndex, text.length));
      const utterance = new SpeechSynthesisUtterance(text.slice(startAt));
      const rate = typeof rateOverride === "number" ? rateOverride : speechRate;
      utterance.rate = rate;
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      utterance.onboundary = (event) => {
        if (typeof event.charIndex === "number") {
          speechIndexRef.current = startAt + event.charIndex;
        }
      };
      utterance.onend = () => {
        setIsReading(false);
        setIsSpeechPaused(false);
        speechIndexRef.current = 0;
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      speechUtteranceRef.current = utterance;
      setIsReading(true);
      setIsSpeechPaused(false);
    },
    [preferredVoice, readableText, speechRate, speechSupported]
  );

  const togglePauseSpeech = useCallback(() => {
    if (!speechSupported) return;
    if (!isReading) {
      startSpeech(0);
      return;
    }
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsSpeechPaused(false);
      return;
    }
    window.speechSynthesis.pause();
    setIsSpeechPaused(true);
  }, [isReading, speechSupported, startSpeech]);

  const updateSpeechRate = useCallback(
    (value: number) => {
      const nextRate = Number(value);
      setSpeechRate(nextRate);
      if (!speechSupported || !isReading) return;
      const resumeIndex = speechIndexRef.current;
      startSpeech(resumeIndex, nextRate);
      if (isSpeechPaused) {
        window.speechSynthesis.pause();
        setIsSpeechPaused(true);
      }
    },
    [isReading, isSpeechPaused, speechSupported, startSpeech]
  );

  useEffect(() => {
    if (!isReading || isSpeechPaused) return;
    if (!speechSupported) return;
    if (!preferredVoice) return;
    const resumeIndex = speechIndexRef.current;
    startSpeech(resumeIndex);
  }, [preferredVoice, isReading, isSpeechPaused, speechSupported, startSpeech]);

  const downloadArticle = useCallback(
    (format: "pdf" | "doc" | "docx") => {
      if (!readableText.trim()) return;
      const safeTitle = readableTitle.trim() || "article";
      const fileBase = safeTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "article";
      const contentHtml = readableParagraphs
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("");
      const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(
        readableTitle
      )}</title></head><body><h1>${escapeHtml(
        readableTitle
      )}</h1>${contentHtml}</body></html>`;

      if (format === "pdf") {
        const printWindow = window.open("", "_blank", "width=960,height=720");
        if (!printWindow) return;
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
        }, 250);
        return;
      }

      const mimeType =
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/msword";
      const blob = new Blob([`\ufeff${html}`], { type: mimeType });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${fileBase}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    },
    [readableParagraphs, readableText, readableTitle]
  );

  const handleCloseReader = useCallback(() => {
    setActiveArticle(null);
    setReadableArticle(null);
    setReadableError(null);
    stopSpeech();
  }, [stopSpeech]);

  useEffect(() => {
    if (!activeArticle) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseReader();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeArticle, handleCloseReader]);

  return (
    <div className="dashboard-shell" style={getBackgroundStyle("dashboard")}>
      <Sidebar active="news" />

      <div className="main-content">
        <TopbarSearch />

        <div className="dash-hero news-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Newsroom</p>
            <h1>Daily Signal</h1>
            <p className="subhead">
              Discover the latest stories, trending topics, and conversation starters.
            </p>
          </div>
          <div className="news-hero-meta">
            <span className="news-pill">Live feed</span>
            <span className="news-updated">{formatRelativeTime(lastUpdated)}</span>
          </div>
        </div>

        {!newsEnabled && (
          <section className="panel news-disabled">
            {newsroomEnabled ? (
              <>
                <div>
                  <p className="eyebrow">Newsroom</p>
                  <h3>Enable the news feed</h3>
                  <p className="panel-sub">
                    Turn on Newsroom in your notification settings to view Daily Signal
                    stories on your dashboard.
                  </p>
                </div>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => navigate("/me")}
                >
                  Go to settings
                </button>
              </>
            ) : (
              <div>
                <p className="eyebrow">Newsroom</p>
                <h3>Newsroom is disabled</h3>
                <p className="panel-sub">
                  The Newsroom feed is temporarily unavailable.
                </p>
              </div>
            )}
          </section>
        )}

        {newsEnabled && (
          <>
            <section className="news-stats">
              <div className="news-stat-card">
                <span className="news-stat-label">Articles</span>
                <span className="news-stat-value">{articleCountDisplay}</span>
                <span className="news-stat-meta">
                  {statsUnavailable ? "Stats unavailable" : `${formatBytes(articleSize)} stored`}
                </span>
              </div>
              <div className="news-stat-card">
                <span className="news-stat-label">Assets</span>
                <span className="news-stat-value">{assetCountDisplay}</span>
                <span className="news-stat-meta">
                  {statsUnavailable ? "Stats unavailable" : formatBytes(assetSize)}
                </span>
              </div>
              <div className="news-stat-card">
                <span className="news-stat-label">Pages</span>
                <span className="news-stat-value">{pageCountDisplay}</span>
                <span className="news-stat-meta">
                  {statsUnavailable ? "Stats unavailable" : formatBytes(pageSize)}
                </span>
              </div>
              <div className="news-stat-card">
                <span className="news-stat-label">Catalog</span>
                <span className="news-stat-value">{catalogCountDisplay}</span>
                <span className="news-stat-meta">
                  {statsUnavailable ? "Stats unavailable" : statsUpdatedLabel}
                </span>
              </div>
            </section>
            {statsError && <p className="status status-error">{statsError}</p>}

            <section className="panel news-controls">
              <div className="news-controls-row">
                <div className="news-search">
                  <label htmlFor="news-search-input">Search headlines</label>
                  <input
                    id="news-search-input"
                    className="auth-input"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by keyword, headline, or phrase"
                  />
                </div>
                <div className="news-selects">
                  <label>
                    <span>Provider</span>
                    <select
                      className="auth-input"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                    >
                      <option value="">All providers</option>
                      {providerOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Source</span>
                    <select
                      className="auth-input"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="">All sources</option>
                      {sourceOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Sort</span>
                    <select
                      className="auth-input"
                      value={sortOrder}
                      onChange={(e) =>
                        setSortOrder(e.target.value as "newest" | "oldest")
                      }
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="news-controls-row news-controls-row--compact">
                <label>
                  <span>Start date</span>
                  <input
                    className="auth-input"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
                <label>
                  <span>End date</span>
                  <input
                    className="auth-input"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
                <button className="btn ghost" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
              <div className="news-topics">
                <span className="news-topic-label">Quick topics</span>
                <div className="news-topic-list">
                  {QUICK_TOPICS.map((topic) => (
                    <button
                      key={topic}
                      className={`news-topic-chip${query === topic ? " is-active" : ""}`}
                      type="button"
                      onClick={() => setQuery(topic)}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <div className="news-results">
              <div className="news-results-header">
                <div>
                  <p className="eyebrow">Headlines</p>
                  <h3>Top stories</h3>
                </div>
                <span className="news-results-meta">{filterSummary}</span>
              </div>

              {error && <p className="status status-error">{error}</p>}
              {loading && articles.length === 0 && (
                <p className="status">Loading headlines...</p>
              )}
              {!loading && !error && articles.length === 0 && (
                <p className="status">No headlines match your filters yet.</p>
              )}

              {topStories.length > 0 && (
                <div className="news-top-grid">
                  {topStories.map((article) => {
                    const metaParts = [article.source, article.provider].filter(Boolean);
                    const metaLine = metaParts.length
                      ? metaParts.join(" | ")
                      : "Daily Signal";
                    const timeLabel = formatNewsTime(article.publishedAt);
                    return (
                      <article key={article.id} className="news-card is-top">
                        <button
                          type="button"
                          className="news-card-link"
                          onClick={() => setActiveArticle(article)}
                        >
                          <div className="news-card-media">
                            {article.image ? (
                              <img src={article.image} alt={article.title} loading="lazy" />
                            ) : (
                              <div className="news-card-fallback">NEWS</div>
                            )}
                          </div>
                          <div className="news-card-body">
                            <div className="news-card-meta">
                              <span>{metaLine}</span>
                              {timeLabel && <span>{timeLabel}</span>}
                            </div>
                            <h3>{article.title}</h3>
                            {article.summary && <p>{article.summary}</p>}
                            <span className="news-card-cta">Read story -&gt;</span>
                          </div>
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}

              {topStories.length > 0 && (
                <div className="news-results-header">
                  <div>
                    <p className="eyebrow">More</p>
                    <h3>More stories</h3>
                  </div>
                  <span className="news-results-meta">
                    Sorted {sortOrder === "newest" ? "newest first" : "oldest first"}
                  </span>
                </div>
              )}

              <div className="news-grid">
                {(topStories.length > 0 ? mainArticles : articles).map((article) => {
                  const metaParts = [article.source, article.provider].filter(Boolean);
                  const metaLine = metaParts.length ? metaParts.join(" | ") : "Daily Signal";
                  const timeLabel = formatNewsTime(article.publishedAt);
                  return (
                    <article key={article.id} className="news-card">
                      <button
                        type="button"
                        className="news-card-link"
                        onClick={() => setActiveArticle(article)}
                      >
                        <div className="news-card-media">
                          {article.image ? (
                            <img src={article.image} alt={article.title} loading="lazy" />
                          ) : (
                            <div className="news-card-fallback">NEWS</div>
                          )}
                        </div>
                        <div className="news-card-body">
                          <div className="news-card-meta">
                            <span>{metaLine}</span>
                            {timeLabel && <span>{timeLabel}</span>}
                          </div>
                          <h3>{article.title}</h3>
                          {article.summary && <p>{article.summary}</p>}
                          <span className="news-card-cta">Read story -&gt;</span>
                        </div>
                      </button>
                    </article>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <nav className="news-pagination" aria-label="News results pages">
                  <button
                    className="news-page-btn"
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1 || loading}
                  >
                    Prev
                  </button>
                  {pageItems.map((item, index) =>
                    item === "ellipsis" ? (
                      <span key={`ellipsis-${index}`} className="news-page-ellipsis">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        className={`news-page-btn${item === currentPage ? " is-active" : ""}`}
                        type="button"
                        onClick={() => setCurrentPage(item)}
                        disabled={item === currentPage || loading}
                      >
                        {item}
                      </button>
                    )
                  )}
                  <button
                    className="news-page-btn"
                    type="button"
                    onClick={() => setCurrentPage((prev) => prev + 1)}
                    disabled={!canGoNext || loading}
                  >
                    Next
                  </button>
                </nav>
              )}
            </div>
          </>
        )}

        {activeArticle && (
          <div
            className="news-reader-overlay"
            role="presentation"
            onClick={handleCloseReader}
          >
            <section
              className="news-reader-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="news-reader-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="news-reader-header">
                <div>
                  <p className="news-reader-eyebrow">Read-only view</p>
                  <h2 id="news-reader-title">{readableTitle}</h2>
                  <div className="news-reader-meta">
                    <span>{readableMetaLine}</span>
                    {readableTime && <span>{readableTime}</span>}
                    {readableAuthor && <span>By {readableAuthor}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  className="news-reader-close"
                  onClick={handleCloseReader}
                  aria-label="Close reader"
                >
                  X
                </button>
              </header>

              <div className="news-reader-actions">
                <a
                  className="news-reader-link"
                  href={activeArticle.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Read original story
                </a>
                <div className="news-reader-downloads">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => downloadArticle("pdf")}
                    disabled={!readableText.trim()}
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => downloadArticle("doc")}
                    disabled={!readableText.trim()}
                  >
                    Download DOC
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => downloadArticle("docx")}
                    disabled={!readableText.trim()}
                  >
                    Download DOCX
                  </button>
                </div>
              </div>

              {speechSupported && (
                <div className="news-reader-voice">
                  <label>
                    <span>Voice</span>
                    <select
                      className="auth-input"
                      value={voiceGender}
                      onChange={(event) =>
                        setVoiceGender(event.target.value as "female" | "male")
                      }
                    >
                      <option value="female">Woman voice</option>
                      <option value="male">Man voice</option>
                    </select>
                  </label>
                  <label className="news-reader-rate">
                    <span>Speed</span>
                    <input
                      type="range"
                      min={0.75}
                      max={1.5}
                      step={0.05}
                      value={speechRate}
                      onChange={(event) =>
                        updateSpeechRate(Number(event.target.value))
                      }
                    />
                    <span className="news-reader-rate-value">
                      {speechRate.toFixed(2)}x
                    </span>
                  </label>
                  <div className="news-reader-voice-actions">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={togglePauseSpeech}
                      disabled={!readableText.trim()}
                    >
                      {isReading
                        ? isSpeechPaused
                          ? "Resume"
                          : "Pause"
                        : "Read aloud"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={stopSpeech}
                      disabled={!isReading}
                    >
                      Stop
                    </button>
                  </div>
                </div>
              )}

              <div className="news-reader-content">
                {readableLoading && <p className="status">Loading article...</p>}
                {!readableLoading && readableError && !hasFallbackParagraphs && (
                  <p className="status status-error">{readableError}</p>
                )}
                {!readableLoading &&
                  hasFallbackParagraphs &&
                  fallbackParagraphs.map((paragraph, index) => (
                    <p key={`${activeArticle.id}-${index}`}>{paragraph}</p>
                  ))}
                {!readableLoading &&
                  !hasFallbackParagraphs &&
                  !readableError && (
                    <p className="status">
                      Read-only text is unavailable for this article.
                    </p>
                  )}
              </div>

              <footer className="news-reader-footer">
                <span className="news-reader-hint">
                  Tip: Use the close button or tap outside to exit.
                </span>
                <button
                  type="button"
                  className="btn ghost news-reader-close-mobile"
                  onClick={handleCloseReader}
                >
                  Close
                </button>
              </footer>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}


