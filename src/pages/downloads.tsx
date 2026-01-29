import "../css/pwa.css";
import "../css/apps.css";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Downloads() {
  const apkUrl = "/downloads/yoursocialplace-android.apk";
  const desktopAppUrl =
    (import.meta.env.VITE_DESKTOP_APP_URL as string | undefined) ||
    "/downloads/desktop/videochat.exe";
  const windowsHelperUrl =
    (import.meta.env.VITE_WINDOWS_HELPER_URL as string | undefined) ||
    "/downloads/ysphelper.exe";
  const msixUrl = (import.meta.env.VITE_DESKTOP_MSIX_URL as string | undefined) || "";

  usePageMeta({
    title: "Downloads | Your Social Place",
    description:
      "Download the Your Social Place video call desktop app, Windows helper, and Android APK.",
    type: "website",
    canonical: "https://yoursocialplace.com/downloads",
    keywords:
      "Your Social Place downloads, video call desktop app, Windows helper, Android APK, MSIX",
  });

  return (
    <div className="pwa-shell apps-shell">
      <div className="pwa-card apps-card">
        <header className="pwa-header">
          <span className="pwa-eyebrow">Downloads</span>
          <h1>Download Your Social Place apps</h1>
          <p className="pwa-subhead">
            Grab the Windows video call desktop app, the Windows control helper, or the
            Android APK. Install the PWA from the Apps page if you want the browser-based
            install.
          </p>
        </header>

        <section className="pwa-section apps-downloads">
          <p className="pwa-label">Downloads</p>
          <div className="apps-download-grid">
            <article className="apps-download-card">
              <div>
                <h3>Windows video call app</h3>
                <p>
                  Standalone video call app for Windows (video only) with auto-updates built
                  in.
                </p>
              </div>
              <div className="apps-download-actions">
                <a className="pwa-button secondary" href={desktopAppUrl} download>
                  Download .exe
                </a>
                <span className="apps-download-meta">Best for Windows 10/11</span>
              </div>
            </article>

            <article className="apps-download-card">
              <div>
                <h3>Windows control helper</h3>
                <p>
                  Enables approved screen control during calls. Only needed for screen
                  control sessions.
                </p>
              </div>
              <div className="apps-download-actions">
                <a className="pwa-button secondary" href={windowsHelperUrl} download>
                  Download helper
                </a>
                <span className="apps-download-meta">Required for Windows control</span>
              </div>
            </article>

            <article className="apps-download-card">
              <div>
                <h3>Android APK</h3>
                <p>Manual install package for Android devices.</p>
              </div>
              <div className="apps-download-actions">
                <a className="pwa-button secondary" href={apkUrl} download>
                  Download APK
                </a>
                <span className="apps-download-meta">Manual install</span>
              </div>
            </article>

            {msixUrl ? (
              <article className="apps-download-card">
                <div>
                  <h3>Windows MSIX</h3>
                  <p>Install the Windows app package for managed devices or Store.</p>
                </div>
                <div className="apps-download-actions">
                  <a className="pwa-button secondary" href={msixUrl} download>
                    Download MSIX
                  </a>
                  <span className="apps-download-meta">Managed deployment</span>
                </div>
              </article>
            ) : null}
          </div>
        </section>

        <section className="pwa-section apps-update">
          <p className="pwa-label">Install options</p>
          <div className="pwa-value">
            Prefer a browser-based install? Visit the Apps page to install the PWA on
            Windows, macOS, or iOS.
          </div>
          <a className="pwa-button secondary" href="/apps">
            Go to Apps
          </a>
        </section>
      </div>
    </div>
  );
}
