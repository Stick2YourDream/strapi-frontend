// src/components/ProtectedRoute.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface Props {
  children: JSX.Element;
}

export default function ProtectedRoute({ children }: Props) {
  const { user, profile, profileLoading, authReady, sessionActive } = useAuth();
  const location = useLocation();

  if (!authReady) {
    return null;
  }

  if (!user) {
    if (sessionActive) {
      return null;
    }
    return <Navigate to="/login" replace />;
  }

  if (profileLoading && !profile) {
    return null;
  }

  if (profile && profile.onboardingComplete === false && location.pathname !== "/me") {
    return <Navigate to="/me" replace />;
  }

  return children;
}
