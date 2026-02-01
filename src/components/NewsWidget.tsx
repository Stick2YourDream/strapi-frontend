import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useNewsPreference } from "../hooks/useNewsPreference";
import {
  fetchNewsArticles,
  fetchNewsProviders,
  fetchNewsSources,
  type NewsArticle,
} from "../utils/news-api";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const WIDGET_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 400;
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
  }).format(date);
};

const mergeOptions = (primary: string[], fallback: string[], selected?: string) => {
  const set = new Set<string>();
  primary.forEach((value) => value && set.add(value));
  fallback.forEach((value) => value && set.add(value));
  if (selected) set.add(selected);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

const isStandaloneMode = () => {
  if (typeof window === "undefined") return false;
  const standaloneMatch = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = Boolean((navigator as { standalone?: boolean }).standalone);
  return standaloneMatch || iosStandalone;
};

export default function NewsWidget() {
  const navigate = useNavigate();
  const { user, profile, appSettings } = useAuth();
  const { override: newsOverride } = useNewsPreference(user?.id);
  const profileNewsEnabled = profile?.notificationSettings?.newsEnabled !== false;
  const newsroomEnabled = appSettings?.newsroomEnabled !== false;
  const newsEnabled = (newsOverride ?? profileNewsEnabled) && newsroomEnabled;

  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [source, setSource] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [isStandalone, setIsStandalone] = useState(isStandaloneMode());
  const lastFilterRef = useRef("");

  useEffect(() => {
    if (!newsEnabled) return;
    let active = true;
    const loadMeta = async () => {
      try {
        const [providerList, sourceList] = await Promise.all([
          fetchNewsProviders(),
          fetchNewsSources(),
        ]);
        if (!active) return;
        setProviders(
          Array.from(new Set(providerList)).sort((a, b) => a.localeCompare(b))
        );
        setSources(
          Array.from(new Set(sourceList)).sort((a, b) => a.localeCompare(b))
        );
      } catch {
        if (active) {
          setProviders([]);
          setSources([]);
        }
      }
    };
    loadMeta();
    return () => {
      active = false;
    };
  }, [newsEnabled]);

  const loadArticles = useCallback(async () => {
    if (!newsEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const items = await fetchNewsArticles({
        search: query || undefined,
        provider: provider || undefined,
        source: source || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        limit: WIDGET_PAGE_SIZE,
        offset: 0,
      });
      const sorted = [...items].sort((a, b) => {
        const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
      });
      setArticles(sorted);
    } catch {
      setError("Unable to load news right now.");
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, [endDate, newsEnabled, provider, query, source, startDate, sortOrder]);

  useEffect(() => {
    if (!newsEnabled) return;
    const filterKey = `${query}|${provider}|${source}|${startDate}|${endDate}|${sortOrder}`;
    if (lastFilterRef.current === filterKey) return;
    lastFilterRef.current = filterKey;
    const handle = window.setTimeout(() => {
      loadArticles();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, provider, source, startDate, endDate, sortOrder, loadArticles, newsEnabled]);

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    const media = window.matchMedia("(display-mode: standalone)");
    const handleDisplayChange = () => setIsStandalone(isStandaloneMode());
    media.addEventListener("change", handleDisplayChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
      media.removeEventListener("change", handleDisplayChange);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

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
  const clearFilters = () => {
    setQuery("");
    setProvider("");
    setSource("");
    setStartDate("");
    setEndDate("");
  };

  return (
    <section className="panel news-widget">
      <div className="news-widget-header">
        <div>
          <p className="eyebrow">News Widget</p>
          <h3>Daily Signal</h3>
          <p className="panel-sub">Stay current without leaving your feed.</p>
        </div>
        <div className="news-widget-actions">
          {installPrompt && !isStandalone && (
            <button className="btn ghost" type="button" onClick={handleInstall}>
              Install app
            </button>
          )}
          <button
            className="btn primary"
            type="button"
            disabled={!newsroomEnabled}
            onClick={() => {
              if (!newsroomEnabled) return;
              navigate("/news");
            }}
          >
            {newsroomEnabled ? "Open Newsroom" : "Newsroom (Coming soon)"}
          </button>
        </div>
      </div>

      {!newsEnabled && (
        <div className="news-widget-disabled">
          {newsroomEnabled ? (
            <>
              <p>Enable Newsroom in settings to show this widget.</p>
              <button className="btn ghost" type="button" onClick={() => navigate("/me")}>
                Go to settings
              </button>
            </>
          ) : (
            <p>The Newsroom is temporarily unavailable.</p>
          )}
        </div>
      )}

      {newsEnabled && (
        <>
          <div className="news-widget-filters">
            <label className="news-widget-field">
              <span>Search</span>
              <input
                className="auth-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search headlines"
              />
            </label>
            <label className="news-widget-field">
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
            <label className="news-widget-field">
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
            <label className="news-widget-field">
              <span>Sort</span>
              <select
                className="auth-input"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
          </div>
          <div className="news-widget-dates">
            <label className="news-widget-field">
              <span>Start date</span>
              <input
                className="auth-input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="news-widget-field">
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
          <div className="news-widget-topics">
            {QUICK_TOPICS.map((topic) => (
              <button
                key={topic}
                className={`news-widget-chip${query === topic ? " is-active" : ""}`}
                type="button"
                onClick={() => setQuery(topic)}
              >
                {topic}
              </button>
            ))}
          </div>

          {loading && <p className="status">Loading headlines...</p>}
          {error && <p className="status status-error">{error}</p>}
          {!loading && !error && articles.length === 0 && (
            <p className="status">No headlines match your filters.</p>
          )}

          <div className="news-widget-grid">
            {articles.map((article) => {
              const metaParts = [article.source, article.provider].filter(Boolean);
              const metaLine = metaParts.length ? metaParts.join(" • ") : "Daily Signal";
              const timeLabel = formatNewsTime(article.publishedAt);
              return (
                <article key={article.id} className="news-widget-card">
                  <a href={article.url} target="_blank" rel="noreferrer">
                    <div className="news-widget-media">
                      {article.image ? (
                        <img src={article.image} alt={article.title} loading="lazy" />
                      ) : (
                        <div className="news-widget-media-fallback" />
                      )}
                    </div>
                    <div className="news-widget-body">
                      <div className="news-widget-meta">
                        <span>{metaLine}</span>
                        {timeLabel && <span>{timeLabel}</span>}
                      </div>
                      <h4>{article.title}</h4>
                      {article.summary && <p>{article.summary}</p>}
                      <span className="news-widget-cta">Read story →</span>
                    </div>
                  </a>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
