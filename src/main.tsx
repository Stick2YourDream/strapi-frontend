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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
