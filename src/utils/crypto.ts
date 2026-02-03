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

type SerializedCryptoKey = {
  __type: "crypto-key";
  format: "jwk" | "raw";
  algorithm: "ECDH" | "AES-GCM";
  usages: KeyUsage[];
  extractable: boolean;
  data: JsonWebKey | string;
};

const isCryptoKeyLike = (value: unknown): value is CryptoKey => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as CryptoKey;
  return (
    typeof (candidate as { type?: unknown }).type === "string" &&
    typeof (candidate as { algorithm?: unknown }).algorithm === "object" &&
    typeof (candidate as { extractable?: unknown }).extractable === "boolean" &&
    Array.isArray((candidate as { usages?: unknown }).usages)
  );
};

const isSerializedCryptoKey = (value: unknown): value is SerializedCryptoKey => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as SerializedCryptoKey;
  return (
    candidate.__type === "crypto-key" &&
    (candidate.format === "jwk" || candidate.format === "raw") &&
    (candidate.algorithm === "ECDH" || candidate.algorithm === "AES-GCM")
  );
};

const serializeCryptoKey = async (key: CryptoKey): Promise<SerializedCryptoKey> => {
  const algorithmName = key.algorithm?.name;
  const usages = Array.isArray(key.usages) ? key.usages : [];
  const extractable = Boolean(key.extractable);
  if (algorithmName === "ECDH") {
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return {
      __type: "crypto-key",
      format: "jwk",
      algorithm: "ECDH",
      usages,
      extractable,
      data: jwk,
    };
  }
  if (algorithmName === "AES-GCM") {
    const raw = await crypto.subtle.exportKey("raw", key);
    return {
      __type: "crypto-key",
      format: "raw",
      algorithm: "AES-GCM",
      usages,
      extractable,
      data: toBase64(raw),
    };
  }
  throw new Error(`Unsupported key algorithm: ${String(algorithmName)}`);
};

const deserializeCryptoKey = async (payload: SerializedCryptoKey): Promise<CryptoKey> => {
  const usages = Array.isArray(payload.usages) ? payload.usages : [];
  const extractable = Boolean(payload.extractable);
  if (payload.algorithm === "ECDH" && payload.format === "jwk") {
    const jwk = payload.data as JsonWebKey;
    const namedCurve = typeof jwk?.crv === "string" ? jwk.crv : "P-256";
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDH", namedCurve },
      extractable,
      usages
    );
  }
  if (payload.algorithm === "AES-GCM" && payload.format === "raw") {
    const raw = fromBase64(String(payload.data || ""));
    return crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM", length: 256 },
      extractable,
      usages
    );
  }
  throw new Error(`Unsupported key payload: ${payload.algorithm}:${payload.format}`);
};

export const getStoredKey = async <T>(key: string) => {
  const stored = await withStore<unknown | null>("readonly", (store) => store.get(key));
  if (!stored) return null;
  if (isCryptoKeyLike(stored)) {
    void (async () => {
      try {
        const serialized = await serializeCryptoKey(stored);
        await withStore("readwrite", (store) => store.put(serialized, key));
      } catch {
        // Ignore serialization failures and keep the existing key.
      }
    })();
    return stored as T;
  }
  if (isSerializedCryptoKey(stored)) {
    try {
      const imported = await deserializeCryptoKey(stored);
      return imported as T;
    } catch {
      return null;
    }
  }
  return stored as T;
};

export const setStoredKey = async (key: string, value: unknown) => {
  if (isCryptoKeyLike(value)) {
    try {
      const serialized = await serializeCryptoKey(value);
      return withStore("readwrite", (store) => store.put(serialized, key));
    } catch {
      // Fall back to storing the key directly if serialization fails.
    }
  }
  return withStore("readwrite", (store) => store.put(value, key));
};

export const removeStoredKey = async (key: string) =>
  withStore("readwrite", (store) => store.delete(key));

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

export const removeStoredText = async (key: string) =>
  withStore("readwrite", (store) => store.delete(key));
