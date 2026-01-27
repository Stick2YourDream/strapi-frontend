import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/pwa.css";
import "../css/apps.css";
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
  const navigate = useNavigate();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [isStandalone, setIsStandalone] = useState(isStandaloneMode());
  const [platform, setPlatform] = useState(detectPlatform());
  const apkVersion = (import.meta.env.VITE_ANDROID_APK_VERSION as string | undefined) || "";
  const apkCode = (import.meta.env.VITE_ANDROID_APK_CODE as string | undefined) || "";

  usePageMeta({
    title: "Install the App | Your Social Place",
    description:
      "Install Your Social Place on Android, Windows, macOS, or iOS with the official PWA or Android download.",
    type: "website",
    canonical: "https://yoursocialplace.com/apps",
    keywords:
      "Your Social Place app, PWA install, Android app download, Windows PWA, iOS install, macOS install",
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
      return "You're already running the installed app on this device.";
    }
    if (platform.isIos) {
      return "On iPhone or iPad, open in Safari and tap Share → Add to Home Screen.";
    }
    if (installPrompt) {
      return "Tap Install to add the app to your device.";
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

  return (
    <div className="pwa-shell apps-shell">
      <div className="pwa-card apps-card">
        <header className="pwa-header">
          <span className="pwa-eyebrow">Install the App</span>
          <h1>Get Your Social Place on every device</h1>
          <p className="pwa-subhead">
            Install the official PWA on Windows, macOS, or iOS—or download the Android
            app package. Updates for the web and PWA roll out automatically when you
            reopen the app.
          </p>
        </header>

        <section className="pwa-section apps-primary">
          <p className="pwa-label">Quick install</p>
          <p className="apps-copy">{installHint}</p>
          <div className="apps-actions">
            <button
              className="pwa-button"
              type="button"
              onClick={handleInstall}
              disabled={!installPrompt || isStandalone}
            >
              {isStandalone ? "App installed" : "Install app"}
            </button>
            <a className="pwa-button secondary" href={apkUrl} download>
              Download Android APK
            </a>
            <button
              className="pwa-button secondary"
              type="button"
              onClick={() => navigate("/")}
            >
              Back home
            </button>
          </div>
          <div className="apps-apk-meta">
            <span className="apps-apk-label">Android APK</span>
            <span className="apps-apk-version">{apkLabel}</span>
          </div>
          <p className="apps-muted">
            Android installs may require enabling “Install unknown apps” for your browser.
          </p>
        </section>

        <div className="apps-grid">
          <section className="pwa-section apps-panel">
            <p className="pwa-label">Android</p>
            <ul className="apps-steps">
              <li>
                <span className="apps-step-number">1.</span>
                <span>Open the site in Chrome or Samsung Internet.</span>
              </li>
              <li>
                <span className="apps-step-number">2.</span>
                <span>Tap “Install app” or the browser install prompt.</span>
              </li>
              <li>
                <span className="apps-step-number">3.</span>
                <span>Prefer APK? Use the download link above.</span>
              </li>
            </ul>
          </section>

          <section className="pwa-section apps-panel">
            <p className="pwa-label">Windows</p>
            <ul className="apps-steps">
              <li>
                <span className="apps-step-number">1.</span>
                <span>Open the site in Edge or Chrome.</span>
              </li>
              <li>
                <span className="apps-step-number">2.</span>
                <span>Click the install icon in the address bar.</span>
              </li>
              <li>
                <span className="apps-step-number">3.</span>
                <span>The app will appear in the Start menu.</span>
              </li>
            </ul>
          </section>

          <section className="pwa-section apps-panel">
            <p className="pwa-label">macOS</p>
            <ul className="apps-steps">
              <li>
                <span className="apps-step-number">1.</span>
                <span>Open the site in Safari 17+ or Chrome.</span>
              </li>
              <li>
                <span className="apps-step-number">2.</span>
                <span>Safari: File → Add to Dock.</span>
              </li>
              <li>
                <span className="apps-step-number">3.</span>
                <span>Chrome: use the install icon in the address bar.</span>
              </li>
            </ul>
          </section>

          <section className="pwa-section apps-panel">
            <p className="pwa-label">iOS & iPadOS</p>
            <ul className="apps-steps">
              <li>
                <span className="apps-step-number">1.</span>
                <span>Open the site in Safari.</span>
              </li>
              <li>
                <span className="apps-step-number">2.</span>
                <span>Tap Share → Add to Home Screen.</span>
              </li>
              <li>
                <span className="apps-step-number">3.</span>
                <span>Launch from your home screen like a native app.</span>
              </li>
            </ul>
          </section>
        </div>

        <section className="pwa-section apps-update">
          <p className="pwa-label">Updates</p>
          <div className="pwa-value">
            Web and PWA updates ship automatically whenever we deploy. Android APK
            installs require a fresh download unless distributed through Google Play
            or managed device tools.
          </div>
        </section>
      </div>
    </div>
  );
}
