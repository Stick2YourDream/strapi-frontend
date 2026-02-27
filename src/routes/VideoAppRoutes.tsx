import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import VideoOnlyRoute from "../components/VideoOnlyRoute";

const Login = lazy(() => import("../pages/login"));
const ForgotPassword = lazy(() => import("../pages/forgot-password"));
const ResetPassword = lazy(() => import("../pages/reset-password"));
const VerifyEmail = lazy(() => import("../pages/verify-email"));
const VideoCallHome = lazy(() => import("../pages/video-call"));

const RouteFallback = () => <div className="status">Loading...</div>;

const withRouteSuspense = (content: ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{content}</Suspense>
);

export default function VideoAppRoutes(): JSX.Element {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname, location.search]);

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={user ? "/call" : "/login"} replace />}
      />
      <Route path="/login" element={withRouteSuspense(<Login />)} />
      <Route path="/forgot-password" element={withRouteSuspense(<ForgotPassword />)} />
      <Route path="/reset-password" element={withRouteSuspense(<ResetPassword />)} />
      <Route path="/verify-email" element={withRouteSuspense(<VerifyEmail />)} />
      <Route
        path="/call"
        element={
          <VideoOnlyRoute>
            {withRouteSuspense(<VideoCallHome />)}
          </VideoOnlyRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
