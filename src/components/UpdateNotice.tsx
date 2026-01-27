import { useEffect, useState } from "react";
import "../css/update-notice.css";

const UPDATE_EVENT = "pwa:update-available";

export default function UpdateNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleUpdate = () => setVisible(true);
    window.addEventListener(UPDATE_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(UPDATE_EVENT, handleUpdate);
    };
  }, []);

  const handleRefresh = async () => {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    }
    window.location.reload();
  };

  if (!visible) return null;

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <div className="update-notice__content">
        <strong>Update available</strong>
        <span>Refresh to get the latest version of Your Social Place.</span>
      </div>
      <div className="update-notice__actions">
        <button className="update-notice__button" type="button" onClick={handleRefresh}>
          Refresh
        </button>
        <button
          className="update-notice__button update-notice__button--ghost"
          type="button"
          onClick={() => setVisible(false)}
        >
          Later
        </button>
      </div>
    </div>
  );
}
