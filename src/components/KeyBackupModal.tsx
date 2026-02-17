import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";
import { getDefaultDeviceLabel } from "../utils/device-approval";
import { getOrCreateDeviceId } from "../utils/device-id";
import {
  fetchRecoveryCodesStatus,
  regenerateRecoveryCodes,
  requestRecoveryEmailCode,
  verifyRecoveryEmailCode,
} from "../utils/crypto-recovery";
import "../css/key-backup.css";

export default function KeyBackupModal() {
  const {
    user,
    keyBackupStatus,
    keyBackupLoading,
    keyBackupError,
    refreshKeyBackup,
    refreshProfile,
    resetEncryptedProfile,
  } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [deviceRequestError, setDeviceRequestError] = useState<string | null>(null);
  const [deviceRequestLabel, setDeviceRequestLabel] = useState<string>(() =>
    getDefaultDeviceLabel()
  );
  const [trustActionLoading, setTrustActionLoading] = useState(false);
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
  const [showAlternateMethods, setShowAlternateMethods] = useState(false);
  const [trustedDeviceStatus, setTrustedDeviceStatus] = useState<
    "unknown" | "trusted" | "untrusted"
  >("unknown");
  const [trustedDeviceLoading, setTrustedDeviceLoading] = useState(false);

  useEffect(() => {
    setDismissed(false);
    setRestoreSuccess(false);
    setDeviceRequestError(null);
    setTrustActionLoading(false);
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
    setShowAlternateMethods(false);
    setTrustedDeviceStatus("unknown");
    setTrustedDeviceLoading(false);
  }, [keyBackupStatus]);

  const mode = useMemo(() => {
    if (!user) return "hidden";
    if (showRecoveryCodes) return "setup";
    if (keyBackupStatus === "needs-setup") return "setup";
    if (keyBackupStatus === "needs-restore") return "restore";
    return "hidden";
  }, [keyBackupStatus, showRecoveryCodes, user]);

  const shouldHideForTrustedDevice = mode === "restore" && trustedDeviceStatus === "trusted";
  const shouldDeferModal = mode === "restore" && trustedDeviceLoading;
  const isVisible =
    mode !== "hidden" && !dismissed && !shouldHideForTrustedDevice && !shouldDeferModal;
  const shouldShowAlternateMethods = mode !== "restore" || showAlternateMethods;

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
    if (mode !== "restore") return;
    setDeviceRequestLabel(getDefaultDeviceLabel());
  }, [mode]);

  useEffect(() => {
    if (mode !== "restore" || !user) {
      setTrustedDeviceStatus("unknown");
      setTrustedDeviceLoading(false);
      return;
    }
    let active = true;
    setTrustedDeviceLoading(true);
    const deviceId = getOrCreateDeviceId();
    api
      .get("/auth/trusted-devices", { params: { deviceId } })
      .then((res) => {
        if (!active) return;
        const devices = Array.isArray(res.data?.devices) ? res.data.devices : [];
        const isCurrent = devices.some((entry: any) => entry?.isCurrent === true);
        setTrustedDeviceStatus(isCurrent ? "trusted" : "untrusted");
        if (isCurrent) {
          setDismissed(true);
        }
      })
      .catch(() => {
        if (!active) return;
        setTrustedDeviceStatus("unknown");
      })
      .finally(() => {
        if (active) {
          setTrustedDeviceLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [mode, user]);

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

  if (!isVisible) return null;

  const showTrustPrompt = mode === "restore" && !shouldShowAlternateMethods;
  const trustActionDisabled = trustActionLoading || restoreSuccess || resetSuccess;

  const handleTrustChoice = async () => {
    if (!user) return;
    if (trustActionLoading) return;
    setDeviceRequestError(null);
    setTrustActionLoading(true);
    try {
      const deviceId = getOrCreateDeviceId();
      const label = getDefaultDeviceLabel();
      setDeviceRequestLabel(label);
      await api.post("/auth/trusted-devices/trust", {
        deviceId,
        deviceLabel: label,
      });
      setTrustedDeviceStatus("trusted");
      await refreshKeyBackup();
      await refreshProfile();
      setRestoreSuccess(true);
    } catch {
      setDeviceRequestError("Unable to trust this device.");
    } finally {
      setTrustActionLoading(false);
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
            {mode === "setup" ? "Your recovery codes" : "Restore encrypted profile"}
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
              ? "Save these one-time recovery codes somewhere safe. They can reset your encrypted profile in an emergency."
              : shouldShowAlternateMethods
              ? "Use a recovery option to reset your encrypted profile."
              : "You're logged in. Trust this device to restore your encrypted profile."}
          </p>
          {mode === "restore" && (
            <p className="key-backup-hint">
              We'll refresh this page after restoring so your encrypted profile loads everywhere.
            </p>
          )}
          {showTrustPrompt && (
            <div className="key-backup-trust-card">
              <div className="key-backup-trust-hero">
                <div className="key-backup-trust-art" aria-hidden="true">
                  <svg viewBox="0 0 140 140" role="img" aria-label="">
                    <rect x="46" y="16" width="54" height="96" rx="12" fill="#0b0f1c" />
                    <rect x="52" y="24" width="42" height="72" rx="8" fill="#1d2a4a" />
                    <rect x="60" y="102" width="26" height="6" rx="3" fill="#2b3a60" />
                    <path
                      d="M24 82c0-10 8-18 18-18h18c8 0 14 6 14 14v30c0 8-6 14-14 14H42c-10 0-18-8-18-18V82Z"
                      fill="#f2d6c7"
                    />
                    <path
                      d="M56 64c0-6 5-10 10-10h12c6 0 10 4 10 10v20c0 6-4 10-10 10H66c-6 0-10-4-10-10V64Z"
                      fill="#e9c3b1"
                    />
                    <path
                      d="M36 70c-5 0-9 4-9 9v18c0 5 4 9 9 9h18"
                      stroke="#d9b09e"
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div>
                  <h4>You're logged in</h4>
                  <p className="key-backup-hint">Do you want to trust this device?</p>
                </div>
              </div>
              <div className="key-backup-trust-device">
                <span className="key-backup-trust-label">Trusted device name</span>
                <strong>{deviceRequestLabel || "Current device"}</strong>
              </div>
              <p className="key-backup-hint">
                We'll trust this device and restore your encrypted profile automatically.
              </p>
              {deviceRequestError && (
                <p className="key-backup-error">{deviceRequestError}</p>
              )}
              <div className="key-backup-trust-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void handleTrustChoice()}
                  disabled={trustActionDisabled}
                >
                  {trustActionLoading ? "Restoring..." : "Trust this device"}
                </button>
              </div>
            </div>
          )}
          {mode === "restore" && shouldShowAlternateMethods && (
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
          {mode === "restore" && shouldShowAlternateMethods && (
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
          {mode === "restore" && shouldShowAlternateMethods && (
            <p className="key-backup-hint">
              Resetting will permanently erase encrypted fields like phone, birthday, and
              private details.
            </p>
          )}
          {restoreSuccess && (
            <p className="key-backup-hint">Restored. Refreshing now...</p>
          )}
          {mode === "setup" && (
            <div className="key-backup-device">
              <h4>Recovery codes</h4>
              <p className="key-backup-hint">
                Save these codes. Each can be used once to reset your encrypted profile if
                you lose access to your device.
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
                  Recovery codes appear after we generate them.
                </p>
              )}
            </div>
          )}
          {keyBackupError && <p className="key-backup-error">{keyBackupError}</p>}
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
          {mode === "setup" && (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setShowRecoveryCodes(false);
                setDismissed(true);
              }}
              disabled={recoveryCodesLoading}
            >
              Done
            </button>
          )}
          {mode === "restore" && !shouldShowAlternateMethods && (
            <button
              type="button"
              className="btn primary"
              onClick={() => setShowAlternateMethods(true)}
            >
              Try Another Way
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
