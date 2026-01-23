import api from "../api/strapi";

export type PushSyncStatus =
  | "enabled"
  | "disabled"
  | "prompt"
  | "denied"
  | "unsupported"
  | "error";

type PushSyncResult = {
  status: PushSyncStatus;
  error?: string;
};

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
};

const fetchPublicKey = async () => {
  const res = await api.get("/push/public-key");
  const key = String(res.data?.publicKey || "").trim();
  return key || null;
};

const getRegistration = async () => {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
};

export const syncPushSubscription = async (options: {
  enable: boolean;
  requestPermission?: boolean;
}): Promise<PushSyncResult> => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { status: "unsupported" };
  }

  const registration = await getRegistration();
  if (!registration) return { status: "unsupported" };

  if (!options.enable) {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      try {
        await api.post("/push/unsubscribe", { endpoint: existing.endpoint });
      } catch {
        // ignore push cleanup failures
      }
      await existing.unsubscribe();
    }
    return { status: "disabled" };
  }

  if (Notification.permission === "denied") {
    return { status: "denied" };
  }

  if (Notification.permission === "default" && options.requestPermission) {
    const permission = await Notification.requestPermission();
    if (permission === "denied") {
      return { status: "denied" };
    }
    if (permission !== "granted") {
      return { status: "prompt" };
    }
  } else if (Notification.permission === "default") {
    return { status: "prompt" };
  }

  try {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const publicKey = await fetchPublicKey();
      if (!publicKey) {
        return { status: "error", error: "Push notifications are unavailable." };
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await api.post("/push/subscribe", {
      subscription: subscription.toJSON(),
    });

    return { status: "enabled" };
  } catch (error) {
    return { status: "error", error: "Unable to enable push notifications." };
  }
};
