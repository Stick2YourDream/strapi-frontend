import { useMemo, useState } from "react";

type LinkPreview = {
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

type LinkPreviewCardProps = {
  preview?: LinkPreview | null;
  url: string;
  compact?: boolean;
};

const hostnameFor = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
};

const parseYouTubeId = (url: string) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.replace("/", "");
      return id || null;
    }
    if (host.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/watch")) {
        return parsed.searchParams.get("v");
      }
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/")[2] || null;
      }
      if (parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.split("/")[2] || null;
      }
    }
    if (host.includes("youtube-nocookie.com") && parsed.pathname.startsWith("/embed/")) {
      return parsed.pathname.split("/")[2] || null;
    }
  } catch {
    return null;
  }
  return null;
};

const resolveEmbedOrigin = () => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  const fallback = String(import.meta.env.VITE_PUBLIC_SITE_URL || "").trim();
  return fallback.replace(/\/$/, "");
};

const resolveEmbedHost = (origin?: string) => {
  const envHost = String(import.meta.env.VITE_YOUTUBE_EMBED_HOST || "").trim();
  if (envHost) return envHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (origin) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      if (host.endsWith("azurewebsites.net")) {
        return "www.youtube.com";
      }
    } catch {
      // ignore
    }
  }
  return "www.youtube-nocookie.com";
};

const buildEmbedUrl = (videoId: string, origin?: string) => {
  const params = new URLSearchParams({ autoplay: "1", rel: "0" });
  if (origin) {
    params.set("origin", origin);
  }
  const host = resolveEmbedHost(origin);
  return `https://${host}/embed/${videoId}?${params.toString()}`;
};

export default function LinkPreviewCard({
  preview,
  url,
  compact = false,
}: LinkPreviewCardProps) {
  const safePreview = useMemo<LinkPreview>(() => {
    if (preview) return preview;
    const host = hostnameFor(url);
    return { url, title: host, siteName: host };
  }, [preview, url]);

  const title = safePreview.title || safePreview.siteName || hostnameFor(url);
  const meta = safePreview.siteName || hostnameFor(url);
  const videoId = parseYouTubeId(url);
  const isYouTube = Boolean(videoId);
  const showBadge = safePreview.type === "video" || isYouTube;
  const fallbackImage =
    safePreview.image || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "");
  const hasImage = Boolean(fallbackImage);
  const [showEmbed, setShowEmbed] = useState(false);
  const embedOrigin = resolveEmbedOrigin();

  if (!isYouTube) {
    return (
      <a
        className={`link-preview-card${compact ? " is-compact" : ""}`}
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        <div className="link-preview-media">
          {hasImage ? (
            <img
              src={fallbackImage}
              alt={title}
              loading="lazy"
              decoding="async"
              className={safePreview.image ? "" : "is-favicon"}
            />
          ) : (
            <div className="link-preview-placeholder">LINK</div>
          )}
          {showBadge && <span className="link-preview-badge">Video</span>}
        </div>
        <div className="link-preview-body">
          <p className="link-preview-title">{title}</p>
          {safePreview.description && (
            <p className="link-preview-desc">{safePreview.description}</p>
          )}
          <span className="link-preview-url">{meta}</span>
        </div>
      </a>
    );
  }

  return (
    <div
      className={`link-preview-card link-preview-card--youtube${
        compact ? " is-compact" : ""
      }${showEmbed ? " is-embed" : ""}`}
    >
      <div className="link-preview-media">
        {showEmbed && videoId ? (
          <iframe
            className="link-preview-embed"
            src={buildEmbedUrl(videoId, embedOrigin)}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="origin"
            allowFullScreen
          />
        ) : (
          <>
            {hasImage ? (
              <img
                src={fallbackImage}
                alt={title}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="link-preview-placeholder">VIDEO</div>
            )}
            <button
              className="link-preview-play"
              type="button"
              onClick={() => setShowEmbed(true)}
              aria-label="Play video"
            >
              <span className="link-preview-play-icon">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5.5v13l11-6.5-11-6.5z" />
                </svg>
              </span>
            </button>
          </>
        )}
        {showBadge && <span className="link-preview-badge">Video</span>}
      </div>
      <div className="link-preview-body">
        <p className="link-preview-title">{title}</p>
        {safePreview.description && (
          <p className="link-preview-desc">{safePreview.description}</p>
        )}
        <span className="link-preview-url">{meta}</span>
        <div className="link-preview-actions">
          {!showEmbed && (
            <button
              className="btn ghost link-preview-action"
              type="button"
              onClick={() => setShowEmbed(true)}
            >
              Play here
            </button>
          )}
          {showEmbed && (
            <button
              className="btn ghost link-preview-action"
              type="button"
              onClick={() => setShowEmbed(false)}
            >
              Hide player
            </button>
          )}
          <a
            className="btn ghost link-preview-action"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Watch on YouTube
          </a>
        </div>
      </div>
    </div>
  );
}
