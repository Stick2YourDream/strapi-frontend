const DB_NAME = "ysp-e2ee";
const STORE_NAME = "keys";
const DB_VERSION = 1;

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

export const getStoredKey = async <T>(key: string) =>
  withStore<T | null>("readonly", (store) => store.get(key));

export const setStoredKey = async (key: string, value: unknown) =>
  withStore("readwrite", (store) => store.put(value, key));

export const getOrCreateIdentityKeyPair = async () => {
  const storedPublic = await getStoredKey<CryptoKey>("identity-public");
  const storedPrivate = await getStoredKey<CryptoKey>("identity-private");
  if (storedPublic && storedPrivate) {
    return { publicKey: storedPublic, privateKey: storedPrivate };
  }
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
  await setStoredKey("identity-public", keyPair.publicKey);
  await setStoredKey("identity-private", keyPair.privateKey);
  return keyPair;
};

export const exportPublicKey = async (key: CryptoKey) => {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return JSON.stringify(jwk);
};

export const importPublicKey = async (value: string) => {
  const jwk = JSON.parse(value);
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
};

export const deriveSharedKey = async (privateKey: CryptoKey, publicKey: CryptoKey) =>
  crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

export const getOrCreateProfileKey = async (userId: number) => {
  const storageKey = `profile-key-${userId}`;
  const stored = await getStoredKey<CryptoKey>(storageKey);
  if (stored) return stored;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  await setStoredKey(storageKey, key);
  return key;
};

export const generateCallKey = async () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

export const encryptJson = async (key: CryptoKey, payload: unknown) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = textEncoder.encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return JSON.stringify({
    v: 1,
    iv: toBase64(iv),
    data: toBase64(encrypted),
  });
};

export const decryptJson = async <T>(key: CryptoKey, payload: string): Promise<T> => {
  const parsed = JSON.parse(payload);
  if (!parsed?.iv || !parsed?.data) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = fromBase64(parsed.iv);
  const data = fromBase64(parsed.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  const text = textDecoder.decode(decrypted);
  return JSON.parse(text) as T;
};

export const encryptKeyForRecipient = async (sharedKey: CryptoKey, keyToWrap: CryptoKey) => {
  const raw = await crypto.subtle.exportKey("raw", keyToWrap);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, raw);
  return JSON.stringify({
    v: 1,
    iv: toBase64(iv),
    data: toBase64(encrypted),
  });
};

export const decryptWrappedKey = async (sharedKey: CryptoKey, payload: string) => {
  const parsed = JSON.parse(payload);
  if (!parsed?.iv || !parsed?.data) {
    throw new Error("Invalid wrapped key payload");
  }
  const iv = fromBase64(parsed.iv);
  const data = fromBase64(parsed.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, data);
  return crypto.subtle.importKey(
    "raw",
    decrypted,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const getStoredText = async (key: string) =>
  withStore<string | null>("readonly", (store) => store.get(key));

export const setStoredText = async (key: string, value: string) =>
  withStore("readwrite", (store) => store.put(value, key));
