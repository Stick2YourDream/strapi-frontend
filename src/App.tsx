// src/App.tsx
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import ChatDock from "./components/ChatDock";
import ConsentBanner from "./components/ConsentBanner";
import KeyBackupModal from "./components/KeyBackupModal";
import ReleaseNotesModal from "./components/ReleaseNotesModal";
import UpdateNotice from "./components/UpdateNotice";
import AuthDebugOverlay from "./components/AuthDebugOverlay";
import TimeLimitManager from "./components/TimeLimitManager";
import DobMismatchNotice from "./components/DobMismatchNotice";

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <ChatDock />
      <ConsentBanner />
      <KeyBackupModal />
      <ReleaseNotesModal />
      <UpdateNotice />
      <AuthDebugOverlay />
      <TimeLimitManager />
      <DobMismatchNotice />
    </BrowserRouter>
  );
}
