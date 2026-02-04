import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import "../css/release-notes.css";

const RELEASE_NOTES_VERSION = "2026.02.03";
const STORAGE_KEY = "releaseNotesDismissedVersion";
const SESSION_PREFIX = "releaseNotesClosed:";

const RELEASE_NOTES = [
  "New Dashboard UI/Tweaks",
  "Added Goals and Impact Section",
  "Added Forums",
  "Added Standalone Downloadable Video Calling Application with new Mobile Only Features and Improved Responsivness",
  "Added Photo/Video Gallery",
  "Added Featured Wins to Dashboard",
  "You can now add friends to a trusted circle a create a trusted circle group to direct message",
  "Improved performance of video calls and messaging",
];

export default function ReleaseNotesModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const sessionKey = useMemo(
    () => `${SESSION_PREFIX}${RELEASE_NOTES_VERSION}`,
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user) {
      setOpen(false);
      return;
    }
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    const closed = window.sessionStorage.getItem(sessionKey);
    if (dismissed !== RELEASE_NOTES_VERSION && !closed) {
      setOpen(true);
    }
  }, [sessionKey, user]);

  if (!user || !open) return null;

  const handleClose = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(sessionKey, "1");
    }
    setOpen(false);
  };

  const handleDontShow = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, RELEASE_NOTES_VERSION);
    }
    setOpen(false);
  };

  const handleCheckForUpdates = async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) {
      setUpdateStatus("Updates are not supported in this browser.");
      return;
    }
    if (import.meta.env.DEV) {
      setUpdateStatus("Updates are available in production builds only.");
      return;
    }
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await navigator.serviceWorker.register("/sw.js");
      }
      await registration.update();
      if (registration.waiting) {
        window.dispatchEvent(new CustomEvent("pwa:update-available"));
        setUpdateStatus("Update ready. Use the refresh banner to apply it.");
      } else {
        setUpdateStatus("You're already on the latest version.");
      }
    } catch {
      setUpdateStatus("Unable to check for updates right now.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div
      className="release-notes-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-notes-title"
    >
      <div className="release-notes-modal">
        <div className="release-notes-header">
          <div>
            <p className="release-notes-eyebrow">Release notes</p>
            <h3 id="release-notes-title">What&apos;s new</h3>
            <p className="release-notes-version">Version {RELEASE_NOTES_VERSION}</p>
          </div>
          <button type="button" className="release-notes-close" onClick={handleClose}>
            Close
          </button>
        </div>
        <div className="release-notes-body">
          <ul>
            {RELEASE_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {updateStatus && <p className="release-notes-status">{updateStatus}</p>}
        </div>
        <div className="release-notes-actions">
          <button
            type="button"
            className="release-notes-btn ghost"
            onClick={handleCheckForUpdates}
            disabled={checkingUpdate}
          >
            {checkingUpdate ? "Checking..." : "Check for updates"}
          </button>
          <button type="button" className="release-notes-btn ghost" onClick={handleClose}>
            Close
          </button>
          <button type="button" className="release-notes-btn primary" onClick={handleDontShow}>
            Don&apos;t Show This Again
          </button>
        </div>
      </div>
    </div>
  );
}
