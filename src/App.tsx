// src/App.tsx
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import { useAuth } from "./context/AuthContext";

const ChatProvider = lazy(() =>
  import("./context/ChatContext").then((mod) => ({ default: mod.ChatProvider }))
);
const VideoCallProvider = lazy(() =>
  import("./context/VideoCallContext").then((mod) => ({ default: mod.VideoCallProvider }))
);
const ChatDock = lazy(() => import("./components/ChatDock"));
const ConsentBanner = lazy(() => import("./components/ConsentBanner"));
const KeyBackupModal = lazy(() => import("./components/KeyBackupModal"));
const ReleaseNotesModal = lazy(() => import("./components/ReleaseNotesModal"));
const UpdateNotice = lazy(() => import("./components/UpdateNotice"));
const AuthDebugOverlay = lazy(() => import("./components/AuthDebugOverlay"));
const TimeLimitManager = lazy(() => import("./components/TimeLimitManager"));
const DobMismatchNotice = lazy(() => import("./components/DobMismatchNotice"));
const SuggestionWidget = lazy(() => import("./components/SuggestionWidget"));

function RuntimeProviders({
  isAuthed,
  children,
}: {
  isAuthed: boolean;
  children: ReactNode;
}): JSX.Element {
  if (!isAuthed) {
    return <>{children}</>;
  }
  return (
    <Suspense fallback={<div className="status">Loading...</div>}>
      <ChatProvider>
        <VideoCallProvider>{children}</VideoCallProvider>
      </ChatProvider>
    </Suspense>
  );
}

function AppChrome(): JSX.Element {
  const { user, sessionActive } = useAuth();
  const isAuthed = Boolean(user) || sessionActive;
  const chrome = (
    <>
      <AppRoutes />
      <Suspense fallback={null}>
        <ConsentBanner />
        {isAuthed && <ChatDock />}
        {isAuthed && <SuggestionWidget showTrigger={false} autoOpenWeekly />}
        {isAuthed && <KeyBackupModal />}
        {isAuthed && <ReleaseNotesModal />}
        <UpdateNotice />
        {import.meta.env.DEV && <AuthDebugOverlay />}
        {isAuthed && <TimeLimitManager />}
        {isAuthed && <DobMismatchNotice />}
      </Suspense>
    </>
  );
  return <RuntimeProviders isAuthed={isAuthed}>{chrome}</RuntimeProviders>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppChrome />
    </BrowserRouter>
  );
}
