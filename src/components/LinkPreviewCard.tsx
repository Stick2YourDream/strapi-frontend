import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

let ytApiPromise: Promise<void> | null = null;

const ensureYouTubeApi = () => {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if ((window as any).YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve, reject) => {
    const existingCallback = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (typeof existingCallback === "function") {
        try {
          existingCallback();
        } catch {
          // ignore callback errors
        }
      }
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Failed to load YouTube API"));
      document.head.appendChild(script);
    }
  });
  return ytApiPromise;
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
  const [showTitleOverlay, setShowTitleOverlay] = useState(false);
  const playerRef = useRef<any>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerPollRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const overlayTimerRef = useRef<number | null>(null);

  const triggerOverlay = useCallback(() => {
    setShowTitleOverlay(true);
    if (overlayTimerRef.current) {
      window.clearTimeout(overlayTimerRef.current);
    }
    overlayTimerRef.current = window.setTimeout(() => {
      setShowTitleOverlay(false);
      overlayTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    if (!showEmbed) {
      setShowTitleOverlay(false);
      if (overlayTimerRef.current) {
        window.clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      return;
    }
    triggerOverlay();
  }, [showEmbed, triggerOverlay]);

  useEffect(() => {
    if (!showEmbed || !videoId) {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore destroy errors
        }
        playerRef.current = null;
      }
      if (playerPollRef.current) {
        window.clearInterval(playerPollRef.current);
        playerPollRef.current = null;
      }
      lastTimeRef.current = 0;
      return;
    }
    let cancelled = false;
    const setupPlayer = async () => {
      try {
        await ensureYouTubeApi();
      } catch {
        return;
      }
      if (cancelled || !playerContainerRef.current) return;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore destroy errors
        }
        playerRef.current = null;
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      playerRef.current = new (window as any).YT.Player(playerContainerRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          mute: 0,
          rel: 0,
          playsinline: 1,
          controls: 1,
          fs: 1,
          modestbranding: 1,
          origin,
        },
        events: {
          onReady: (event: any) => {
            const player = event?.target;
            if (!player || cancelled) return;
            if (playerPollRef.current) {
              window.clearInterval(playerPollRef.current);
            }
            playerPollRef.current = window.setInterval(() => {
              try {
                const currentTime = player.getCurrentTime?.() ?? 0;
                if (currentTime <= 0.1 && lastTimeRef.current > 0.5) {
                  triggerOverlay();
                }
                lastTimeRef.current = currentTime;
              } catch {
                // ignore polling errors
              }
            }, 250);
          },
          onStateChange: (event: any) => {
            try {
              const YT = (window as any).YT;
              if (!YT?.PlayerState) return;
              if (event?.data !== YT.PlayerState.PLAYING) return;
              const currentTime = event?.target?.getCurrentTime?.() ?? 0;
              if (currentTime <= 0.1) {
                triggerOverlay();
              }
            } catch {
              // ignore state errors
            }
          },
        },
      });
    };
    setupPlayer();
    return () => {
      cancelled = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore destroy errors
        }
        playerRef.current = null;
      }
      if (playerPollRef.current) {
        window.clearInterval(playerPollRef.current);
        playerPollRef.current = null;
      }
    };
  }, [showEmbed, videoId, triggerOverlay]);

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
          <>
            <div className="link-preview-embed" ref={playerContainerRef} />
            {showTitleOverlay && (
              <div className="link-preview-yt-overlay" aria-hidden="true">
                <div className="link-preview-yt-overlay-inner">{title}</div>
              </div>
            )}
          </>
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
