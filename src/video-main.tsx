import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { VideoCallProvider } from "./context/VideoCallContext";
import VideoAppRoutes from "./routes/VideoAppRoutes";
import "./index.css";
import "./css/chatbox.css";
import "./css/video-app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <VideoCallProvider>
        <BrowserRouter>
          <VideoAppRoutes />
        </BrowserRouter>
      </VideoCallProvider>
    </AuthProvider>
  </React.StrictMode>
);
