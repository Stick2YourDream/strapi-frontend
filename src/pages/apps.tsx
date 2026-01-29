import { useEffect, useMemo, useState } from "react";
import "../css/downloads-page.css";
import { usePageMeta } from "../hooks/usePageMeta";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const isStandaloneMode = () => {
  if (typeof window === "undefined") return false;
  const standaloneMatch = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = Boolean((navigator as { standalone?: boolean }).standalone);
  return standaloneMatch || iosStandalone;
};

const detectPlatform = () => {
  if (typeof navigator === "undefined") {
    return { isIos: false, isAndroid: false, isWindows: false, isMac: false };
  }
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    "";
  const ua = navigator.userAgent || "";
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isWindows = /Win/i.test(platform) || /Windows/i.test(ua);
  const isMac = /Mac/i.test(platform) || /Macintosh/i.test(ua);
  return { isIos, isAndroid, isWindows, isMac };
};

export default function Apps() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [isStandalone, setIsStandalone] = useState(isStandaloneMode());
  const [platform, setPlatform] = useState(detectPlatform());
  const apkVersion = (import.meta.env.VITE_ANDROID_APK_VERSION as string | undefined) || "";
  const apkCode = (import.meta.env.VITE_ANDROID_APK_CODE as string | undefined) || "";
  const desktopAppUrl =
    (import.meta.env.VITE_DESKTOP_APP_URL as string | undefined) ||
    "/downloads/desktop/videochat.exe";
  const windowsHelperUrl =
    (import.meta.env.VITE_WINDOWS_HELPER_URL as string | undefined) ||
    "/downloads/ysphelper.exe";
  const msixUrl = (import.meta.env.VITE_DESKTOP_MSIX_URL as string | undefined) || "";

  usePageMeta({
    title: "Apps & Downloads | Your Social Place",
    description:
      "Download YSP Live, the Windows control helper, or install the Your Social Place PWA on any device.",
    type: "website",
    canonical: "https://yoursocialplace.com/apps",
    keywords:
      "Your Social Place downloads, YSP Live, Windows helper, Android APK, PWA install, iOS install, macOS install",
  });

  useEffect(() => {
    setPlatform(detectPlatform());

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    const media = window.matchMedia("(display-mode: standalone)");
    const handleDisplayChange = () => setIsStandalone(isStandaloneMode());
    media.addEventListener("change", handleDisplayChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
      media.removeEventListener("change", handleDisplayChange);
    };
  }, []);

  const installHint = useMemo(() => {
    if (isStandalone) {
      return "You're already running the installed web app on this device.";
    }
    if (platform.isIos) {
      return "On iPhone or iPad, open in Safari and tap Share → Add to Home Screen.";
    }
    if (installPrompt) {
      return "Tap Install to add the web app to your device.";
    }
    return "Open in Chrome or Edge to see the install button in the address bar.";
  }, [installPrompt, isStandalone, platform.isIos]);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const apkUrl = "/downloads/yoursocialplace-android.apk";
  const apkLabel = useMemo(() => {
    if (!apkVersion && !apkCode) {
      return "Build info will appear after the next deploy.";
    }
    const versionPart = apkVersion ? `v${apkVersion}` : "Version";
    const codePart = apkCode ? ` (code ${apkCode})` : "";
    return `${versionPart}${codePart}`;
  }, [apkCode, apkVersion]);

  const installButtonLabel = isStandalone ? "Web app installed" : "Install web app";

  return (
    <div className="downloads-page">
      <div className="downloads-shell">
        <section className="downloads-hero">
          <div className="downloads-hero__content">
            <span className="downloads-eyebrow">Apps & Downloads</span>
            <h1>Everything you need to stay focused and connected.</h1>
            <p>
              Get YSP Live for distraction-free video calls, install the web app on any
              device, or grab the Android APK when you need a manual install.
            </p>
            <div className="downloads-hero__actions">
              <a className="downloads-button primary" href={desktopAppUrl} download>
                Download YSP Live
              </a>
              <button
                className="downloads-button ghost"
                type="button"
                onClick={handleInstall}
                disabled={!installPrompt || isStandalone}
              >
                {installButtonLabel}
              </button>
            </div>
            <p className="downloads-hint">{installHint}</p>
            <div className="downloads-hero__meta">
              <div>
                <span className="downloads-meta-label">Best for</span>
                <strong>Windows 10/11</strong>
              </div>
              <div>
                <span className="downloads-meta-label">Web app</span>
                <strong>PWA on desktop & mobile</strong>
              </div>
              <div>
                <span className="downloads-meta-label">Android APK</span>
                <strong>{apkLabel}</strong>
              </div>
            </div>
          </div>

          <div className="downloads-hero__panel">
            <div className="downloads-panel">
              <h3>Quick start</h3>
              <ol className="downloads-steps">
                <li>
                  <span>1</span>
                  Download YSP Live for Windows.
                </li>
                <li>
                  <span>2</span>
                  Log in with your Your Social Place account.
                </li>
                <li>
                  <span>3</span>
                  Start a call or invite your group instantly.
                </li>
              </ol>
            </div>
            <div className="downloads-panel downloads-panel--accent">
              <h3>Install the web app</h3>
              <p>{installHint}</p>
              <div className="downloads-panel__actions">
                <button
                  className="downloads-button primary"
                  type="button"
                  onClick={handleInstall}
                  disabled={!installPrompt || isStandalone}
                >
                  {installButtonLabel}
                </button>
                <a className="downloads-button secondary" href={apkUrl} download>
                  Download Android APK
                </a>
              </div>
              <p className="downloads-panel__hint">
                Android installs may require enabling “Install unknown apps” for your
                browser.
              </p>
            </div>
          </div>
        </section>

        <section id="downloads" className="downloads-grid">
          <article className="downloads-card downloads-card--featured">
            <div>
              <div className="downloads-card__title">
                <h2>YSP Live (Windows)</h2>
                <span className="downloads-chip">Recommended</span>
              </div>
              <p>
                Standalone Windows app focused on video calls and screen sharing without the
                rest of the social feed.
              </p>
              <ul className="downloads-list">
                <li>Video-only experience</li>
                <li>Optimized for accountability calls</li>
                <li>Works with Your Social Place login</li>
              </ul>
            </div>
            <div className="downloads-card__actions">
              <a className="downloads-button primary" href={desktopAppUrl} download>
                Download
              </a>
              <span className="downloads-meta-note">Windows 10/11</span>
            </div>
          </article>

          <article className="downloads-card">
            <div>
              <h2>Windows control helper</h2>
              <p>
                Enables approved screen control during calls. Only install if you plan to
                use screen control sessions.
              </p>
              <ul className="downloads-list">
                <li>Required for remote control</li>
                <li>Works alongside YSP Live</li>
              </ul>
            </div>
            <div className="downloads-card__actions">
              <a className="downloads-button secondary" href={windowsHelperUrl} download>
                Download helper
              </a>
              <span className="downloads-meta-note">Optional add-on</span>
            </div>
          </article>

          <article className="downloads-card">
            <div>
              <h2>Android APK</h2>
              <p>Manual install package for Android devices.</p>
              <ul className="downloads-list">
                <li>Install directly on Android</li>
                <li>Manual updates</li>
              </ul>
            </div>
            <div className="downloads-card__actions">
              <a className="downloads-button secondary" href={apkUrl} download>
                Download APK
              </a>
              <span className="downloads-meta-note">{apkLabel}</span>
            </div>
          </article>

          {msixUrl ? (
            <article className="downloads-card">
              <div>
                <h2>Windows MSIX</h2>
                <p>Install the Windows app package for managed devices or Store use.</p>
                <ul className="downloads-list">
                  <li>Managed deployments</li>
                  <li>Enterprise-ready packaging</li>
                </ul>
              </div>
              <div className="downloads-card__actions">
                <a className="downloads-button secondary" href={msixUrl} download>
                  Download MSIX
                </a>
                <span className="downloads-meta-note">Managed installs</span>
              </div>
            </article>
          ) : null}
        </section>

        <section className="downloads-guides">
          <header className="downloads-guides__header">
            <h2>Install guides</h2>
            <p>Step-by-step help for installing the Your Social Place web app.</p>
          </header>
          <div className="downloads-guides__grid">
            <article className="downloads-guide-card">
              <h3>Windows (PWA)</h3>
              <ol className="downloads-steps">
                <li>
                  <span>1</span>
                  Open the site in Edge or Chrome.
                </li>
                <li>
                  <span>2</span>
                  Click the install icon in the address bar.
                </li>
                <li>
                  <span>3</span>
                  Launch from the Start menu.
                </li>
              </ol>
            </article>

            <article className="downloads-guide-card">
              <h3>macOS</h3>
              <ol className="downloads-steps">
                <li>
                  <span>1</span>
                  Open in Safari 17+ or Chrome.
                </li>
                <li>
                  <span>2</span>
                  Safari: File → Add to Dock.
                </li>
                <li>
                  <span>3</span>
                  Chrome: use the install icon in the address bar.
                </li>
              </ol>
            </article>

            <article className="downloads-guide-card">
              <h3>iOS & iPadOS</h3>
              <ol className="downloads-steps">
                <li>
                  <span>1</span>
                  Open the site in Safari.
                </li>
                <li>
                  <span>2</span>
                  Tap Share → Add to Home Screen.
                </li>
                <li>
                  <span>3</span>
                  Launch from your home screen like a native app.
                </li>
              </ol>
            </article>

            <article className="downloads-guide-card">
              <h3>Android</h3>
              <ol className="downloads-steps">
                <li>
                  <span>1</span>
                  Open the site in Chrome or Samsung Internet.
                </li>
                <li>
                  <span>2</span>
                  Tap “Install app” or the browser install prompt.
                </li>
                <li>
                  <span>3</span>
                  Prefer APK? Use the download button above.
                </li>
              </ol>
            </article>
          </div>
        </section>

        <section className="downloads-support">
          <div>
            <h2>Updates & deployment</h2>
            <p>
              Web and PWA updates ship automatically whenever we deploy. Android APK installs
              require a fresh download unless distributed through Google Play or managed
              device tools.
            </p>
          </div>
          <a className="downloads-button secondary" href="/">
            Back home
          </a>
        </section>
      </div>
    </div>
  );
}
