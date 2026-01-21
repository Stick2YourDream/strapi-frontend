import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";
import "../css/pwa.css";

type SharedFile = {
  name: string;
  type: string;
  size: number;
};

type SharePayload = {
  title?: string;
  text?: string;
  url?: string;
  files?: SharedFile[];
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const parseStoredFiles = () => {
  const storedFiles = sessionStorage.getItem("pwa:launch-files");
  if (!storedFiles) {
    return [];
  }
  try {
    return JSON.parse(storedFiles) as SharedFile[];
  } catch (error) {
    console.warn("Failed to parse stored file metadata:", error);
    return [];
  }
};

const parseStoredShare = () => {
  const storedShare = sessionStorage.getItem("pwa:share-payload");
  if (!storedShare) {
    return {};
  }
  try {
    return JSON.parse(storedShare) as SharePayload;
  } catch (error) {
    console.warn("Failed to parse stored share payload:", error);
    return {};
  }
};

export default function ShareTarget() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState<SharePayload>({});

  usePageMeta({
    title: "Share | Your Social Place",
    description: "Preview shared content before posting on Your Social Place.",
    type: "website",
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    const title = searchParams.get("title")?.trim() || "";
    const text = searchParams.get("text")?.trim() || "";
    const url = searchParams.get("url")?.trim() || "";
    const hasQuery = Boolean(title || text || url);

    let sharePayload: SharePayload = {};
    if (hasQuery) {
      sharePayload = {
        title: title || undefined,
        text: text || undefined,
        url: url || undefined,
      };
      sessionStorage.setItem("pwa:share-payload", JSON.stringify(sharePayload));
    } else {
      sharePayload = parseStoredShare();
    }

    const files = parseStoredFiles();
    setPayload({
      ...sharePayload,
      ...(files.length ? { files } : {}),
    });
  }, [searchParams]);

  const hasContent = useMemo(() => {
    return Boolean(
      payload.title ||
        payload.text ||
        payload.url ||
        (payload.files && payload.files.length > 0)
    );
  }, [payload]);

  const handleClear = () => {
    sessionStorage.removeItem("pwa:share-payload");
    sessionStorage.removeItem("pwa:launch-files");
    setPayload({});
  };

  return (
    <div className="pwa-shell">
      <div className="pwa-card">
        <header className="pwa-header">
          <span className="pwa-eyebrow">Share Target</span>
          <h1>Shared with Your Social Place</h1>
          <p className="pwa-subhead">
            Review the content captured by the share sheet before posting.
          </p>
        </header>

        {!hasContent && (
          <section className="pwa-section">
            <p className="pwa-label">Status</p>
            <div className="pwa-value">
              No share data was detected. Try sharing again or open the app to
              start a new post.
            </div>
          </section>
        )}

        {(payload.title || payload.text || payload.url) && (
          <section className="pwa-section">
            <p className="pwa-label">Shared Details</p>
            {payload.title && (
              <div className="pwa-field">
                <span className="pwa-label">Title</span>
                <div className="pwa-value">{payload.title}</div>
              </div>
            )}
            {payload.text && (
              <div className="pwa-field">
                <span className="pwa-label">Message</span>
                <div className="pwa-value pwa-pre">{payload.text}</div>
              </div>
            )}
            {payload.url && (
              <div className="pwa-field">
                <span className="pwa-label">Link</span>
                <div className="pwa-value pwa-pre">{payload.url}</div>
              </div>
            )}
          </section>
        )}

        {payload.files && payload.files.length > 0 && (
          <section className="pwa-section">
            <p className="pwa-label">Shared Files</p>
            <ul className="pwa-list">
              {payload.files.map((file) => (
                <li key={`${file.name}-${file.size}`}>
                  <span>{file.name}</span>
                  <span>{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="pwa-actions">
          <button className="pwa-button" type="button" onClick={() => navigate("/dashboard")}>
            Go to Dashboard
          </button>
          <button className="pwa-button secondary" type="button" onClick={() => navigate("/")}>
            Back Home
          </button>
          <button className="pwa-button secondary" type="button" onClick={handleClear}>
            Clear Share Data
          </button>
        </div>
      </div>
    </div>
  );
}
