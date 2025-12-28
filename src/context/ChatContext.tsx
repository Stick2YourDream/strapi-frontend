import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../api/strapi";
import { useAuth } from "./AuthContext";

export type ChatFriend = {
  userId: number;
  handle?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
};

type ChatMessage = {
  id: string | number;
  body: string;
  from: "me" | "them";
  at: string;
};

type ChatContextValue = {
  activeFriend: ChatFriend | null;
  popoutMinimized: boolean;
  chatLogs: Record<string, ChatMessage[]>;
  drafts: Record<string, string>;
  gifDrafts: Record<string, string>;
  openChat: (friend: ChatFriend) => void;
  setPopoutMinimized: (value: boolean) => void;
  setDraft: (friendId: number, value: string) => void;
  setGifDraft: (friendId: number, value: string) => void;
  sendMessage: (friendId: number, body: string) => Promise<string | null>;
};

const CHAT_STORE_KEY = "chatLogs_v1";
const CHAT_ACTIVE_KEY = "chatActiveFriend_v1";
const CHAT_MIN_KEY = "chatMinimized_v1";
const CHAT_DRAFT_KEY = "chatDrafts_v1";
const CHAT_GIF_KEY = "chatGifDrafts_v1";
const CHAT_TTL_MS = 4 * 365 * 24 * 60 * 60 * 1000; // ~4 years
const CHAT_REFRESH_MS = 10000;

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
  const num = Number(rawId);
  return Number.isFinite(num) ? num : undefined;
};

const safeParseJson = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const pruneLogs = (logs: Record<string, ChatMessage[]>) => {
  const cutoff = Date.now() - CHAT_TTL_MS;
  const pruned: Record<string, ChatMessage[]> = {};
  Object.entries(logs).forEach(([key, msgs]) => {
    const filtered = msgs.filter((m) => {
      const t = new Date(m.at).getTime();
      return Number.isFinite(t) ? t >= cutoff : true;
    });
    if (filtered.length) pruned[key] = filtered;
  });
  return pruned;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const [activeFriend, setActiveFriend] = useState<ChatFriend | null>(null);
  const [popoutMinimized, setPopoutMinimized] = useState(true);
  const [chatLogs, setChatLogs] = useState<Record<string, ChatMessage[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [gifDrafts, setGifDrafts] = useState<Record<string, string>>({});

  const storageKey = useCallback(
    (base: string) => (userId ? `${base}_${userId}` : base),
    [userId]
  );

  useEffect(() => {
    if (!userId) {
      setActiveFriend(null);
      setPopoutMinimized(true);
      setChatLogs({});
      setDrafts({});
      setGifDrafts({});
      return;
    }

    const activeRaw = safeParseJson(localStorage.getItem(storageKey(CHAT_ACTIVE_KEY)));
    setActiveFriend(activeRaw && typeof activeRaw === "object" ? (activeRaw as ChatFriend) : null);

    const minimizedRaw = localStorage.getItem(storageKey(CHAT_MIN_KEY));
    setPopoutMinimized(minimizedRaw === null ? true : minimizedRaw === "true");

    const logsRaw = safeParseJson(localStorage.getItem(storageKey(CHAT_STORE_KEY)));
    setChatLogs(
      logsRaw && typeof logsRaw === "object" ? pruneLogs(logsRaw as Record<string, ChatMessage[]>) : {}
    );

    const draftsRaw = safeParseJson(localStorage.getItem(storageKey(CHAT_DRAFT_KEY)));
    setDrafts(draftsRaw && typeof draftsRaw === "object" ? draftsRaw : {});

    const gifsRaw = safeParseJson(localStorage.getItem(storageKey(CHAT_GIF_KEY)));
    setGifDrafts(gifsRaw && typeof gifsRaw === "object" ? gifsRaw : {});
  }, [storageKey, userId]);

  useEffect(() => {
    if (!userId) return;
    localStorage.setItem(storageKey(CHAT_ACTIVE_KEY), JSON.stringify(activeFriend));
  }, [activeFriend, storageKey, userId]);

  useEffect(() => {
    if (!userId) return;
    localStorage.setItem(storageKey(CHAT_MIN_KEY), String(popoutMinimized));
  }, [popoutMinimized, storageKey, userId]);

  useEffect(() => {
    if (!userId) return;
    const pruned = pruneLogs(chatLogs);
    localStorage.setItem(storageKey(CHAT_STORE_KEY), JSON.stringify(pruned));
  }, [chatLogs, storageKey, userId]);

  useEffect(() => {
    if (!userId) return;
    localStorage.setItem(storageKey(CHAT_DRAFT_KEY), JSON.stringify(drafts));
  }, [drafts, storageKey, userId]);

  useEffect(() => {
    if (!userId) return;
    localStorage.setItem(storageKey(CHAT_GIF_KEY), JSON.stringify(gifDrafts));
  }, [gifDrafts, storageKey, userId]);

  const loadConversation = useCallback(
    async (friendId: number) => {
      if (!userId || !Number.isFinite(friendId)) return;
      const query = [
        `filters[$or][0][sender][id][$eq]=${userId}`,
        `filters[$or][0][recipient][id][$eq]=${friendId}`,
        `filters[$or][1][sender][id][$eq]=${friendId}`,
        `filters[$or][1][recipient][id][$eq]=${userId}`,
        "sort=createdAt:desc",
        "pagination[pageSize]=200",
        "populate=sender",
        "populate=recipient",
      ].join("&");
      try {
        const res = await api.get(`/messages?${query}`);
        const mapped: ChatMessage[] = (res.data?.data ?? []).map((m: any) => {
          const attrs = normalize(m);
          const senderId = getEntityId(attrs.sender);
          return {
            id: m.id ?? attrs.documentId ?? `${senderId}-${attrs.createdAt ?? ""}`,
            body: attrs.body || "",
            from: senderId === userId ? "me" : "them",
            at: attrs.createdAt || new Date().toISOString(),
          };
        });
        mapped.sort((a, b) => {
          const aTime = new Date(a.at).getTime();
          const bTime = new Date(b.at).getTime();
          return bTime - aTime;
        });
        setChatLogs((prev) => ({ ...prev, [String(friendId)]: mapped }));
      } catch {
        // ignore chat load errors
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!userId || !activeFriend?.userId) return;
    void loadConversation(activeFriend.userId);
    const interval = window.setInterval(() => loadConversation(activeFriend.userId), CHAT_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [activeFriend?.userId, loadConversation, userId]);

  const openChat = useCallback(
    (friend: ChatFriend) => {
      if (!friend?.userId) return;
      setActiveFriend(friend);
      setPopoutMinimized(false);
      void loadConversation(friend.userId);
    },
    [loadConversation]
  );

  const setDraft = useCallback((friendId: number, value: string) => {
    if (!Number.isFinite(friendId)) return;
    setDrafts((prev) => ({ ...prev, [String(friendId)]: value }));
  }, []);

  const setGifDraft = useCallback((friendId: number, value: string) => {
    if (!Number.isFinite(friendId)) return;
    setGifDrafts((prev) => ({ ...prev, [String(friendId)]: value }));
  }, []);

  const sendMessage = useCallback(
    async (friendId: number, body: string) => {
      if (!userId || !Number.isFinite(friendId)) return "Missing sender or recipient.";
      if (!body.trim()) return "Message is empty.";
      try {
        await api.post("/messages", {
          data: {
            body,
            recipient: Number(friendId),
          },
        });
        setDrafts((prev) => ({ ...prev, [String(friendId)]: "" }));
        setGifDrafts((prev) => ({ ...prev, [String(friendId)]: "" }));
        await loadConversation(friendId);
        return null;
      } catch (err) {
        if (err && typeof err === "object" && "response" in err) {
          const anyErr = err as any;
          return (
            anyErr.response?.data?.error?.message ||
            anyErr.response?.data?.message ||
            "Failed to send message"
          );
        }
        return "Failed to send message";
      }
    },
    [loadConversation, userId]
  );

  const value = useMemo(
    () => ({
      activeFriend,
      popoutMinimized,
      chatLogs,
      drafts,
      gifDrafts,
      openChat,
      setPopoutMinimized,
      setDraft,
      setGifDraft,
      sendMessage,
    }),
    [
      activeFriend,
      chatLogs,
      drafts,
      gifDrafts,
      openChat,
      popoutMinimized,
      sendMessage,
      setDraft,
      setGifDraft,
      setPopoutMinimized,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within ChatProvider");
  return context;
};
