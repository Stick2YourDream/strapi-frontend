import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { VideoCallProvider } from "./context/VideoCallContext";
import VideoAppRoutes from "./routes/VideoAppRoutes";
import UpdateNotice from "./components/UpdateNotice";
import AuthDebugOverlay from "./components/AuthDebugOverlay";
import "./index.css";
import "./css/chatbox.css";
import "./css/video-app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <VideoCallProvider>
        <BrowserRouter>
          <VideoAppRoutes />
          <UpdateNotice />
          <AuthDebugOverlay />
        </BrowserRouter>
      </VideoCallProvider>
    </AuthProvider>
  </React.StrictMode>
);

const notifyUpdateAvailable = () => {
  window.dispatchEvent(new CustomEvent("pwa:update-available"));
};

const monitorServiceWorkerUpdates = (registration: ServiceWorkerRegistration) => {
  if (registration.waiting) {
    notifyUpdateAvailable();
  }

  registration.addEventListener("updatefound", () => {
    const installingWorker = registration.installing;
    if (!installingWorker) return;
    installingWorker.addEventListener("statechange", () => {
      if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
        notifyUpdateAvailable();
      }
    });
  });
};

const checkForServiceWorkerUpdate = () => {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistration().then((registration) => {
    void registration?.update();
  });
};

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        monitorServiceWorkerUpdates(registration);
        void registration.update();
      })
      .catch(() => undefined);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForServiceWorkerUpdate();
    }
  });
}
