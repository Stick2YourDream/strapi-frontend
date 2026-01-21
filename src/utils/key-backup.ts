import api from "../api/strapi";
import {
  decryptJson,
  encryptJson,
  getOrCreateIdentityKeyPair,
  getOrCreateProfileKey,
  getStoredKey,
  setStoredKey,
} from "./crypto";

type KeyBackupRecord = {
  encryptedPayload: string;
  salt: string;
  kdf: string;
  iterations: number;
  version: number;
};

type KeyBackupPayload = {
  v: 1;
  identityPublicJwk: JsonWebKey;
  identityPrivateJwk: JsonWebKey;
  profileKeyRaw: string;
};

const textEncoder = new TextEncoder();

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

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.buffer instanceof ArrayBuffer) {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
      return bytes.buffer;
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const derivePassphraseKey = async (passphrase: string, salt: Uint8Array, iterations: number) => {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const fetchKeyBackup = async (): Promise<KeyBackupRecord | null> => {
  const res = await api.get("/key-backups/me");
  const data = res.data?.data;
  const attrs = data?.attributes ?? data;
  if (!attrs?.encryptedPayload || !attrs?.salt) return null;
  return {
    encryptedPayload: attrs.encryptedPayload,
    salt: attrs.salt,
    kdf: attrs.kdf || "PBKDF2",
    iterations: Number(attrs.iterations) || 310000,
    version: Number(attrs.version) || 1,
  };
};

export const hasLocalKeyMaterial = async (userId: number) => {
  const [identityPrivate, profileKey] = await Promise.all([
    getStoredKey<CryptoKey>("identity-private"),
    getStoredKey<CryptoKey>(`profile-key-${userId}`),
  ]);
  return Boolean(identityPrivate && profileKey);
};

export const createKeyBackup = async (userId: number, passphrase: string) => {
  const { publicKey, privateKey } = await getOrCreateIdentityKeyPair();
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", publicKey),
    crypto.subtle.exportKey("jwk", privateKey),
  ]);
  const profileKey = await getOrCreateProfileKey(userId);
  const rawProfileKey = await crypto.subtle.exportKey("raw", profileKey);

  const payload: KeyBackupPayload = {
    v: 1,
    identityPublicJwk: publicJwk,
    identityPrivateJwk: privateJwk,
    profileKeyRaw: toBase64(rawProfileKey),
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 310000;
  const passphraseKey = await derivePassphraseKey(passphrase, salt, iterations);
  const encryptedPayload = await encryptJson(passphraseKey, payload);

  await api.put("/key-backups/me", {
    data: {
      encryptedPayload,
      salt: toBase64(salt),
      kdf: "PBKDF2",
      iterations,
      version: 1,
    },
  });
};

export const restoreKeyBackup = async (userId: number, passphrase: string) => {
  const record = await fetchKeyBackup();
  if (!record) {
    throw new Error("Missing key backup");
  }
  const salt = fromBase64(record.salt);
  const passphraseKey = await derivePassphraseKey(
    passphrase,
    salt,
    Number(record.iterations) || 310000
  );
  const payload = await decryptJson<KeyBackupPayload>(passphraseKey, record.encryptedPayload);
  if (!payload?.identityPrivateJwk || !payload?.identityPublicJwk || !payload?.profileKeyRaw) {
    throw new Error("Invalid backup payload");
  }

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
