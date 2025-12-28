// src/routes/AppRoutes.tsx
// import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "../pages/login";
import Register from "../pages/register";
import Dashboard from "../pages/dashboard";
import ProtectedRoute from "../components/ProtectedRoute";
import Friends from "../pages/friends";
import Me from "../pages/me";
import Landing from "../pages/landing";
import Terms from "../pages/terms";

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

      {/* Optional additional routes */}
      <Route path="/landing" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
