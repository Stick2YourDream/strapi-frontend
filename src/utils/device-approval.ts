import api from "../api/strapi";
import {
  decryptJson,
  deriveSharedKey,
  encryptJson,
  exportPublicKey,
  getStoredKey,
  importPublicKey,
  setStoredKey,
} from "./crypto";
import { getOrCreateDeviceId } from "./device-id";

const DEVICE_APPROVAL_PUBLIC_KEY = "device-approval-public";
const DEVICE_APPROVAL_PRIVATE_KEY = "device-approval-private";
const DEVICE_APPROVAL_REQUEST_KEY = "device-approval-request-id";

type DeviceKeyPayload = {
  v: 1;
  identityPublicJwk: JsonWebKey;
  identityPrivateJwk: JsonWebKey;
  profileKeyRaw: string;
};

export type DeviceKeyRequest = {
  id: string;
  deviceLabel?: string;
  deviceIdHash?: string;
  devicePublicKey: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  expiresAt: number;
};

export type DeviceKeyRequestStatus = {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt?: number;
  expiresAt?: number;
  encryptedPayload?: string;
  senderPublicKey?: string;
};

const toBase64 = (data: ArrayBuffer | Uint8Array) => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const getPendingRequestId = () => {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(DEVICE_APPROVAL_REQUEST_KEY);
  return value && value.trim().length ? value : null;
};

const setPendingRequestId = (value: string | null) => {
  if (typeof window === "undefined") return;
  if (!value) {
    window.localStorage.removeItem(DEVICE_APPROVAL_REQUEST_KEY);
    return;
  }
  window.localStorage.setItem(DEVICE_APPROVAL_REQUEST_KEY, value);
};

export const getPendingDeviceKeyRequestId = () => getPendingRequestId();

export const clearPendingDeviceKeyRequestId = () => setPendingRequestId(null);

const getOrCreateDeviceApprovalKeyPair = async () => {
  const storedPublic = await getStoredKey<CryptoKey>(DEVICE_APPROVAL_PUBLIC_KEY);
  const storedPrivate = await getStoredKey<CryptoKey>(DEVICE_APPROVAL_PRIVATE_KEY);
  if (storedPublic && storedPrivate) {
    return { publicKey: storedPublic, privateKey: storedPrivate };
  }
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
  await setStoredKey(DEVICE_APPROVAL_PUBLIC_KEY, keyPair.publicKey);
  await setStoredKey(DEVICE_APPROVAL_PRIVATE_KEY, keyPair.privateKey);
  return keyPair;
};

export const getDefaultDeviceLabel = () => {
  if (typeof navigator === "undefined") return "Current device";
  const platform =
    (navigator as any).userAgentData?.platform || navigator.platform || "Device";
  const agent = navigator.userAgent || "";
  let browser = "Browser";
  if (agent.includes("Edg/")) browser = "Edge";
  else if (agent.includes("Chrome")) browser = "Chrome";
  else if (agent.includes("Safari")) browser = "Safari";
  else if (agent.includes("Firefox")) browser = "Firefox";
  return `${platform} - ${browser}`;
};

export const requestDeviceKeyApproval = async (deviceLabel?: string) => {
  const deviceId = getOrCreateDeviceId();
  const { publicKey } = await getOrCreateDeviceApprovalKeyPair();
  const devicePublicKey = await exportPublicKey(publicKey);
  const res = await api.post("/auth/device-key-requests", {
    deviceId,
    deviceLabel,
    devicePublicKey,
  });
  const requestId = String(res.data?.requestId || "").trim();
  if (!requestId) {
    throw new Error("Unable to create request.");
  }
  setPendingRequestId(requestId);
  return {
    requestId,
    status: res.data?.status as DeviceKeyRequest["status"],
    expiresAt: Number(res.data?.expiresAt) || undefined,
  };
};

export const fetchDeviceKeyRequestStatus = async (requestId: string) => {
  const deviceId = getOrCreateDeviceId();
  const res = await api.get(`/auth/device-key-requests/${requestId}`, {
    params: { deviceId },
  });
  return res.data as DeviceKeyRequestStatus;
};

const importDevicePayload = async (userId: number, payload: DeviceKeyPayload) => {
  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.importKey(
      "jwk",
      payload.identityPublicJwk,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      []
    ),
    crypto.subtle.importKey(
      "jwk",
      payload.identityPrivateJwk,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    ),
  ]);
  const rawProfileKey = fromBase64(payload.profileKeyRaw);
  const profileKey = await crypto.subtle.importKey(
    "raw",
    rawProfileKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  await Promise.all([
    setStoredKey("identity-public", publicKey),
    setStoredKey("identity-private", privateKey),
    setStoredKey(`profile-key-${userId}`, profileKey),
  ]);
};

export const consumeDeviceKeyApproval = async (
  userId: number,
  status: DeviceKeyRequestStatus
) => {
  if (status.status !== "approved") return false;
  const encryptedPayload = String(status.encryptedPayload || "").trim();
  const senderPublicKey = String(status.senderPublicKey || "").trim();
  if (!encryptedPayload || !senderPublicKey) return false;
  const { privateKey } = await getOrCreateDeviceApprovalKeyPair();
  const senderKey = await importPublicKey(senderPublicKey);
  const sharedKey = await deriveSharedKey(privateKey, senderKey);
  const payload = await decryptJson<DeviceKeyPayload>(sharedKey, encryptedPayload);
  if (!payload?.identityPrivateJwk || !payload?.identityPublicJwk || !payload?.profileKeyRaw) {
    return false;
  }
  await importDevicePayload(userId, payload);
  clearPendingDeviceKeyRequestId();
  return true;
};

export const listDeviceKeyRequests = async () => {
  const deviceId = getOrCreateDeviceId();
  const res = await api.get("/auth/device-key-requests", { params: { deviceId } });
  const raw = res.data?.requests;
  if (!Array.isArray(raw)) return [] as DeviceKeyRequest[];
  return raw.map((entry: any) => ({
    id: String(entry?.id || ""),
    deviceLabel: String(entry?.deviceLabel || ""),
    deviceIdHash: String(entry?.deviceIdHash || ""),
    devicePublicKey: String(entry?.devicePublicKey || ""),
    status: (entry?.status as DeviceKeyRequest["status"]) || "pending",
    createdAt: Number(entry?.createdAt) || 0,
    expiresAt: Number(entry?.expiresAt) || 0,
  }));
};

export const approveDeviceKeyRequest = async (
  userId: number,
  request: DeviceKeyRequest
) => {
  const identityPublic = await getStoredKey<CryptoKey>("identity-public");
  const identityPrivate = await getStoredKey<CryptoKey>("identity-private");
  const profileKey = await getStoredKey<CryptoKey>(`profile-key-${userId}`);
  if (!identityPublic || !identityPrivate || !profileKey) {
    throw new Error("Missing local encryption keys.");
  }
  const devicePublicKey = await importPublicKey(request.devicePublicKey);
  const sharedKey = await deriveSharedKey(identityPrivate, devicePublicKey);
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", identityPublic),
    crypto.subtle.exportKey("jwk", identityPrivate),
  ]);
  const rawProfileKey = await crypto.subtle.exportKey("raw", profileKey);
  const payload: DeviceKeyPayload = {
    v: 1,
    identityPublicJwk: publicJwk,
    identityPrivateJwk: privateJwk,
    profileKeyRaw: toBase64(rawProfileKey),
  };
  const encryptedPayload = await encryptJson(sharedKey, payload);
  const senderPublicKey = await exportPublicKey(identityPublic);
  const deviceId = getOrCreateDeviceId();
  await api.post(`/auth/device-key-requests/${request.id}/approve`, {
    deviceId,
    encryptedPayload,
    senderPublicKey,
  });
};

export const rejectDeviceKeyRequest = async (requestId: string) => {
  const deviceId = getOrCreateDeviceId();
  await api.post(`/auth/device-key-requests/${requestId}/reject`, { deviceId });
};
