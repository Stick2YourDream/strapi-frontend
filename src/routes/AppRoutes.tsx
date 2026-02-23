// src/routes/AppRoutes.tsx
// import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import VerifyEmail from "../pages/verify-email";
import ForgotPassword from "../pages/forgot-password";
import ResetPassword from "../pages/reset-password";
import Dashboard from "../pages/dashboard";
import ProtectedRoute from "../components/ProtectedRoute";
import Friends from "../pages/friends";
import FriendProfile from "../pages/friend-profile";
import Me from "../pages/me";
import MyPosts from "../pages/my-posts";
import MyGallery from "../pages/my-gallery";
import Groups from "../pages/groups";
import GroupDetail from "../pages/group";
import Landing from "../pages/landing";
import Terms from "../pages/terms";
import Privacy from "../pages/privacy";
import Guidelines from "../pages/guidelines";
import Cookies from "../pages/cookies";
import MarketplacePolicy from "../pages/marketplace-policy";
import MarketplaceFeeDisclosure from "../pages/marketplace-fee-disclosure";
import Safety from "../pages/safety";
import Report from "../pages/report";
import DeleteAccount from "../pages/delete-account";
import DeleteData from "../pages/delete-data";
import ShareTarget from "../pages/share";
import ProtocolHandler from "../pages/protocol";
import NewNote from "../pages/notes-new";
import WhatMakesUsDifferent from "../pages/what-makes-us-different";
import Moderation from "../pages/moderation";
import News from "../pages/news";
import Apps from "../pages/apps";
import Downloads from "../pages/downloads";
import Forums from "../pages/forums";
import Storefront from "../pages/storefront";
import StorefrontListing from "../pages/storefront-listing";
import StorefrontSeller from "../pages/storefront-seller";
import StorefrontPaymentMethods from "../pages/storefront-payment-methods";
import AgeVerifyApp from "../modules/age-verify/AgeVerifyApp";
import Support from "../pages/support";

function AuthAliasRedirect({ mode }: { mode: "login" | "register" }): JSX.Element {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("auth", mode === "register" ? "register" : "login");
  const query = params.toString();
  const to = query ? `/?${query}` : "/";
  return <Navigate to={to} replace />;
}

const sanitizeRedirectTarget = (value: string | null) => {
  const trimmed = String(value || "").trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("/login") || lowered.startsWith("/register")) {
    return null;
  }
  return trimmed;
};

export default function AppRoutes(): JSX.Element {
  const location = useLocation();
  const { user, appSettings, sessionActive } = useAuth();
  const isAuthed = Boolean(user) || sessionActive;
  const redirectTarget = sanitizeRedirectTarget(
    new URLSearchParams(location.search).get("redirect")
  );
  const landingElement = isAuthed ? (
    <Navigate to={redirectTarget || "/dashboard"} replace />
  ) : (
    <Landing />
  );
  const newsroomEnabled = appSettings?.newsroomEnabled !== false;
  const storefrontEnabled = appSettings?.storefrontEnabled !== false;

  return (
    <Routes>
      {/* Public landing / home page */}
      <Route path="/" element={landingElement} />
      <Route path="/home" element={<Navigate to="/" replace />} />

      {/* Auth entry routes now resolve to inline landing auth */}
      <Route path="/login" element={<AuthAliasRedirect mode="login" />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/register" element={<AuthAliasRedirect mode="register" />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/age-verify/*" element={<AgeVerifyApp />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/marketplace-policy" element={<MarketplacePolicy />} />
      <Route path="/marketplace-fee-disclosure" element={<MarketplaceFeeDisclosure />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/privacy-policy" element={<Navigate to="/privacy" replace />} />
      <Route path="/delete-account" element={<DeleteAccount />} />
      <Route path="/delete-data" element={<DeleteData />} />
      <Route path="/guidelines" element={<Guidelines />} />
      <Route path="/cookies" element={<Cookies />} />
      <Route path="/cookie-policy" element={<Navigate to="/cookies" replace />} />
      <Route path="/safety" element={<Safety />} />
      <Route path="/report" element={<Report />} />
      <Route path="/support" element={<Support />} />
      <Route path="/what-makes-us-different" element={<WhatMakesUsDifferent />} />
      <Route path="/apps" element={<Apps />} />
      <Route path="/downloads" element={<Downloads />} />
      <Route path="/forums" element={<Forums />} />
      <Route path="/forums/:postId" element={<Forums />} />
      <Route
        path="/storefront"
        element={
          <ProtectedRoute>
            {storefrontEnabled ? <Storefront /> : <Navigate to="/dashboard" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/storefront/listing/:listingId"
        element={
          <ProtectedRoute>
            {storefrontEnabled ? <StorefrontListing /> : <Navigate to="/dashboard" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/storefront/seller"
        element={
          <ProtectedRoute>
            <StorefrontSeller />
          </ProtectedRoute>
        }
      />
      <Route
        path="/storefront/payment-methods"
        element={
          <ProtectedRoute>
            <StorefrontPaymentMethods />
          </ProtectedRoute>
        }
      />
      <Route path="/share" element={<ShareTarget />} />
      <Route path="/protocol" element={<ProtocolHandler />} />
      <Route path="/notes/new" element={<NewNote />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/news"
        element={
          <ProtectedRoute>
            {newsroomEnabled ? <News /> : <Navigate to="/dashboard" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/friends"
        element={
          <ProtectedRoute>
            <Friends />
          </ProtectedRoute>
        }
      />
      <Route
        path="/friends/:friendId"
        element={
          <ProtectedRoute>
            <FriendProfile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/me"
        element={
          <ProtectedRoute>
            <Me />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-posts"
        element={
          <ProtectedRoute>
            <MyPosts />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-gallery"
        element={
          <ProtectedRoute>
            <MyGallery />
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups"
        element={
          <ProtectedRoute>
            <Groups />
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups/:groupId"
        element={
          <ProtectedRoute>
            <GroupDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/moderation"
        element={
          <ProtectedRoute>
            <Moderation />
          </ProtectedRoute>
        }
      />

      {/* Optional additional routes */}
      <Route path="/landing" element={<Landing />} />
    </Routes>
  );
}
