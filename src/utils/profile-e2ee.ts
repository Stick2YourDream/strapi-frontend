import api from "../api/strapi";
import {
  decryptJson,
  decryptWrappedKey,
  deriveSharedKey,
  encryptJson,
  encryptKeyForRecipient,
  exportPublicKey,
  getOrCreateIdentityKeyPair,
  getOrCreateProfileKey,
  getStoredKey,
  importPublicKey,
  removeStoredKey,
} from "./crypto";

export type ProfilePayload = {
  firstName?: string;
  lastName?: string;
  age?: string;
  birthday?: string;
  gender?: string;
  religion?: string;
  country?: string;
  countryCode?: string;
  state?: string;
  stateCode?: string;
  city?: string;
  hobbies?: string;
  occupation?: string;
  bio?: string;
  phone?: string;
  phoneDialCode?: string;
  backgrounds?: Record<
    string,
    {
      color?: string;
      colorOpacity?: number;
      image?: string;
      gradientStart?: string;
      gradientEnd?: string;
      gradientAngle?: number;
      gradientOpacity?: number;
    }
  >;
  intent?: string;
  onboardingComplete?: boolean;
  profileVisibility?: ProfileVisibility;
  privacySettings?: PrivacySettings;
  searchIndexingEnabled?: boolean;
  externalIndexingEnabled?: boolean;
  activityVisibility?: VisibilityLevel;
  notificationSettings?: NotificationSettings;
  storefrontDefaultLocation?: string;
  storefrontDefaultRadiusMiles?: number;
  lastSeenAt?: string;
};

export type VisibilityLevel = "public" | "followers" | "private";

export type ProfileVisibility = VisibilityLevel | "custom";

export type PrivacySettings = {
  bio?: VisibilityLevel;
  links?: VisibilityLevel;
  location?: VisibilityLevel;
  birthday?: VisibilityLevel;
  followers?: VisibilityLevel;
  following?: VisibilityLevel;
  activity?: VisibilityLevel;
};

export type NotificationSettings = {
  dndEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
  pushEnabled?: boolean;
  newsEnabled?: boolean;
  friendsNotificationsEnabled?: boolean;
  groupsNotificationsEnabled?: boolean;
  forumsNotificationsEnabled?: boolean;
  storefrontNotificationsEnabled?: boolean;
};

export type NotificationReadState = {
  lastSeenAt?: string;
  likeSnapshot?: Record<string, number>;
  birthdaySeen?: Record<string, string>;
};

export const PROFILE_PII_CLEAR_FIELDS = {
  intent: null,
  onboardingComplete: null,
} as const;

type UserKeyEntry = {
  ownerId: number;
  publicKey: string;
  keyVersion?: number;
};

const userKeyCache = new Map<number, UserKeyEntry>();
const profileKeyCache = new Map<number, CryptoKey>();

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
  const num = Number(rawId);
  return Number.isFinite(num) ? num : null;
};

export const buildProfilePayloadFromAttrs = (attrs: any): ProfilePayload => ({
  firstName: attrs?.firstName || "",
  lastName: attrs?.lastName || "",
  age: attrs?.age || "",
  birthday: attrs?.birthday || "",
  gender: attrs?.gender || "",
  religion: attrs?.religion || "",
  country: attrs?.country || "",
  countryCode: attrs?.countryCode || "",
  state: attrs?.state || "",
  stateCode: attrs?.stateCode || "",
  city: attrs?.city || "",
  hobbies: attrs?.hobbies || "",
  occupation: attrs?.occupation || "",
  bio: attrs?.bio || "",
  phone: attrs?.phone || "",
  phoneDialCode: attrs?.phoneDialCode || "",
  backgrounds: attrs?.backgrounds || undefined,
  intent: attrs?.intent || undefined,
  onboardingComplete:
    typeof attrs?.onboardingComplete === "boolean" ? attrs.onboardingComplete : undefined,
  profileVisibility: attrs?.profileVisibility || undefined,
  privacySettings: attrs?.privacySettings || undefined,
  searchIndexingEnabled:
    typeof attrs?.searchIndexingEnabled === "boolean"
      ? attrs.searchIndexingEnabled
      : undefined,
  externalIndexingEnabled:
    typeof attrs?.externalIndexingEnabled === "boolean"
      ? attrs.externalIndexingEnabled
      : undefined,
  activityVisibility: attrs?.activityVisibility || undefined,
  notificationSettings: attrs?.notificationSettings || undefined,
  storefrontDefaultLocation: attrs?.storefrontDefaultLocation || undefined,
  storefrontDefaultRadiusMiles:
    typeof attrs?.storefrontDefaultRadiusMiles === "number"
      ? attrs.storefrontDefaultRadiusMiles
      : attrs?.storefrontDefaultRadiusMiles
      ? Number(attrs.storefrontDefaultRadiusMiles)
      : undefined,
  lastSeenAt: attrs?.lastSeenAt || undefined,
});

export const ensureUserKeyOnServer = async () => {
  const { publicKey } = await getOrCreateIdentityKeyPair();
  const publicKeyText = await exportPublicKey(publicKey);
  try {
    await api.put("/user-keys/me", {
      data: {
        publicKey: publicKeyText,
        keyVersion: 1,
      },
    });
  } catch (error) {
    console.warn("Unable to sync public key to server:", error);
  }
  return publicKeyText;
};

export const fetchUserKeys = async (userIds: number[]) => {
  const missing = userIds.filter((id) => !userKeyCache.has(id));
  if (!missing.length) {
    return userKeyCache;
  }

  const idsParam = missing.join(",");
  try {
    const res = await api.get("/user-keys/lookup", {
      params: { userIds: idsParam },
    });
    const rows = res.data?.data ?? [];
    rows.forEach((row: any) => {
      const attrs = normalize(row);
      const ownerId = getEntityId(attrs.owner) ?? Number(attrs.ownerId);
      if (!ownerId || !attrs.publicKey) return;
      userKeyCache.set(ownerId, {
        ownerId,
        publicKey: attrs.publicKey,
        keyVersion: Number(attrs.keyVersion) || 1,
      });
    });
  } catch (error) {
    const filters = missing
      .map((id, index) => `filters[owner][id][$in][${index}]=${id}`)
      .join("&");
    try {
      const res = await api.get(
        `/user-keys?${filters}&populate=owner&pagination[pageSize]=${missing.length}`
      );
      const rows = res.data?.data ?? [];
      rows.forEach((row: any) => {
        const attrs = normalize(row);
        const ownerId = getEntityId(attrs.owner) ?? Number(attrs.ownerId);
        if (!ownerId || !attrs.publicKey) return;
        userKeyCache.set(ownerId, {
          ownerId,
          publicKey: attrs.publicKey,
          keyVersion: Number(attrs.keyVersion) || 1,
        });
      });
    } catch (fallbackError) {
      console.warn("Unable to load user public keys:", fallbackError);
    }
  }
  return userKeyCache;
};

export const getOrCreateSelfProfileKey = async (
  userId: number,
  options?: { create?: boolean }
) => {
  const cached = profileKeyCache.get(userId);
  if (cached) return cached;
  if (options?.create === false) {
    const stored = await getStoredKey<CryptoKey>(`profile-key-${userId}`);
    if (!stored) return null;
    profileKeyCache.set(userId, stored);
    return stored;
  }
  const key = await getOrCreateProfileKey(userId);
  profileKeyCache.set(userId, key);
  return key;
};

export const resetSelfProfileKey = async (userId: number) => {
  profileKeyCache.delete(userId);
  await removeStoredKey(`profile-key-${userId}`);
};

export const encryptProfilePayload = async (userId: number, payload: ProfilePayload) => {
  const key = await getOrCreateSelfProfileKey(userId, { create: true });
  if (!key) {
    throw new Error("Missing profile key");
  }
  return encryptJson(key, payload);
};

export const decryptOwnProfilePayload = async <T = ProfilePayload>(
  userId: number,
  encryptedPayload: string
) => {
  const key = await getOrCreateSelfProfileKey(userId, { create: false });
  if (!key) {
    throw new Error("Missing profile key");
  }
  return decryptJson<T>(key, encryptedPayload);
};

export const ensureProfileKeyShares = async (
  ownerId: number,
  friendIds: number[]
) => {
  if (!friendIds.length) return;
  await fetchUserKeys(friendIds);
  const { privateKey } = await getOrCreateIdentityKeyPair();
  const profileKey = await getOrCreateSelfProfileKey(ownerId, { create: false });
  if (!profileKey) {
    console.warn("Missing profile key; skipping profile key shares.");
    return;
  }

  const existingShares = new Set<number>();
  try {
    const res = await api.get("/profile-key-shares", {
      params: { ownerId },
    });
    (res.data?.data ?? []).forEach((entry: any) => {
      const attrs = normalize(entry);
      const recipientId = getEntityId(attrs.recipient);
      if (recipientId) existingShares.add(recipientId);
    });
  } catch (error) {
    console.warn("Unable to check existing key shares:", error);
  }

  await Promise.all(
    friendIds.map(async (friendId) => {
      if (existingShares.has(friendId)) return;
      const friendKey = userKeyCache.get(friendId);
      if (!friendKey?.publicKey) return;
      const friendPublicKey = await importPublicKey(friendKey.publicKey);
      const sharedKey = await deriveSharedKey(privateKey, friendPublicKey);
      const encryptedKey = await encryptKeyForRecipient(sharedKey, profileKey);
      try {
        await api.post("/profile-key-shares", {
          data: {
            recipient: friendId,
            encryptedKey,
            keyVersion: 1,
          },
        });
      } catch (error) {
        console.warn("Unable to share profile key:", error);
      }
    })
  );
};

export const deleteProfileKeyShares = async () => {
  try {
    await api.delete("/profile-key-shares/me");
  } catch (error) {
    console.warn("Unable to delete profile key shares:", error);
  }
};

export const getFriendProfileKey = async (
  ownerId: number,
  viewerId: number
) => {
  const cached = profileKeyCache.get(ownerId);
  if (cached) return cached;

  await fetchUserKeys([ownerId]);
  const ownerKey = userKeyCache.get(ownerId);
  if (!ownerKey?.publicKey) {
    throw new Error("Missing owner public key");
  }

  let sharePayload: string | null = null;
  try {
    const res = await api.get("/profile-key-shares", {
      params: { ownerId, recipientId: viewerId },
    });
    const entries = res.data?.data ?? [];
    const entry = entries[0];
    if (entry) {
      const attrs = normalize(entry);
      sharePayload = attrs.encryptedKey || null;
    }
  } catch (error) {
    console.warn("Unable to load profile key share:", error);
  }

  if (!sharePayload) {
    throw new Error("Missing profile key share");
  }

  const { privateKey } = await getOrCreateIdentityKeyPair();
  const ownerPublicKey = await importPublicKey(ownerKey.publicKey);
  const sharedKey = await deriveSharedKey(privateKey, ownerPublicKey);
  const profileKey = await decryptWrappedKey(sharedKey, sharePayload);
  profileKeyCache.set(ownerId, profileKey);
  return profileKey;
};

export const decryptFriendProfilePayload = async <T = ProfilePayload>(
  ownerId: number,
  viewerId: number,
  encryptedPayload: string
) => {
  const key = await getFriendProfileKey(ownerId, viewerId);
  return decryptJson<T>(key, encryptedPayload);
};
