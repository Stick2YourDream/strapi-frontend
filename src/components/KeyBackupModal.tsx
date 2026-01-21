import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import "../css/key-backup.css";

const MIN_PASSPHRASE_LENGTH = 12;

export default function KeyBackupModal() {
  const {
    user,
    keyBackupStatus,
    keyBackupLoading,
    keyBackupError,
    createKeyBackup,
    restoreKeyBackup,
  } = useAuth();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setPassphrase("");
    setConfirm("");
    setLocalError(null);
    setDismissed(false);
  }, [keyBackupStatus]);

  const mode = useMemo(() => {
    if (!user) return "hidden";
    if (keyBackupStatus === "needs-setup") return "setup";
    if (keyBackupStatus === "needs-restore") return "restore";
    return "hidden";
  }, [keyBackupStatus, user]);

  if (mode === "hidden" || dismissed) return null;

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
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setLocalError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      return;
    }
    await restoreKeyBackup(passphrase);
    setPassphrase("");
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
          <div className="key-backup-field">
            <label htmlFor="key-backup-passphrase">Passphrase</label>
            <input
              id="key-backup-passphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="Enter passphrase"
              autoComplete="new-password"
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
              disabled={keyBackupLoading}
            >
              {keyBackupLoading ? "Restoring..." : "Restore"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
