import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import VideoOnlyRoute from "../components/VideoOnlyRoute";
import Login from "../pages/login";
import ForgotPassword from "../pages/forgot-password";
import ResetPassword from "../pages/reset-password";
import VerifyEmail from "../pages/verify-email";
import VideoCallHome from "../pages/video-call";

export default function VideoAppRoutes(): JSX.Element {
  const { user } = useAuth();

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={user ? "/call" : "/login"} replace />}
      />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route
        path="/call"
        element={
          <VideoOnlyRoute>
            <VideoCallHome />
          </VideoOnlyRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
