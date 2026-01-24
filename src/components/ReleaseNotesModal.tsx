import { useEffect, useMemo, useState } from "react";
import "../css/release-notes.css";

const RELEASE_NOTES_VERSION = "2026.01.23";
const STORAGE_KEY = "releaseNotesDismissedVersion";
const SESSION_PREFIX = "releaseNotesClosed:";

const RELEASE_NOTES = [
  "Moved links from My Dashboard to permanently show on the left sidebar for desktop version.",
  "Made change for previously logged in users to automatically be directed to their Dashboard page upon visit to the site and/or app.",
  "Added \"Like\", \"Comment\", and \"Subscribe\" buttons to the bottom of each user post.",
  "Added Moderator and Admin GUI.",
  "Password minimum length is now 8 characters instead of 12.",
  "Added GUI for Moderators and Admins to restrict users if necessary.",
  "Added Filters for Dashboard to View Posts by Friends, Public, Private, or All Posts.",
];

export default function ReleaseNotesModal() {
  const [open, setOpen] = useState(false);
  const sessionKey = useMemo(
    () => `${SESSION_PREFIX}${RELEASE_NOTES_VERSION}`,
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    const closed = window.sessionStorage.getItem(sessionKey);
    if (dismissed !== RELEASE_NOTES_VERSION && !closed) {
      setOpen(true);
    }
  }, [sessionKey]);

  if (!open) return null;

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
        </div>
        <div className="release-notes-actions">
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
