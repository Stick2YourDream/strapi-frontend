import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  detectDesktopOs,
  downloadBlob,
  exportProfileArchive,
  getExportInstructions,
  type DesktopOs,
} from "../utils/profile-export";
import "../css/dob-mismatch-notice.css";

const DISMISS_PREFIX = "dob-mismatch-dismissed";
const MIN_WARNING_DELAY_MS = 5000;

const formatDate = (value?: string | null) => {
  if (!value) return "soon";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const parseTimestamp = (value?: string | null) => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

export default function DobMismatchNotice() {
  const { user, sessionStartedAt } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const mismatchAt = user?.ageVerificationDobMismatchAt || null;
  const mismatchAtMs = parseTimestamp(mismatchAt);
  const dueAt = user?.ageVerificationDobMismatchDueAt || null;
  const daysRemaining = user?.ageVerificationDobMismatchDaysRemaining ?? null;

  const dismissKey = useMemo(() => {
    if (!user?.id || !mismatchAt) return null;
    return `${DISMISS_PREFIX}:${user.id}:${mismatchAt}`;
  }, [user?.id, mismatchAt]);

  const shouldShow = useMemo(() => {
    if (!user || !mismatchAtMs || !sessionStartedAt) return false;
    return mismatchAtMs <= sessionStartedAt - MIN_WARNING_DELAY_MS;
  }, [user, mismatchAtMs, sessionStartedAt]);

  useEffect(() => {
    if (!dismissKey || typeof window === "undefined") {
      setDismissed(false);
      return;
    }
    setDismissed(window.localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);

  if (!shouldShow || dismissed) return null;

  const handleDismiss = () => {
    if (dismissKey && typeof window !== "undefined") {
      window.localStorage.setItem(dismissKey, "1");
    }
    setDismissed(true);
  };

  const handleExport = async () => {
    if (!user?.id) return;
    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    const os: DesktopOs = detectDesktopOs();
    try {
      const { blob, filename } = await exportProfileArchive({ userId: user.id, os });
      downloadBlob(blob, filename);
      setExportSuccess(`Export ready. ${getExportInstructions(os)}`);
    } catch (error) {
      console.error("Profile export failed", error);
      setExportError("Unable to export your profile right now. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="dob-mismatch-overlay" role="dialog" aria-modal="true">
      <div className="dob-mismatch-modal">
        <div className="dob-mismatch-header">
          <div>
            <p className="dob-mismatch-eyebrow">Verification needed</p>
            <h3>Date of birth mismatch</h3>
            <p className="dob-mismatch-subtitle">
              The date of birth you entered during onboarding does not match the verified
              ID you submitted.
            </p>
          </div>
          <button
            type="button"
            className="dob-mismatch-close"
            aria-label="Dismiss warning"
            onClick={handleDismiss}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="dob-mismatch-body">
          <div className="dob-mismatch-callout">
            <strong>Account lock timeline</strong>
            <p>
              If the dates do not match, your account will be locked on{" "}
              <span className="dob-mismatch-date">{formatDate(dueAt)}</span>
              {typeof daysRemaining === "number"
                ? ` (${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining).`
                : "."}
            </p>
          </div>
          <p className="dob-mismatch-note">
            Update your birthday in profile settings if it is incorrect, or contact
            support if you believe this is a mistake.
          </p>
          <p className="dob-mismatch-note">
            You can export your full profile data (including photos and videos) before
            the lock takes effect.
          </p>
        </div>

        <div className="dob-mismatch-actions">
          <button
            type="button"
            className="dob-mismatch-btn primary"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? "Preparing export..." : "Export profile data"}
          </button>
          <a className="dob-mismatch-link" href="/me?section=security">
            Review birthday
          </a>
          <button type="button" className="dob-mismatch-btn ghost" onClick={handleDismiss}>
            Dismiss
          </button>
        </div>

        {exportError && <p className="status status-error">{exportError}</p>}
        {exportSuccess && <p className="status status-success">{exportSuccess}</p>}
      </div>
    </div>
  );
}
