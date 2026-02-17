import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";
import "../css/pwa.css";

const normalizeProtocolUrl = (rawUrl: string) => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("web+yoursocialplace://")) {
    const path = trimmed.replace("web+yoursocialplace://", "/");
    return path.startsWith("/") ? path : `/${path}`;
  }

  if (trimmed.startsWith("https://yoursocialplace.com")) {
    try {
      const url = new URL(trimmed);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (error) {
      console.warn("Failed to parse protocol URL:", error);
    }
  }

  return "";
};

export default function ProtocolHandler() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [targetUrl, setTargetUrl] = useState("");
  const [status, setStatus] = useState("");

  usePageMeta({
    title: "Protocol Link | Your Social Place",
    description: "Handle deep links opened with Your Social Place.",
    type: "website",
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    const url = searchParams.get("url") || "";
    if (url) {
      sessionStorage.setItem("pwa:protocol-url", url);
      setTargetUrl(url);
      return;
    }
    setTargetUrl(sessionStorage.getItem("pwa:protocol-url") || "");
  }, [searchParams]);

  const internalPath = useMemo(() => normalizeProtocolUrl(targetUrl), [targetUrl]);

  const handleOpen = () => {
    if (internalPath) {
      navigate(internalPath);
      return;
    }
    if (targetUrl) {
      window.location.assign(targetUrl);
    }
  };

  const handleCopy = async () => {
    if (!targetUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(targetUrl);
      setStatus("Link copied to clipboard.");
    } catch (error) {
      console.warn("Failed to copy protocol URL:", error);
      setStatus("Unable to copy link.");
    }
  };

  return (
    <div className="pwa-shell">
      <div className="pwa-card">
        <header className="pwa-header">
          <span className="pwa-eyebrow">Protocol Handler</span>
          <h1>Deep Link Ready</h1>
          <p className="pwa-subhead">
            This page opens when a custom Your Social Place link launches the app.
          </p>
        </header>

        <section className="pwa-section">
          <p className="pwa-label">Incoming Link</p>
          <div className="pwa-code">{targetUrl || "No protocol URL detected."}</div>
        </section>

        {status && <p className="pwa-status">{status}</p>}

        <div className="pwa-actions">
          <button
            className="pwa-button"
            type="button"
            onClick={handleOpen}
            disabled={!targetUrl}
          >
            Open Link
          </button>
          <button
            className="pwa-button secondary"
            type="button"
            onClick={handleCopy}
            disabled={!targetUrl}
          >
            Copy Link
          </button>
          <button
            className="pwa-button secondary"
            type="button"
            onClick={() => navigate("/dashboard")}
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
