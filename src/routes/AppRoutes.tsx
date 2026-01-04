// src/routes/AppRoutes.tsx
// import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "../pages/login";
import Register from "../pages/register";
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

export default function AppRoutes(): JSX.Element {
  return (
    <Routes>
      {/* Public landing / home page */}
      <Route path="/" element={<Landing />} />
      <Route path="/home" element={<Navigate to="/" replace />} />

      {/* Login and Register pages */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/guidelines" element={<Guidelines />} />
      <Route path="/cookies" element={<Cookies />} />
      <Route path="/safety" element={<Safety />} />
      <Route path="/report" element={<Report />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
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

      {/* Optional additional routes */}
      <Route path="/landing" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
