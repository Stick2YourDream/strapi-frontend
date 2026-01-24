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
  fetchNewsProviders,
  fetchNewsSources,
  type NewsArticle,
  type NewsAsset,
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

const formatRelativeTime = (value?: string | Date | null) => {
  if (!value) return "Updated just now";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated just now";
  const diffMs = Date.now() - date.getTime();
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
  const { profile } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const newsEnabled = profile?.notificationSettings?.newsEnabled !== false;

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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const loadIdRef = useRef(0);
  const imageCacheRef = useRef<Record<string, string>>({});
  const lastFilterKeyRef = useRef("");
  const lastPageRef = useRef(1);

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
        const [
          providerList,
          sourceList,
          contentTypeList,
          articleCountValue,
          assetCountValue,
          pageCountValue,
          articleSizeValue,
          assetSizeValue,
          pageSizeValue,
          lastUpdatedValue,
        ] = await Promise.all([
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
        setProviders(
          Array.from(new Set(providerList)).sort((a, b) => a.localeCompare(b))
        );
        setSources(
          Array.from(new Set(sourceList)).sort((a, b) => a.localeCompare(b))
        );
        setContentTypes(
          Array.from(new Set(contentTypeList)).sort((a, b) => a.localeCompare(b))
        );
        setArticleCount(articleCountValue || 0);
        setAssetCount(assetCountValue || 0);
        setPageCount(pageCountValue || 0);
        setArticleSize(articleSizeValue || 0);
        setAssetSize(assetSizeValue || 0);
        setPageSize(pageSizeValue || 0);
        setStatsUpdatedAt(lastUpdatedValue || "");
      } catch {
        if (active) {
          setProviders([]);
          setSources([]);
          setContentTypes([]);
          setArticleCount(0);
          setAssetCount(0);
          setPageCount(0);
          setArticleSize(0);
          setAssetSize(0);
          setPageSize(0);
          setStatsUpdatedAt("");
        }
      }
    };

    loadMeta();
    return () => {
      active = false;
    };
  }, [newsEnabled]);

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
    if (!newsEnabled) return;
    setCurrentPage(1);
    setMaxPageSeen(1);
  }, [query, provider, source, startDate, endDate, sortOrder, newsEnabled]);

  const filterKey = `${query}|${provider}|${source}|${startDate}|${endDate}|${sortOrder}`;

  useEffect(() => {
    if (!newsEnabled) return;
    const filterChanged = lastFilterKeyRef.current !== filterKey;
    const pageChanged = lastPageRef.current !== currentPage;
    lastFilterKeyRef.current = filterKey;
    lastPageRef.current = currentPage;
    if (!filterChanged && !pageChanged) return;
    const delay = filterChanged ? SEARCH_DEBOUNCE_MS : 0;
    const handle = window.setTimeout(() => {
      loadArticles(currentPage);
    }, delay);
    return () => window.clearTimeout(handle);
  }, [currentPage, filterKey, loadArticles, newsEnabled]);

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
          </section>
        )}

        {newsEnabled && (
          <>
            <section className="news-stats">
              <div className="news-stat-card">
                <span className="news-stat-label">Articles</span>
                <span className="news-stat-value">{articleCount.toLocaleString()}</span>
                <span className="news-stat-meta">
                  {formatBytes(articleSize)} stored
                </span>
              </div>
              <div className="news-stat-card">
                <span className="news-stat-label">Assets</span>
                <span className="news-stat-value">{assetCount.toLocaleString()}</span>
                <span className="news-stat-meta">{formatBytes(assetSize)}</span>
              </div>
              <div className="news-stat-card">
                <span className="news-stat-label">Pages</span>
                <span className="news-stat-value">{pageCount.toLocaleString()}</span>
                <span className="news-stat-meta">{formatBytes(pageSize)}</span>
              </div>
              <div className="news-stat-card">
                <span className="news-stat-label">Catalog</span>
                <span className="news-stat-value">
                  {contentTypes.length ? contentTypes.length : "—"}
                </span>
                <span className="news-stat-meta">{statsUpdatedLabel}</span>
              </div>
            </section>

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
                  <h3>Latest stories</h3>
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

              <div className="news-grid">
                {articles.map((article) => {
                  const metaParts = [article.source, article.provider].filter(Boolean);
                  const metaLine = metaParts.length ? metaParts.join(" | ") : "Daily Signal";
                  const timeLabel = formatNewsTime(article.publishedAt);
                  return (
                    <article key={article.id} className="news-card">
                      <a href={article.url} target="_blank" rel="noreferrer">
                        <div className="news-card-media">
                          {article.image ? (
                            <img src={article.image} alt={article.title} loading="lazy" />
                          ) : null}
                        </div>
                        <div className="news-card-body">
                          <div className="news-card-meta">
                            <span>{metaLine}</span>
                            {timeLabel && <span>{timeLabel}</span>}
                          </div>
                          <h3>{article.title}</h3>
                          {article.summary && <p>{article.summary}</p>}
                          <span className="news-card-cta">Read story →</span>
                        </div>
                      </a>
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
      </div>
    </div>
  );
}


