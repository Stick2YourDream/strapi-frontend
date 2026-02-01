import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  clearPendingDeviceKeyRequestId,
  consumeDeviceKeyApproval,
  fetchDeviceKeyRequestStatus,
  getDefaultDeviceLabel,
  getPendingDeviceKeyRequestId,
  requestDeviceKeyApproval,
} from "../utils/device-approval";
import {
  fetchRecoveryCodesStatus,
  regenerateRecoveryCodes,
  requestRecoveryEmailCode,
  verifyRecoveryEmailCode,
} from "../utils/crypto-recovery";
import "../css/key-backup.css";

const MIN_PASSPHRASE_LENGTH = 8;
const MAX_RESTORE_ATTEMPTS = 5;

export default function KeyBackupModal() {
  const navigate = useNavigate();
  const {
    user,
    keyBackupStatus,
    keyBackupLoading,
    keyBackupError,
    refreshKeyBackup,
    refreshProfile,
    createKeyBackup,
    restoreKeyBackup,
    resetEncryptedProfile,
  } = useAuth();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [restoreAttempts, setRestoreAttempts] = useState(0);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [deviceRequestId, setDeviceRequestId] = useState<string | null>(null);
  const [deviceRequestError, setDeviceRequestError] = useState<string | null>(null);
  const [deviceRequestLabel, setDeviceRequestLabel] = useState<string>(() =>
    getDefaultDeviceLabel()
  );
  const [deviceRequestStatus, setDeviceRequestStatus] = useState<
    "idle" | "requesting" | "pending" | "approved" | "rejected" | "expired"
  >("idle");
  const [deviceRequestExpiresAt, setDeviceRequestExpiresAt] = useState<number | null>(
    null
  );
  const [deviceRequestLoading, setDeviceRequestLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [recoveryEmailCode, setRecoveryEmailCode] = useState("");
  const [recoveryEmailHint, setRecoveryEmailHint] = useState<string | null>(null);
  const [recoveryEmailError, setRecoveryEmailError] = useState<string | null>(null);
  const [recoveryEmailLoading, setRecoveryEmailLoading] = useState(false);
  const [recoveryCodeValue, setRecoveryCodeValue] = useState("");
  const [recoveryCodeError, setRecoveryCodeError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryCodesLoading, setRecoveryCodesLoading] = useState(false);
  const [recoveryCodesError, setRecoveryCodesError] = useState<string | null>(null);
  const [recoveryCodesCopied, setRecoveryCodesCopied] = useState(false);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const justCreatedRef = useRef(false);

  useEffect(() => {
    if (justCreatedRef.current && keyBackupStatus === "ready") {
      justCreatedRef.current = false;
      setShowRecoveryCodes(true);
      return;
    }
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
    setCopyStatus(null);
    setResetSuccess(false);
    setRecoveryEmailCode("");
    setRecoveryEmailHint(null);
    setRecoveryEmailError(null);
    setRecoveryEmailLoading(false);
    setRecoveryCodeValue("");
    setRecoveryCodeError(null);
    setRecoveryCodes(null);
    setRecoveryCodesLoading(false);
    setRecoveryCodesError(null);
    setRecoveryCodesCopied(false);
    setShowRecoveryCodes(false);
  }, [keyBackupStatus]);

  const mode = useMemo(() => {
    if (!user) return "hidden";
    if (showRecoveryCodes) return "setup";
    if (keyBackupStatus === "needs-setup") return "setup";
    if (keyBackupStatus === "needs-restore") return "restore";
    return "hidden";
  }, [keyBackupStatus, showRecoveryCodes, user]);

  const isVisible = mode !== "hidden" && !dismissed;
  const isRecoveryCodesOnly = showRecoveryCodes && keyBackupStatus === "ready";

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("key-backup-active", isVisible);
    document.documentElement.classList.toggle("key-backup-active", isVisible);
    return () => {
      document.body.classList.remove("key-backup-active");
      document.documentElement.classList.remove("key-backup-active");
    };
  }, [isVisible]);

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
      setDeviceRequestLabel(getDefaultDeviceLabel());
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

  useEffect(() => {
    if (!user) return;
    if (dismissed) return;
    if (keyBackupStatus !== "ready") return;
    if (showRecoveryCodes) return;
    let active = true;

    const ensureRecoveryCodes = async () => {
      try {
        const status = await fetchRecoveryCodesStatus();
        if (!active) return;
        if (!status?.hasCodes) {
          setRecoveryCodesLoading(true);
          const codes = await regenerateRecoveryCodes();
          if (!active) return;
          setRecoveryCodes(codes);
          setShowRecoveryCodes(true);
        }
      } catch {
        if (!active) return;
        setRecoveryCodesError("Unable to generate recovery codes.");
      } finally {
        if (active) {
          setRecoveryCodesLoading(false);
        }
      }
    };

    void ensureRecoveryCodes();
    return () => {
      active = false;
    };
  }, [dismissed, keyBackupStatus, showRecoveryCodes, user]);

  if (mode === "hidden" || dismissed) return null;

  const remainingAttempts = MAX_RESTORE_ATTEMPTS - restoreAttempts;
  const isRestoreLocked = mode === "restore" && remainingAttempts <= 0;
  const disableRestore = keyBackupLoading || isRestoreLocked || restoreSuccess || resetSuccess;

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
    justCreatedRef.current = true;
    const created = await createKeyBackup(passphrase);
    if (!created) {
      justCreatedRef.current = false;
      return;
    }
    setPassphrase("");
    setConfirm("");
    setRecoveryCodesError(null);
    setRecoveryCodesCopied(false);
    try {
      setRecoveryCodesLoading(true);
      const status = await fetchRecoveryCodesStatus();
      if (!status?.hasCodes) {
        const codes = await regenerateRecoveryCodes();
        setRecoveryCodes(codes);
      }
      setShowRecoveryCodes(true);
    } catch {
      setRecoveryCodesError("Unable to generate recovery codes.");
    } finally {
      setRecoveryCodesLoading(false);
    }
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
    setCopyStatus(null);
    setDeviceRequestLoading(true);
    setDeviceRequestStatus("requesting");
    try {
      const label = getDefaultDeviceLabel();
      setDeviceRequestLabel(label);
      const response = await requestDeviceKeyApproval(label);
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
    setCopyStatus(null);
  };

  const handleOpenSecurity = () => {
    setDismissed(true);
    navigate("/me?section=security");
  };

  const handleCopySecurityLink = async () => {
    if (typeof window === "undefined") return;
    const link = `${window.location.origin}/me?section=security`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        setCopyStatus("Security link copied.");
        return;
      }
      setCopyStatus("Copy not supported on this device.");
    } catch {
      setCopyStatus("Unable to copy the link.");
    }
  };

  const handleSendRecoveryEmail = async () => {
    setRecoveryEmailError(null);
    setRecoveryEmailLoading(true);
    try {
      const result = await requestRecoveryEmailCode();
      setRecoveryEmailHint(result?.deliveryHint || null);
    } catch {
      setRecoveryEmailError("Unable to send recovery code.");
    } finally {
      setRecoveryEmailLoading(false);
    }
  };

  const handleVerifyRecoveryEmail = async () => {
    setRecoveryEmailError(null);
    if (!recoveryEmailCode.trim()) {
      setRecoveryEmailError("Enter the recovery code from your email.");
      return;
    }
    setRecoveryEmailLoading(true);
    try {
      const result = await verifyRecoveryEmailCode(recoveryEmailCode.trim());
      const token = result?.token;
      if (!token) {
        setRecoveryEmailError("Unable to verify the recovery code.");
        return;
      }
      const success = await resetEncryptedProfile({ recoveryToken: token });
      if (!success) {
        setRecoveryEmailError("Unable to reset encrypted profile.");
        return;
      }
      setResetSuccess(true);
      if (typeof window !== "undefined") {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    } catch {
      setRecoveryEmailError("Unable to verify the recovery code.");
    } finally {
      setRecoveryEmailLoading(false);
    }
  };

  const handleUseRecoveryCode = async () => {
    setRecoveryCodeError(null);
    if (!recoveryCodeValue.trim()) {
      setRecoveryCodeError("Enter a recovery code.");
      return;
    }
    const success = await resetEncryptedProfile({
      recoveryCode: recoveryCodeValue.trim(),
    });
    if (!success) {
      setRecoveryCodeError("Recovery code invalid or already used.");
      return;
    }
    setResetSuccess(true);
    if (typeof window !== "undefined") {
      window.setTimeout(() => window.location.reload(), 1200);
    }
  };

  const handleCopyRecoveryCodes = async () => {
    if (!recoveryCodes?.length || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard?.writeText(recoveryCodes.join("\n"));
      setRecoveryCodesCopied(true);
    } catch {
      setRecoveryCodesCopied(false);
    }
  };

  return (
    <div className="key-backup-overlay" role="dialog" aria-modal="true">
      <div className="key-backup-modal">
        <div className="key-backup-header">
          <h3>
            {mode === "setup"
              ? isRecoveryCodesOnly
                ? "Your recovery codes"
                : "Secure your encrypted profile"
              : "Restore encrypted profile"}
          </h3>
          <button
            type="button"
            className="key-backup-close"
            onClick={() => {
              setShowRecoveryCodes(false);
              setDismissed(true);
            }}
            disabled={keyBackupLoading}
          >
            Close
          </button>
        </div>
        <div className="key-backup-body">
          <p>
            {mode === "setup"
              ? isRecoveryCodesOnly
                ? "Save these one-time recovery codes somewhere safe. They can reset your encrypted profile if you forget your passphrase."
                : "Create a passphrase to unlock your encrypted profile on new devices. Your Social Place never stores this passphrase."
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
              <ol className="key-backup-steps">
                <li>
                  Open Your Social Place on a trusted device (one you have already approved).
                </li>
                <li>Go to Me → Security → Device approval requests.</li>
                <li>
                  Approve the request for{" "}
                  <strong>{deviceRequestLabel || "this device"}</strong>.
                </li>
              </ol>
              <div className="key-backup-device-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void handleRequestApproval()}
                  disabled={deviceRequestLoading || deviceRequestStatus === "pending"}
                >
                  {deviceRequestLoading ? "Requesting..." : "Request approval"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={handleOpenSecurity}
                >
                  Open Security settings
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={handleCopySecurityLink}
                >
                  Copy security link
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
              {copyStatus && <p className="key-backup-hint">{copyStatus}</p>}
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
            <div className="key-backup-device">
              <h4>Recover with email code</h4>
              <p className="key-backup-hint">
                We will send a 6-digit recovery code to {user?.email}.
              </p>
              <p className="key-backup-hint">
                Resetting will permanently erase encrypted fields like phone, birthday, and
                private details.
              </p>
              <div className="key-backup-device-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void handleSendRecoveryEmail()}
                  disabled={recoveryEmailLoading || keyBackupLoading}
                >
                  {recoveryEmailLoading ? "Sending..." : "Send recovery code"}
                </button>
              </div>
              {recoveryEmailHint && (
                <p className="key-backup-hint">Sent to {recoveryEmailHint}.</p>
              )}
              <div className="key-backup-field">
                <label htmlFor="key-backup-email-code">Recovery code</label>
                <input
                  id="key-backup-email-code"
                  type="text"
                  value={recoveryEmailCode}
                  onChange={(event) => setRecoveryEmailCode(event.target.value)}
                  placeholder="Enter code"
                  disabled={recoveryEmailLoading || keyBackupLoading || resetSuccess}
                />
              </div>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void handleVerifyRecoveryEmail()}
                disabled={recoveryEmailLoading || keyBackupLoading || resetSuccess}
              >
                {recoveryEmailLoading ? "Verifying..." : "Verify & reset"}
              </button>
              {recoveryEmailError && (
                <p className="key-backup-error">{recoveryEmailError}</p>
              )}
            </div>
          )}
          {mode === "restore" && (
            <div className="key-backup-device key-backup-danger">
              <h4>Use a recovery code</h4>
              <p className="key-backup-hint">
                Enter one of your recovery codes to reset your encrypted profile.
              </p>
              <p className="key-backup-hint">
                Resetting will permanently erase encrypted fields like phone, birthday, and
                private details.
              </p>
              <div className="key-backup-field">
                <label htmlFor="key-backup-recovery-code">Recovery code</label>
                <input
                  id="key-backup-recovery-code"
                  type="text"
                  value={recoveryCodeValue}
                  onChange={(event) => setRecoveryCodeValue(event.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  disabled={keyBackupLoading || resetSuccess}
                />
              </div>
              {recoveryCodeError && <p className="key-backup-error">{recoveryCodeError}</p>}
              {resetSuccess && (
                <p className="key-backup-hint">Encrypted profile reset. Refreshing...</p>
              )}
              <button
                type="button"
                className="btn danger"
                onClick={() => void handleUseRecoveryCode()}
                disabled={keyBackupLoading || resetSuccess}
              >
                {keyBackupLoading ? "Resetting..." : "Use recovery code"}
              </button>
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
          {!isRecoveryCodesOnly && (
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
          )}
          {mode === "setup" && !isRecoveryCodesOnly && (
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
          {mode === "setup" && (
            <div className="key-backup-device">
              <h4>Recovery codes</h4>
              <p className="key-backup-hint">
                Save these codes. Each can be used once to recover your encrypted profile if
                you forget your passphrase.
              </p>
              {recoveryCodesLoading && <p className="key-backup-hint">Generating codes…</p>}
              {recoveryCodesError && (
                <p className="key-backup-error">{recoveryCodesError}</p>
              )}
              {recoveryCodes?.length ? (
                <>
                  <div className="key-backup-code-grid">
                    {recoveryCodes.map((code) => (
                      <span key={code} className="key-backup-code">
                        {code}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => void handleCopyRecoveryCodes()}
                    disabled={recoveryCodesCopied}
                  >
                    {recoveryCodesCopied ? "Copied" : "Copy recovery codes"}
                  </button>
                  {recoveryCodesCopied && (
                    <p className="key-backup-hint">Recovery codes copied.</p>
                  )}
                </>
              ) : (
                <p className="key-backup-hint">
                  Recovery codes appear after you save your passphrase.
                </p>
              )}
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
            onClick={() => {
              setShowRecoveryCodes(false);
              setDismissed(true);
            }}
            disabled={keyBackupLoading}
          >
            Later
          </button>
          {mode === "setup" ? (
            isRecoveryCodesOnly ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setShowRecoveryCodes(false);
                  setDismissed(true);
                }}
              >
                Done
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => void handleCreate()}
                disabled={keyBackupLoading}
              >
                {keyBackupLoading ? "Saving..." : "Save passphrase"}
              </button>
            )
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
