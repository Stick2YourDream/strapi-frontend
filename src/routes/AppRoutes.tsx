// src/routes/AppRoutes.tsx
// import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Login from "../pages/login";
import Register from "../pages/register";
import ForgotPassword from "../pages/forgot-password";
import ResetPassword from "../pages/reset-password";
import Dashboard from "../pages/dashboard";
import ProtectedRoute from "../components/ProtectedRoute";
import Friends from "../pages/friends";
import Me from "../pages/me";
import Groups from "../pages/groups";
import GroupDetail from "../pages/group";
import Landing from "../pages/landing";
import Terms from "../pages/terms";
import Privacy from "../pages/privacy";
import Guidelines from "../pages/guidelines";
import Cookies from "../pages/cookies";
import Safety from "../pages/safety";
import Report from "../pages/report";
import DeleteAccount from "../pages/delete-account";
import DeleteData from "../pages/delete-data";
import ShareTarget from "../pages/share";
import ProtocolHandler from "../pages/protocol";
import NewNote from "../pages/notes-new";
import WhatMakesUsDifferent from "../pages/what-makes-us-different";
import Moderation from "../pages/moderation";

export default function AppRoutes(): JSX.Element {
  const { user } = useAuth();
  const landingElement = user ? <Navigate to="/dashboard" replace /> : <Landing />;

  return (
    <Routes>
      {/* Public landing / home page */}
      <Route path="/" element={landingElement} />
      <Route path="/home" element={<Navigate to="/" replace />} />

      {/* Login and Register pages */}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/register" element={<Register />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/delete-account" element={<DeleteAccount />} />
      <Route path="/delete-data" element={<DeleteData />} />
      <Route path="/guidelines" element={<Guidelines />} />
      <Route path="/cookies" element={<Cookies />} />
      <Route path="/safety" element={<Safety />} />
      <Route path="/report" element={<Report />} />
      <Route path="/what-makes-us-different" element={<WhatMakesUsDifferent />} />
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
            <Navigate to="/dashboard" replace />
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
        path="/me"
        element={
          <ProtectedRoute>
            <Me />
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
