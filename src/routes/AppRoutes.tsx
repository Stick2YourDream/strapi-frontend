// src/routes/AppRoutes.tsx
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ProtectedRoute from "../components/ProtectedRoute";

const VerifyEmail = lazy(() => import("../pages/verify-email"));
const ForgotPassword = lazy(() => import("../pages/forgot-password"));
const ResetPassword = lazy(() => import("../pages/reset-password"));
const Dashboard = lazy(() => import("../pages/dashboard"));
const Friends = lazy(() => import("../pages/friends"));
const FriendProfile = lazy(() => import("../pages/friend-profile"));
const Me = lazy(() => import("../pages/me"));
const MyPosts = lazy(() => import("../pages/my-posts"));
const MyGallery = lazy(() => import("../pages/my-gallery"));
const PostManager = lazy(() => import("../pages/post-manager"));
const Groups = lazy(() => import("../pages/groups"));
const GroupDetail = lazy(() => import("../pages/group"));
const Landing = lazy(() => import("../pages/landing"));
const Terms = lazy(() => import("../pages/terms"));
const Privacy = lazy(() => import("../pages/privacy"));
const Guidelines = lazy(() => import("../pages/guidelines"));
const Cookies = lazy(() => import("../pages/cookies"));
const MarketplacePolicy = lazy(() => import("../pages/marketplace-policy"));
const MarketplaceFeeDisclosure = lazy(() => import("../pages/marketplace-fee-disclosure"));
const Safety = lazy(() => import("../pages/safety"));
const Report = lazy(() => import("../pages/report"));
const DeleteAccount = lazy(() => import("../pages/delete-account"));
const DeleteData = lazy(() => import("../pages/delete-data"));
const ShareTarget = lazy(() => import("../pages/share"));
const ProtocolHandler = lazy(() => import("../pages/protocol"));
const NewNote = lazy(() => import("../pages/notes-new"));
const WhatMakesUsDifferent = lazy(() => import("../pages/what-makes-us-different"));
const Moderation = lazy(() => import("../pages/moderation"));
const News = lazy(() => import("../pages/news"));
const Apps = lazy(() => import("../pages/apps"));
const Downloads = lazy(() => import("../pages/downloads"));
const Forums = lazy(() => import("../pages/forums"));
const Storefront = lazy(() => import("../pages/storefront"));
const StorefrontListing = lazy(() => import("../pages/storefront-listing"));
const StorefrontSeller = lazy(() => import("../pages/storefront-seller"));
const StorefrontPaymentMethods = lazy(() => import("../pages/storefront-payment-methods"));
const AgeVerifyApp = lazy(() => import("../modules/age-verify/AgeVerifyApp"));
const Support = lazy(() => import("../pages/support"));

const RouteFallback = () => <div className="status">Loading...</div>;

const withRouteSuspense = (content: ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{content}</Suspense>
);

function AuthAliasRedirect({ mode }: { mode: "login" | "register" }): JSX.Element {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("auth", mode === "register" ? "register" : "login");
  const query = params.toString();
  const to = query ? `/?${query}` : "/";
  return <Navigate to={to} replace />;
}

function LegacyVerifyRedirect(): JSX.Element {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const sessionId = params.get("id");
  if (sessionId) {
    params.delete("id");
    params.set("mode", params.get("mode") || "mobile");
    const query = params.toString();
    const to = `/age-verify/session/${encodeURIComponent(sessionId)}${
      query ? `?${query}` : ""
    }`;
    return <Navigate to={to} replace />;
  }
  return <Navigate to="/age-verify" replace />;
}

function LegacyVerifySessionRedirect(): JSX.Element {
  const location = useLocation();
  const { sessionId } = useParams();
  const to = `/age-verify/session/${encodeURIComponent(String(sessionId || ""))}${
    location.search || ""
  }`;
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
    withRouteSuspense(<Landing />)
  );
  const newsroomEnabled = appSettings?.newsroomEnabled !== false;
  const storefrontEnabled = appSettings?.storefrontEnabled !== false;

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname, location.search]);

  return (
    <Routes>
      {/* Public landing / home page */}
      <Route path="/" element={landingElement} />
      <Route path="/home" element={<Navigate to="/" replace />} />

      {/* Auth entry routes now resolve to inline landing auth */}
      <Route path="/login" element={<AuthAliasRedirect mode="login" />} />
      <Route path="/forgot-password" element={withRouteSuspense(<ForgotPassword />)} />
      <Route path="/reset-password" element={withRouteSuspense(<ResetPassword />)} />
      <Route path="/register" element={<AuthAliasRedirect mode="register" />} />
      <Route path="/verify-email" element={withRouteSuspense(<VerifyEmail />)} />
      <Route path="/verify" element={<LegacyVerifyRedirect />} />
      <Route path="/session/:sessionId" element={<LegacyVerifySessionRedirect />} />
      <Route path="/age-verify/*" element={withRouteSuspense(<AgeVerifyApp />)} />
      <Route path="/terms" element={withRouteSuspense(<Terms />)} />
      <Route path="/marketplace-policy" element={withRouteSuspense(<MarketplacePolicy />)} />
      <Route
        path="/marketplace-fee-disclosure"
        element={withRouteSuspense(<MarketplaceFeeDisclosure />)}
      />
      <Route path="/privacy" element={withRouteSuspense(<Privacy />)} />
      <Route path="/privacy-policy" element={<Navigate to="/privacy" replace />} />
      <Route path="/delete-account" element={withRouteSuspense(<DeleteAccount />)} />
      <Route path="/delete-data" element={withRouteSuspense(<DeleteData />)} />
      <Route path="/guidelines" element={withRouteSuspense(<Guidelines />)} />
      <Route path="/cookies" element={withRouteSuspense(<Cookies />)} />
      <Route path="/cookie-policy" element={<Navigate to="/cookies" replace />} />
      <Route path="/safety" element={withRouteSuspense(<Safety />)} />
      <Route path="/report" element={withRouteSuspense(<Report />)} />
      <Route path="/support" element={withRouteSuspense(<Support />)} />
      <Route
        path="/what-makes-us-different"
        element={withRouteSuspense(<WhatMakesUsDifferent />)}
      />
      <Route path="/apps" element={withRouteSuspense(<Apps />)} />
      <Route path="/downloads" element={withRouteSuspense(<Downloads />)} />
      <Route path="/forums" element={withRouteSuspense(<Forums />)} />
      <Route path="/forums/:postId" element={withRouteSuspense(<Forums />)} />
      <Route
        path="/storefront"
        element={
          <ProtectedRoute>
            {storefrontEnabled
              ? withRouteSuspense(<Storefront />)
              : <Navigate to="/dashboard" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/storefront/listing/:listingId"
        element={
          <ProtectedRoute>
            {storefrontEnabled
              ? withRouteSuspense(<StorefrontListing />)
              : <Navigate to="/dashboard" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/storefront/seller"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<StorefrontSeller />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/storefront/payment-methods"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<StorefrontPaymentMethods />)}
          </ProtectedRoute>
        }
      />
      <Route path="/share" element={withRouteSuspense(<ShareTarget />)} />
      <Route path="/protocol" element={withRouteSuspense(<ProtocolHandler />)} />
      <Route path="/notes/new" element={withRouteSuspense(<NewNote />)} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<Dashboard />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/news"
        element={
          <ProtectedRoute>
            {newsroomEnabled ? withRouteSuspense(<News />) : <Navigate to="/dashboard" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/friends"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<Friends />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/friends/:friendId"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<FriendProfile />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/me"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<Me />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-posts"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<MyPosts />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-gallery"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<MyGallery />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/post-manager"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<PostManager />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<Groups />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups/:groupId"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<GroupDetail />)}
          </ProtectedRoute>
        }
      />
      <Route
        path="/moderation"
        element={
          <ProtectedRoute>
            {withRouteSuspense(<Moderation />)}
          </ProtectedRoute>
        }
      />

      {/* Optional additional routes */}
      <Route path="/landing" element={withRouteSuspense(<Landing />)} />
    </Routes>
  );
}
