import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

const readStorage = (storage: Storage | null | undefined, key: string) => {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const probeStorage = (storage: Storage | null | undefined, key: string) => {
  if (!storage) return false;
  try {
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

const formatIso = (value: number | null) => {
  if (!Number.isFinite(value as number)) return "n/a";
  return new Date(value as number).toISOString();
};

export default function AuthDebugOverlay() {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);

  const show = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("authDebug") === "1";
  }, [tick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = () => setTick((prev) => prev + 1);
    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, []);

  if (!show || !user || user.appRole !== "admin") return null;

  const localToken = readStorage(window.localStorage, "token");
  const sessionToken = readStorage(window.sessionStorage, "token");
  const token = localToken || sessionToken || "";
  const tokenSource = localToken ? "local" : sessionToken ? "session" : "none";
  const rememberDevice =
    readStorage(window.localStorage, "rememberDevice") ||
    readStorage(window.sessionStorage, "rememberDevice");
  const expiresAtRaw =
    readStorage(window.localStorage, "expiresAt") ||
    readStorage(window.sessionStorage, "expiresAt");
  const expiresAt = Number(expiresAtRaw);
  const userIdStored =
    readStorage(window.localStorage, "userId") ||
    readStorage(window.sessionStorage, "userId");
  const localOk = probeStorage(window.localStorage, "__auth_debug_probe");
  const sessionOk = probeStorage(window.sessionStorage, "__auth_debug_probe");
  const tokenPreview = token ? `${token.slice(0, 8)}…${token.slice(-4)}` : "n/a";
  const tokenHasBearer = token.toLowerCase().startsWith("bearer ");

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 9999,
        maxWidth: 320,
        padding: "10px 12px",
        borderRadius: 12,
        background: "rgba(5, 8, 18, 0.92)",
        color: "#d6e3ff",
        fontSize: 12,
        lineHeight: 1.35,
        border: "1px solid rgba(120, 150, 255, 0.25)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Auth Debug (admin)</div>
      <div>Origin: {typeof window !== "undefined" ? window.location.origin : "n/a"}</div>
      <div>API: {String(import.meta.env.VITE_API_URL || "n/a")}</div>
      <div>User id: {user.id}</div>
      <div>User id stored: {userIdStored || "n/a"}</div>
      <div>Token source: {tokenSource}</div>
      <div>Token preview: {tokenPreview}</div>
      <div>Token has Bearer: {tokenHasBearer ? "yes" : "no"}</div>
      <div>Remember device: {rememberDevice || "n/a"}</div>
      <div>ExpiresAt: {formatIso(Number.isFinite(expiresAt) ? expiresAt : null)}</div>
      <div>localStorage ok: {localOk ? "yes" : "no"}</div>
      <div>sessionStorage ok: {sessionOk ? "yes" : "no"}</div>
    </div>
  );
}
