// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ChatProvider } from "./context/ChatContext";
import { UserPreferencesProvider } from "./context/UserPreferencesContext";
import { VideoCallProvider } from "./context/VideoCallContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <UserPreferencesProvider>
        <ChatProvider>
          <VideoCallProvider>
            <App />
          </VideoCallProvider>
        </ChatProvider>
      </UserPreferencesProvider>
    </AuthProvider>
  </React.StrictMode>
);

type LaunchFileHandle = {
  getFile: () => Promise<File>;
};

type LaunchParams = {
  files?: LaunchFileHandle[];
};

const setupLaunchQueue = () => {
  const launchQueue = (
    window as Window & {
      launchQueue?: {
        setConsumer: (consumer: (params: LaunchParams) => void) => void;
      };
    }
  ).launchQueue;

  if (!launchQueue) {
    return;
  }

  launchQueue.setConsumer(async (params) => {
    if (!params?.files?.length) {
      return;
    }

    const files = await Promise.all(
      params.files.map(async (handle) => {
        const file = await handle.getFile();
        return {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
        };
      })
    );

    sessionStorage.setItem("pwa:launch-files", JSON.stringify(files));
    if (window.location.pathname !== "/share") {
      window.location.assign("/share?source=file-handler");
    }
  });
};

const registerBackgroundSync = async (registration: ServiceWorkerRegistration) => {
  const syncManager = (registration as { sync?: { register: (tag: string) => Promise<void> } }).sync;
  if (!syncManager) {
    return;
  }

  try {
    await syncManager.register("pwa-sync");
  } catch (error) {
    console.warn("Background sync registration failed:", error);
  }
};

const registerPeriodicSync = async (registration: ServiceWorkerRegistration) => {
  const periodicSync = (
    registration as {
      periodicSync?: { register: (tag: string, options: { minInterval: number }) => Promise<void> };
    }
  ).periodicSync;

  if (!periodicSync || !("permissions" in navigator)) {
    return;
  }

  try {
    const status = await navigator.permissions.query({
      name: "periodic-background-sync" as PermissionName,
    });
    if (status.state === "granted") {
      await periodicSync.register("pwa-periodic-sync", {
        minInterval: 24 * 60 * 60 * 1000,
      });
    }
  } catch (error) {
    console.warn("Periodic sync registration failed:", error);
  }
};

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
      if (
        installingWorker.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        notifyUpdateAvailable();
      }
    });
  });
};

setupLaunchQueue();

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister();
    });
  });
  if ("caches" in window) {
    caches.keys().then((keys) => {
      keys
        .filter((key) => key.startsWith("ysp-"))
        .forEach((key) => {
          void caches.delete(key);
        });
    });
  }
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        void registerBackgroundSync(registration);
        void registerPeriodicSync(registration);
        monitorServiceWorkerUpdates(registration);
      })
      .catch(() => undefined);
  });
}
