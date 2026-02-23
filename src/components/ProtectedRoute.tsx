// src/components/ProtectedRoute.tsx
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AgeVerificationPrompt from "./AgeVerificationPrompt";

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
    const redirectTarget = `${location.pathname}${location.search}${location.hash}`;
    const loginParams = new URLSearchParams();
    if (redirectTarget.startsWith("/") && !redirectTarget.startsWith("//")) {
      loginParams.set("redirect", redirectTarget);
    }
    const loginPath = loginParams.toString()
      ? `/login?${loginParams.toString()}`
      : "/login";
    return <Navigate to={loginPath} replace />;
  }

  if (profileLoading && !profile) {
    return null;
  }

  if (profile && profile.onboardingComplete === false && location.pathname !== "/me") {
    return <Navigate to="/me" replace />;
  }

  return (
    <>
      <AgeVerificationPrompt />
      {children}
    </>
  );
}
