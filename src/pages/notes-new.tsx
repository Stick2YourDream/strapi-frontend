import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";
import "../css/pwa.css";

const STORAGE_KEY = "pwa:note-draft";

export default function NewNote() {
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");

  usePageMeta({
    title: "New Note | Your Social Place",
    description: "Capture a quick note and share it with your community.",
    type: "website",
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setNote(saved);
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, note);
    setStatus("Draft saved on this device.");
  };

  const handleCopy = async () => {
    if (!note.trim()) {
      setStatus("Add a note before copying.");
      return;
    }
    try {
      await navigator.clipboard.writeText(note);
      setStatus("Copied to clipboard.");
    } catch (error) {
      console.warn("Failed to copy note:", error);
      setStatus("Unable to copy note.");
    }
  };

  const handleClear = () => {
    setNote("");
    localStorage.removeItem(STORAGE_KEY);
    setStatus("Draft cleared.");
  };

  return (
    <div className="pwa-shell">
      <div className="pwa-card">
        <header className="pwa-header">
          <span className="pwa-eyebrow">Note Taking</span>
          <h1>Start a New Note</h1>
          <p className="pwa-subhead">
            Capture a quick thought and bring it into Your Social Place when you are ready.
          </p>
        </header>

        <div className="pwa-field">
          <span className="pwa-label">Note</span>
          <textarea
            className="pwa-textarea"
            placeholder="Write your update, goal, or reflection here..."
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {status && <p className="pwa-status">{status}</p>}

        <div className="pwa-actions">
          <button className="pwa-button" type="button" onClick={handleSave}>
            Save Draft
          </button>
          <button className="pwa-button secondary" type="button" onClick={handleCopy}>
            Copy Note
          </button>
          <button className="pwa-button secondary" type="button" onClick={handleClear}>
            Clear Draft
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
