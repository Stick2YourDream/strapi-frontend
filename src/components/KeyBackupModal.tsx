import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  clearPendingDeviceKeyRequestId,
  consumeDeviceKeyApproval,
  fetchDeviceKeyRequestStatus,
  getDefaultDeviceLabel,
  getPendingDeviceKeyRequestId,
  requestDeviceKeyApproval,
} from "../utils/device-approval";
import "../css/key-backup.css";

const MIN_PASSPHRASE_LENGTH = 12;
const MAX_RESTORE_ATTEMPTS = 5;

export default function KeyBackupModal() {
  const {
    user,
    keyBackupStatus,
    keyBackupLoading,
    keyBackupError,
    refreshKeyBackup,
    refreshProfile,
    createKeyBackup,
    restoreKeyBackup,
  } = useAuth();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [restoreAttempts, setRestoreAttempts] = useState(0);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [deviceRequestId, setDeviceRequestId] = useState<string | null>(null);
  const [deviceRequestError, setDeviceRequestError] = useState<string | null>(null);
  const [deviceRequestStatus, setDeviceRequestStatus] = useState<
    "idle" | "requesting" | "pending" | "approved" | "rejected" | "expired"
  >("idle");
  const [deviceRequestExpiresAt, setDeviceRequestExpiresAt] = useState<number | null>(
    null
  );
  const [deviceRequestLoading, setDeviceRequestLoading] = useState(false);

  useEffect(() => {
    setPassphrase("");
    setConfirm("");
    setLocalError(null);
    setDismissed(false);
    setRestoreAttempts(0);
    setRestoreSuccess(false);
    setDeviceRequestError(null);
    setDeviceRequestStatus("idle");
    setDeviceRequestExpiresAt(null);
    setDeviceRequestLoading(false);
  }, [keyBackupStatus]);

  const mode = useMemo(() => {
    if (!user) return "hidden";
    if (keyBackupStatus === "needs-setup") return "setup";
    if (keyBackupStatus === "needs-restore") return "restore";
    return "hidden";
  }, [keyBackupStatus, user]);

  useEffect(() => {
    if (!restoreSuccess || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      window.location.reload();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [restoreSuccess]);

  useEffect(() => {
    if (mode !== "restore") {
      setDeviceRequestId(null);
      return;
    }
    const pendingId = getPendingDeviceKeyRequestId();
    if (pendingId) {
      setDeviceRequestId(pendingId);
      setDeviceRequestStatus("pending");
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "restore" || !deviceRequestId || !user) return;
    let active = true;
    let timer: number | null = null;

    const poll = async () => {
      if (!active) return;
      try {
        const status = await fetchDeviceKeyRequestStatus(deviceRequestId);
        if (!active) return;
        if (status?.expiresAt) {
          setDeviceRequestExpiresAt(Number(status.expiresAt) || null);
        }
        if (status?.status === "approved") {
          const applied = await consumeDeviceKeyApproval(user.id, status);
          if (applied) {
            await refreshKeyBackup();
            await refreshProfile();
            setRestoreSuccess(true);
            setDeviceRequestStatus("approved");
            setDeviceRequestId(null);
            clearPendingDeviceKeyRequestId();
            return;
          }
        }
        if (status?.status === "rejected" || status?.status === "expired") {
          setDeviceRequestStatus(status.status);
          setDeviceRequestId(null);
          clearPendingDeviceKeyRequestId();
          return;
        }
        setDeviceRequestStatus("pending");
      } catch {
        setDeviceRequestError("Unable to check approval status.");
      }
      timer = window.setTimeout(poll, 4000);
    };

    poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [mode, deviceRequestId, user, refreshKeyBackup, refreshProfile]);

  if (mode === "hidden" || dismissed) return null;

  const remainingAttempts = MAX_RESTORE_ATTEMPTS - restoreAttempts;
  const isRestoreLocked = mode === "restore" && remainingAttempts <= 0;
  const disableRestore = keyBackupLoading || isRestoreLocked || restoreSuccess;

  const handleCreate = async () => {
    setLocalError(null);
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setLocalError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      return;
    }
    if (passphrase !== confirm) {
      setLocalError("Passphrases do not match.");
      return;
    }
    await createKeyBackup(passphrase);
    setPassphrase("");
    setConfirm("");
  };

  const handleRestore = async () => {
    setLocalError(null);
    if (isRestoreLocked) {
      setLocalError("Too many incorrect attempts. Reload to try again.");
      return;
    }
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setLocalError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      return;
    }
    const success = await restoreKeyBackup(passphrase);
    setPassphrase("");
    if (success) {
      setRestoreSuccess(true);
      return;
    }
    setRestoreAttempts((prev) => {
      const next = prev + 1;
      const nextRemaining = Math.max(0, MAX_RESTORE_ATTEMPTS - next);
      setLocalError(
        nextRemaining > 0
          ? `Incorrect passphrase. ${nextRemaining} attempt${nextRemaining === 1 ? "" : "s"} remaining.`
          : "Too many incorrect attempts. Reload to try again."
      );
      return next;
    });
  };

  const handleRequestApproval = async () => {
    if (!user) return;
    setDeviceRequestError(null);
    setDeviceRequestLoading(true);
    setDeviceRequestStatus("requesting");
    try {
      const response = await requestDeviceKeyApproval(getDefaultDeviceLabel());
      setDeviceRequestId(response.requestId);
      setDeviceRequestStatus("pending");
      setDeviceRequestExpiresAt(response.expiresAt ? Number(response.expiresAt) : null);
    } catch {
      setDeviceRequestError("Unable to request approval. Try again.");
      setDeviceRequestStatus("idle");
    } finally {
      setDeviceRequestLoading(false);
    }
  };

  const handleCancelApproval = () => {
    clearPendingDeviceKeyRequestId();
    setDeviceRequestId(null);
    setDeviceRequestStatus("idle");
    setDeviceRequestError(null);
    setDeviceRequestExpiresAt(null);
  };

  return (
    <div className="key-backup-overlay" role="dialog" aria-modal="true">
      <div className="key-backup-modal">
        <div className="key-backup-header">
          <h3>
            {mode === "setup" ? "Secure your encrypted profile" : "Restore encrypted profile"}
          </h3>
          <button
            type="button"
            className="key-backup-close"
            onClick={() => setDismissed(true)}
            disabled={keyBackupLoading}
          >
            Close
          </button>
        </div>
        <div className="key-backup-body">
          <p>
            {mode === "setup"
              ? "Create a passphrase to unlock your encrypted profile on new devices. Your Social Place never stores this passphrase."
              : "Enter your passphrase to restore your encrypted profile on this device."}
          </p>
          {mode === "restore" && (
            <p className="key-backup-hint">
              We'll refresh this page after restoring so your encrypted profile loads everywhere.
            </p>
          )}
          {mode === "restore" && (
            <div className="key-backup-device">
              <h4>Approve from a trusted device</h4>
              <p className="key-backup-hint">
                Request approval on a device you already trust. Once approved, we'll
                restore your encrypted profile and refresh this page.
              </p>
              <div className="key-backup-device-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void handleRequestApproval()}
                  disabled={deviceRequestLoading || deviceRequestStatus === "pending"}
                >
                  {deviceRequestLoading ? "Requesting..." : "Request approval"}
                </button>
                {deviceRequestId && (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={handleCancelApproval}
                    disabled={deviceRequestLoading}
                  >
                    Cancel request
                  </button>
                )}
              </div>
              {deviceRequestStatus === "pending" && (
                <p className="key-backup-hint">
                  Waiting for approval
                  {deviceRequestExpiresAt
                    ? ` (expires ${new Date(deviceRequestExpiresAt).toLocaleTimeString()}).`
                    : "."}
                </p>
              )}
              {deviceRequestStatus === "approved" && (
                <p className="key-backup-hint">Approved. Restoring now...</p>
              )}
              {deviceRequestStatus === "rejected" && (
                <p className="key-backup-hint">Request rejected. Try again.</p>
              )}
              {deviceRequestStatus === "expired" && (
                <p className="key-backup-hint">Request expired. Please request again.</p>
              )}
              {deviceRequestError && (
                <p className="key-backup-error">{deviceRequestError}</p>
              )}
            </div>
          )}
          {mode === "restore" && (
            <p className="key-backup-hint">
              Attempts remaining: {Math.max(0, remainingAttempts)} of {MAX_RESTORE_ATTEMPTS}
            </p>
          )}
          {restoreSuccess && (
            <p className="key-backup-hint">Restored. Refreshing now...</p>
          )}
          <div className="key-backup-field">
            <label htmlFor="key-backup-passphrase">Passphrase</label>
            <input
              id="key-backup-passphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="Enter passphrase"
              autoComplete="new-password"
              disabled={mode === "restore" ? disableRestore : keyBackupLoading}
            />
          </div>
          {mode === "setup" && (
            <div className="key-backup-field">
              <label htmlFor="key-backup-confirm">Confirm passphrase</label>
              <input
                id="key-backup-confirm"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Re-enter passphrase"
                autoComplete="new-password"
              />
            </div>
          )}
          {(localError || keyBackupError) && (
            <p className="key-backup-error">{localError || keyBackupError}</p>
          )}
        </div>
        <div className="key-backup-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setDismissed(true)}
            disabled={keyBackupLoading}
          >
            Later
          </button>
          {mode === "setup" ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleCreate()}
              disabled={keyBackupLoading}
            >
              {keyBackupLoading ? "Saving..." : "Save passphrase"}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleRestore()}
              disabled={disableRestore}
            >
              {restoreSuccess ? "Refreshing..." : keyBackupLoading ? "Restoring..." : "Restore"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
