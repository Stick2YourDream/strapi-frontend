// src/App.tsx
import { lazy, Suspense } from "react";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import { useAuth } from "./context/AuthContext";

const ChatDock = lazy(() => import("./components/ChatDock"));
const ConsentBanner = lazy(() => import("./components/ConsentBanner"));
const KeyBackupModal = lazy(() => import("./components/KeyBackupModal"));
const ReleaseNotesModal = lazy(() => import("./components/ReleaseNotesModal"));
const UpdateNotice = lazy(() => import("./components/UpdateNotice"));
const AuthDebugOverlay = lazy(() => import("./components/AuthDebugOverlay"));
const TimeLimitManager = lazy(() => import("./components/TimeLimitManager"));
const DobMismatchNotice = lazy(() => import("./components/DobMismatchNotice"));

function AppChrome(): JSX.Element {
  const { user, sessionActive } = useAuth();
  const isAuthed = Boolean(user) || sessionActive;
  return (
    <>
      <AppRoutes />
      <Suspense fallback={null}>
        <ConsentBanner />
        {isAuthed && <ChatDock />}
        {isAuthed && <KeyBackupModal />}
        {isAuthed && <ReleaseNotesModal />}
        <UpdateNotice />
        {import.meta.env.DEV && <AuthDebugOverlay />}
        {isAuthed && <TimeLimitManager />}
        {isAuthed && <DobMismatchNotice />}
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppChrome />
    </BrowserRouter>
  );
}
