import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import PopupModal from "../components/PopupModal";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { pickMediaUrl } from "../utils/media";
import { sanitizePostText } from "../utils/emoji";
import { formatPostUpdateLabel } from "../utils/time";
import "../css/dashboard.css";
import "../css/post-manager.css";

type ManagedPost = {
  id: number | string;
  documentId?: number | string;
  numericId?: number;
  text: string;
  media?: string;
  createdAt?: string;
  visibility?: string;
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

type FolderItem = {
  id: string;
  name: string;
};

type UnknownRecord = Record<string, unknown>;

type PostActionContextState = {
  x: number;
  y: number;
  postKeys: string[];
};

const FOLDER_ALL = "__all__";
const FOLDERS_KEY_PREFIX = "ysp-post-manager-folders";
const ASSIGNMENTS_KEY_PREFIX = "ysp-post-manager-assignments";
const MEDIA_FOLDER_STORAGE_PREFIX = "ysp_media_folders_v1";
const POST_MANAGER_MIGRATION_PREFIX = "ysp-post-manager-migration-v1";
const HOLD_TO_SELECT_MS = 1000;
const HOLD_MOVE_TOLERANCE_PX = 60;

const normalizeFolderName = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);

const sanitizeFolderItems = (value: unknown): FolderItem[] => {
  if (!Array.isArray(value)) return [];
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const folders: FolderItem[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const raw = entry as { id?: unknown; name?: unknown };
    const id = String(raw.id ?? "").trim();
    const name = normalizeFolderName(raw.name);
    if (!id || !name) return;
    const nameKey = name.toLowerCase();
    if (seenIds.has(id) || seenNames.has(nameKey)) return;
    seenIds.add(id);
    seenNames.add(nameKey);
    folders.push({ id, name });
  });
  return folders.slice(0, 100);
};

const mergeFolderItems = (baseFolders: FolderItem[], incomingFolders: FolderItem[]): FolderItem[] => {
  const next = [...baseFolders];
  const seenNames = new Set(baseFolders.map((folder) => folder.name.toLowerCase()));
  const seenIds = new Set(baseFolders.map((folder) => folder.id));
  incomingFolders.forEach((incoming) => {
    const name = normalizeFolderName(incoming.name);
    if (!name) return;
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) return;
    let id = String(incoming.id || "").trim();
    if (!id || seenIds.has(id)) {
      id = buildFolderId(name);
    }
    seenNames.add(nameKey);
    seenIds.add(id);
    next.push({ id, name });
  });
  return next.slice(0, 100);
};

const sanitizeFolderNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  value.forEach((entry) => {
    const name = normalizeFolderName(entry);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names.slice(0, 100);
};

const parseLegacyFolderItems = (value: unknown): FolderItem[] => {
  if (!value) return [];
  const parsed: FolderItem[] = [];
  const addFolder = (rawName: unknown, rawId?: unknown) => {
    const name = normalizeFolderName(rawName);
    if (!name) return;
    parsed.push({
      id: String(rawId ?? "").trim() || buildFolderId(name),
      name,
    });
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (typeof entry === "string" || typeof entry === "number") {
        addFolder(entry);
        return;
      }
      if (!entry || typeof entry !== "object") return;
      const raw = entry as Record<string, unknown>;
      addFolder(raw.name ?? raw.folderName ?? raw.label ?? raw.value, raw.id ?? raw.folderId);
    });
    return sanitizeFolderItems(parsed);
  }

  if (typeof value === "object") {
    const rawRecord = value as Record<string, unknown>;
    Object.entries(rawRecord).forEach(([rawKey, rawValue]) => {
      if (typeof rawValue === "string" || typeof rawValue === "number") {
        addFolder(rawValue, rawKey);
        return;
      }
      if (!rawValue || typeof rawValue !== "object") return;
      const raw = rawValue as Record<string, unknown>;
      addFolder(
        raw.name ?? raw.folderName ?? raw.label ?? raw.value,
        raw.id ?? raw.folderId ?? rawKey
      );
    });
  }

  return sanitizeFolderItems(parsed);
};

const parseLegacyAssignments = (value: unknown): Record<string, string> => {
  const next: Record<string, string> = {};
  const addAssignment = (rawPostKey: unknown, rawFolder: unknown) => {
    const postKey = String(rawPostKey ?? "").trim();
    if (!postKey) return;
    const folderRef = String(rawFolder ?? "").trim();
    if (!folderRef) return;
    if (next[postKey] !== undefined) return;
    next[postKey] = folderRef;
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const raw = entry as Record<string, unknown>;
      addAssignment(
        raw.postKey ?? raw.postId ?? raw.post ?? raw.id ?? raw.documentId,
        raw.folderId ?? raw.folder ?? raw.folderName ?? raw.collection
      );
    });
    return next;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([postKey, rawValue]) => {
      if (typeof rawValue === "string" || typeof rawValue === "number") {
        addAssignment(postKey, rawValue);
        return;
      }
      if (!rawValue || typeof rawValue !== "object") return;
      const raw = rawValue as Record<string, unknown>;
      addAssignment(
        postKey,
        raw.folderId ?? raw.folder ?? raw.folderName ?? raw.value ?? raw.id
      );
    });
  }

  return next;
};

const folderNameSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

const buildFolderId = (name: string): string =>
  `folder-${folderNameSlug(name) || Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const mergeFolderItemsByName = (localFolders: FolderItem[], profileFolderNames: string[]) => {
  const next = [...localFolders];
  const nameSet = new Set(localFolders.map((folder) => folder.name.toLowerCase()));
  profileFolderNames.forEach((name) => {
    const key = name.toLowerCase();
    if (nameSet.has(key)) return;
    next.push({ id: buildFolderId(name), name });
    nameSet.add(key);
  });
  return next.slice(0, 100);
};

const toFolderNameList = (folders: FolderItem[]) =>
  sanitizeFolderNames(folders.map((folder) => folder.name));

const areStringListsEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const parseJwtUserIdFromToken = (token: string | null | undefined): number | null => {
  const raw = String(token || "").trim();
  if (!raw) return null;
  const clean = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : raw;
  const parts = clean.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded)) as { id?: unknown; userId?: unknown; sub?: unknown };
    const parsed = Number(decoded.id ?? decoded.userId ?? decoded.sub);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const getStoredUserId = () => {
  if (typeof window === "undefined") return null;
  try {
    const rawId =
      window.localStorage.getItem("userId") || window.sessionStorage.getItem("userId");
    const parsedId = Number(rawId);
    if (Number.isFinite(parsedId) && parsedId > 0) return parsedId;

    const rawUser =
      window.localStorage.getItem("user") || window.sessionStorage.getItem("user");
    if (rawUser) {
      const parsedUser = JSON.parse(rawUser) as { id?: number | string } | null;
      const idFromUser = Number(parsedUser?.id);
      if (Number.isFinite(idFromUser) && idFromUser > 0) return idFromUser;
    }

    const rawToken =
      window.localStorage.getItem("token") || window.sessionStorage.getItem("token");
    return parseJwtUserIdFromToken(rawToken);
  } catch {
    return null;
  }
};

const readLocalObject = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeLocalObject = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore local storage errors so page actions still work.
  }
};

const normalizeEntity = (value: unknown): UnknownRecord => {
  if (!value || typeof value !== "object") return {};
  const record = value as UnknownRecord;
  if (record.attributes && typeof record.attributes === "object") {
    return record.attributes as UnknownRecord;
  }
  return record;
};

const buildPostKey = (post: ManagedPost): string =>
  String(post.documentId ?? post.id ?? post.numericId ?? "");

const buildPostUpdateAttempts = (post: ManagedPost): string[] => {
  const attempts: string[] = [];
  if (post.documentId !== undefined && post.documentId !== null) {
    attempts.push(`/users-posts/${String(post.documentId)}`);
  }
  const numericId = typeof post.id === "number" ? post.id : Number(post.id);
  if (Number.isFinite(numericId)) {
    attempts.push(`/users-posts/${numericId}`);
  }
  if (post.id !== undefined && post.id !== null) {
    attempts.push(`/users-posts/${String(post.id)}`);
  }
  return Array.from(new Set(attempts));
};

const buildPostDeleteAttempts = (post: ManagedPost): string[] => {
  const attempts: string[] = [];
  if (post.documentId !== undefined && post.documentId !== null) {
    attempts.push(`/users-posts/${String(post.documentId)}?locale=en`);
  }
  const numericId = typeof post.id === "number" ? post.id : Number(post.id);
  if (Number.isFinite(numericId)) {
    attempts.push(`/users-posts/${numericId}`);
  }
  if (post.id !== undefined && post.id !== null) {
    attempts.push(`/users-posts/${String(post.id)}`);
  }
  return Array.from(new Set(attempts));
};

const isVideoUrl = (value?: string): boolean =>
  /\.(mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(String(value || ""));

const extractFirstUrl = (text: string) => {
  const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};

export default function PostManagerPage(): JSX.Element {
  const { user, profile } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [previewPost, setPreviewPost] = useState<ManagedPost | null>(null);
  const [editPost, setEditPost] = useState<ManagedPost | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletePostKeys, setDeletePostKeys] = useState<string[]>([]);
  const [deleteMode, setDeleteMode] = useState<"folder" | "entirely">("entirely");
  const [deleteFolderOnlyId, setDeleteFolderOnlyId] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [activeFolderId, setActiveFolderId] = useState<string>(FOLDER_ALL);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPostKeys, setSelectedPostKeys] = useState<string[]>([]);
  const [movePostKeys, setMovePostKeys] = useState<string[]>([]);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>(FOLDER_ALL);
  const [visibilityPostKeys, setVisibilityPostKeys] = useState<string[]>([]);
  const [visibilityValue, setVisibilityValue] = useState<string>("friends");
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [folderPostKey, setFolderPostKey] = useState<string | null>(null);
  const [folderValue, setFolderValue] = useState<string>(FOLDER_ALL);
  const [sharePostKeys, setSharePostKeys] = useState<string[]>([]);
  const [mobileActionPostKeys, setMobileActionPostKeys] = useState<string[]>([]);
  const [postActionContext, setPostActionContext] = useState<PostActionContextState | null>(null);
  const [folderActionId, setFolderActionId] = useState<string | null>(null);
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [moveFolderSourceId, setMoveFolderSourceId] = useState<string | null>(null);
  const [moveFolderTargetId, setMoveFolderTargetId] = useState<string>(FOLDER_ALL);
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>({});
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [multiSelectModifierDown, setMultiSelectModifierDown] = useState(false);
  const [storageHydratedKey, setStorageHydratedKey] = useState("");
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimersRef = useRef<Record<string, number>>({});
  const longPressTriggeredRef = useRef<Record<string, boolean>>({});
  const longPressTouchStartRef = useRef<Record<string, { x: number; y: number }>>({});
  const longPressStartAtRef = useRef<Record<string, number>>({});
  const previewCacheRef = useRef<Record<string, LinkPreview | null>>({});
  const foldersLastSyncedRef = useRef("[]");

  usePageMeta({
    title: "Post Manager | Your Social Place",
    description: "Edit, delete, organize, and bulk-manage your posts in one place.",
  });

  const pageBackground = getBackgroundStyle("profile") || getBackgroundStyle("dashboard");
  const effectiveUserId = useMemo(() => user?.id ?? getStoredUserId(), [user?.id]);
  const foldersStorageKey = useMemo(
    () => (effectiveUserId ? `${FOLDERS_KEY_PREFIX}-${effectiveUserId}` : ""),
    [effectiveUserId]
  );
  const assignmentsStorageKey = useMemo(
    () => (effectiveUserId ? `${ASSIGNMENTS_KEY_PREFIX}-${effectiveUserId}` : ""),
    [effectiveUserId]
  );
  const storageKeyVersion = `${foldersStorageKey}|${assignmentsStorageKey}`;
  const profileFolderNames = useMemo(
    () => sanitizeFolderNames(profile?.mediaFolders ?? []),
    [profile?.mediaFolders]
  );
  const [serverFolderNames, setServerFolderNames] = useState<string[]>(profileFolderNames);

  useEffect(() => {
    setServerFolderNames((prev) => (areStringListsEqual(prev, profileFolderNames) ? prev : profileFolderNames));
  }, [profileFolderNames]);

  useEffect(() => {
    if (!user?.id) {
      setServerFolderNames([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await api.get("/profiles/me");
        const attrs = normalizeEntity(response?.data?.data);
        const nextFolders = sanitizeFolderNames((attrs as { mediaFolders?: unknown })?.mediaFolders ?? []);
        if (!cancelled) {
          setServerFolderNames((prev) =>
            areStringListsEqual(prev, nextFolders) ? prev : nextFolders
          );
        }
      } catch {
        // Keep using context/local values when profile refresh fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!effectiveUserId || !foldersStorageKey || !assignmentsStorageKey) return;
    const migrationMarkerKey = `${POST_MANAGER_MIGRATION_PREFIX}-${effectiveUserId}`;
    if (window.localStorage.getItem(migrationMarkerKey) === "1") return;

    const folderKeyCandidates = Array.from(
      new Set(
        [
          foldersStorageKey,
          `${FOLDERS_KEY_PREFIX}:${effectiveUserId}`,
          `${FOLDERS_KEY_PREFIX}_${effectiveUserId}`,
          FOLDERS_KEY_PREFIX,
          `${MEDIA_FOLDER_STORAGE_PREFIX}_${effectiveUserId}`,
        ].filter(Boolean)
      )
    );

    const assignmentKeyCandidates = Array.from(
      new Set(
        [
          assignmentsStorageKey,
          `${ASSIGNMENTS_KEY_PREFIX}:${effectiveUserId}`,
          `${ASSIGNMENTS_KEY_PREFIX}_${effectiveUserId}`,
          ASSIGNMENTS_KEY_PREFIX,
        ].filter(Boolean)
      )
    );

    let migratedFolders: FolderItem[] = [];
    folderKeyCandidates.forEach((candidateKey) => {
      const raw = readLocalObject<unknown>(candidateKey, null);
      const parsed = parseLegacyFolderItems(raw);
      if (!parsed.length) return;
      migratedFolders = mergeFolderItems(migratedFolders, parsed);
    });
    migratedFolders = mergeFolderItemsByName(migratedFolders, serverFolderNames);

    const rawAssignments: Record<string, string> = {};
    assignmentKeyCandidates.forEach((candidateKey) => {
      const raw = readLocalObject<unknown>(candidateKey, null);
      const parsed = parseLegacyAssignments(raw);
      Object.entries(parsed).forEach(([postKey, folderRef]) => {
        if (rawAssignments[postKey] !== undefined) return;
        rawAssignments[postKey] = folderRef;
      });
    });

    const folderIdSet = new Set(migratedFolders.map((folder) => folder.id));
    const folderNameToId = new Map(
      migratedFolders.map((folder) => [folder.name.toLowerCase(), folder.id])
    );
    const normalizedAssignments: Record<string, string> = {};
    Object.entries(rawAssignments).forEach(([postKey, rawFolderRef]) => {
      const folderRef = String(rawFolderRef || "").trim();
      if (!folderRef) return;
      if (folderIdSet.has(folderRef)) {
        normalizedAssignments[postKey] = folderRef;
        return;
      }
      const normalizedName = normalizeFolderName(folderRef).toLowerCase();
      const mappedFolderId = folderNameToId.get(normalizedName);
      if (!mappedFolderId) return;
      normalizedAssignments[postKey] = mappedFolderId;
    });

    if (migratedFolders.length) {
      writeLocalObject(foldersStorageKey, migratedFolders);
    }
    if (Object.keys(normalizedAssignments).length) {
      writeLocalObject(assignmentsStorageKey, normalizedAssignments);
    }
    window.localStorage.setItem(migrationMarkerKey, "1");
  }, [
    assignmentsStorageKey,
    effectiveUserId,
    foldersStorageKey,
    serverFolderNames,
  ]);

  const fetchPosts = useCallback(async () => {
    if (!user?.id) {
      setPosts([]);
      setPostsLoaded(false);
      return;
    }
    setLoading(true);
    setPostsLoaded(false);
    setError(null);
    try {
      const postsRes = await api.get(
        `/users-posts?filters[owner][id][$eq]=${user.id}&populate=Users_Pictures&sort=createdAt:desc`
      );
      const mappedPosts: ManagedPost[] = (postsRes.data?.data ?? []).map((rawItem: unknown) => {
        const item = rawItem as UnknownRecord;
        const attrs = normalizeEntity(item);
        const image = pickMediaUrl((attrs as UnknownRecord).Users_Pictures, { kind: "post" });
        const rawId = item.id ?? attrs.id ?? item.documentId ?? attrs.documentId;
        const numericId = Number(rawId);
        return {
          id: rawId ?? Math.random().toString(36).slice(2),
          documentId:
            (item.documentId as string | number | undefined) ??
            (attrs.documentId as string | number | undefined),
          numericId: Number.isFinite(numericId) ? numericId : undefined,
          text: String(attrs.Users_Content ?? ""),
          media: image,
          createdAt: String(attrs.createdAt ?? attrs.created_at ?? ""),
          visibility: String(attrs.visibility ?? "friends"),
        };
      });
      setPosts(mappedPosts);
      setPostsLoaded(true);
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to load your posts."
        : "Unable to load your posts.";
      setError(String(message));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    previewCacheRef.current = previewCache;
  }, [previewCache]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const detectTouch = () =>
      Boolean(
        window.matchMedia?.("(pointer: coarse)")?.matches ||
          "ontouchstart" in window ||
          navigator.maxTouchPoints > 0
      );
    setIsTouchDevice(detectTouch());
  }, []);

  const fetchLinkPreview = useCallback(async (url: string): Promise<LinkPreview | null> => {
    if (!url) return null;
    const cached = previewCacheRef.current[url];
    if (cached !== undefined) return cached;
    try {
      const res = await api.get("/link-preview", { params: { url } });
      const data = res.data?.data;
      const preview = data?.url
        ? {
            url: String(data.url),
            title: data.title ? String(data.title) : undefined,
            description: data.description ? String(data.description) : undefined,
            image: data.image ? String(data.image) : undefined,
            siteName: data.siteName ? String(data.siteName) : undefined,
            type: data.type ? String(data.type) : undefined,
          }
        : null;
      setPreviewCache((prev) => ({ ...prev, [url]: preview }));
      return preview;
    } catch {
      setPreviewCache((prev) => ({ ...prev, [url]: null }));
      return null;
    }
  }, []);

  useEffect(() => {
    const urls = Array.from(
      new Set(
        posts
          .map((post) => extractFirstUrl(post.text))
          .filter((value): value is string => Boolean(value))
      )
    );
    urls.forEach((url) => {
      if (previewCache[url] !== undefined) return;
      void fetchLinkPreview(url);
    });
  }, [posts, previewCache, fetchLinkPreview]);

  useEffect(() => {
    setStorageHydratedKey("");
    if (!foldersStorageKey || !assignmentsStorageKey) return;
    const storedFolders = readLocalObject<unknown>(foldersStorageKey, []);
    const safeFolders = sanitizeFolderItems(storedFolders);
    const mergedFolders = mergeFolderItemsByName(safeFolders, serverFolderNames);
    const storedAssignments = readLocalObject<Record<string, string>>(assignmentsStorageKey, {});
    const folderIds = new Set(mergedFolders.map((folder) => folder.id));
    const safeAssignments: Record<string, string> = {};
    Object.entries(storedAssignments).forEach(([postKey, folderId]) => {
      if (!postKey) return;
      const normalizedFolderId = String(folderId || "").trim();
      if (!normalizedFolderId || !folderIds.has(normalizedFolderId)) return;
      safeAssignments[postKey] = normalizedFolderId;
    });
    setFolders(mergedFolders);
    setAssignments(safeAssignments);
    foldersLastSyncedRef.current = JSON.stringify(serverFolderNames);
    setStorageHydratedKey(storageKeyVersion);
  }, [foldersStorageKey, assignmentsStorageKey, serverFolderNames, storageKeyVersion]);

  useEffect(() => {
    if (storageHydratedKey !== storageKeyVersion) return;
    if (!foldersStorageKey) return;
    writeLocalObject(foldersStorageKey, folders);
  }, [foldersStorageKey, folders, storageHydratedKey, storageKeyVersion]);

  useEffect(() => {
    if (storageHydratedKey !== storageKeyVersion) return;
    if (!assignmentsStorageKey) return;
    writeLocalObject(assignmentsStorageKey, assignments);
  }, [assignmentsStorageKey, assignments, storageHydratedKey, storageKeyVersion]);

  useEffect(() => {
    if (!user?.id) return;
    if (storageHydratedKey !== storageKeyVersion) return;
    const nextFolders = toFolderNameList(folders);
    const nextSerialized = JSON.stringify(nextFolders);
    if (nextSerialized === foldersLastSyncedRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        await api.put("/profiles/me", { data: { mediaFolders: nextFolders } });
        if (cancelled) return;
        foldersLastSyncedRef.current = nextSerialized;
        setServerFolderNames((prev) =>
          areStringListsEqual(prev, nextFolders) ? prev : nextFolders
        );
      } catch (syncError) {
        if (cancelled) return;
        console.error("Post Manager: failed to sync folders", syncError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folders, storageHydratedKey, storageKeyVersion, user?.id]);

  useEffect(() => {
    if (!postsLoaded) return;
    const livePostKeys = new Set(posts.map((post) => buildPostKey(post)));
    setAssignments((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([postKey, folderId]) => {
        if (livePostKeys.has(postKey)) {
          next[postKey] = folderId;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setSelectedPostKeys((prev) => prev.filter((postKey) => livePostKeys.has(postKey)));
  }, [posts, postsLoaded]);

  useEffect(() => {
    if (!selectedPostKeys.length) {
      setSelectionMode(false);
    }
  }, [selectedPostKeys]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const setModifierState = (next: boolean) => {
      setMultiSelectModifierDown((prev) => (prev === next ? prev : next));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") {
        setModifierState(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") {
        setModifierState(Boolean(event.ctrlKey || event.metaKey));
      }
    };
    const handleWindowBlur = () => setModifierState(false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 2200);
    return () => window.clearTimeout(timer);
  }, [success]);

  const folderPostCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    posts.forEach((post) => {
      const key = buildPostKey(post);
      const folderId = assignments[key];
      if (!folderId) return;
      counts[folderId] = (counts[folderId] || 0) + 1;
    });
    return counts;
  }, [posts, assignments]);

  const filteredPosts = useMemo(() => {
    if (activeFolderId === FOLDER_ALL) return posts;
    return posts.filter((post) => assignments[buildPostKey(post)] === activeFolderId);
  }, [activeFolderId, assignments, posts]);

  const filteredPostKeys = useMemo(
    () => filteredPosts.map((post) => buildPostKey(post)),
    [filteredPosts]
  );

  const postsByKey = useMemo(() => {
    const map = new Map<string, ManagedPost>();
    posts.forEach((post) => {
      map.set(buildPostKey(post), post);
    });
    return map;
  }, [posts]);

  const foldersById = useMemo(() => {
    const map = new Map<string, FolderItem>();
    folders.forEach((folder) => {
      map.set(folder.id, folder);
    });
    return map;
  }, [folders]);

  useEffect(() => {
    if (folderActionId && !foldersById.has(folderActionId)) {
      setFolderActionId(null);
    }
    if (renameFolderId && !foldersById.has(renameFolderId)) {
      setRenameFolderId(null);
      setRenameFolderValue("");
    }
    if (deleteFolderId && !foldersById.has(deleteFolderId)) {
      setDeleteFolderId(null);
    }
    if (moveFolderSourceId && !foldersById.has(moveFolderSourceId)) {
      setMoveFolderSourceId(null);
      setMoveFolderTargetId(FOLDER_ALL);
    }
  }, [deleteFolderId, folderActionId, foldersById, moveFolderSourceId, renameFolderId]);

  useEffect(() => {
    if (visibilityPostKeys.length) {
      const nextKeys = visibilityPostKeys.filter((key) => postsByKey.has(key));
      if (nextKeys.length !== visibilityPostKeys.length) {
        setVisibilityPostKeys(nextKeys);
      }
      if (!nextKeys.length) {
        setSavingVisibility(false);
      }
    }
    if (!visibilityPostKeys.length) {
      setSavingVisibility(false);
    }
    if (folderPostKey && !postsByKey.has(folderPostKey)) {
      setFolderPostKey(null);
      setFolderValue(FOLDER_ALL);
    }
  }, [folderPostKey, postsByKey, visibilityPostKeys]);

  const normalizeActionPostKeys = useCallback(
    (keys: string[]): string[] =>
      Array.from(
        new Set(
          keys
            .map((entry) => String(entry || "").trim())
            .filter((entry) => Boolean(entry) && postsByKey.has(entry))
        )
      ),
    [postsByKey]
  );

  const resolveActionKeysForPost = useCallback(
    (postKey: string) => {
      const normalizedPostKey = String(postKey || "").trim();
      if (!normalizedPostKey) return [] as string[];
      const selectedSet = new Set(selectedPostKeys);
      if (selectedSet.size > 0 && selectedSet.has(normalizedPostKey)) {
        return normalizeActionPostKeys(selectedPostKeys);
      }
      return normalizeActionPostKeys([normalizedPostKey]);
    },
    [normalizeActionPostKeys, selectedPostKeys]
  );

  const openPostActionContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, postKey: string) => {
      if (isTouchDevice) return;
      event.preventDefault();
      event.stopPropagation();
      const nextKeys = resolveActionKeysForPost(postKey);
      if (!nextKeys.length) return;
      setPostActionContext({
        x: event.clientX,
        y: event.clientY,
        postKeys: nextKeys,
      });
    },
    [isTouchDevice, resolveActionKeysForPost]
  );

  useEffect(() => {
    if (!postActionContext) return;
    const handlePointerDown = (event: MouseEvent) => {
      const node = contextMenuRef.current;
      if (node && event.target instanceof Node && node.contains(event.target)) return;
      setPostActionContext(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPostActionContext(null);
      }
    };
    const dismiss = () => setPostActionContext(null);
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [postActionContext]);

  const postActionContextStyle = useMemo(() => {
    if (!postActionContext) return undefined;
    if (typeof window === "undefined") {
      return { left: postActionContext.x, top: postActionContext.y };
    }
    const width = 280;
    const height = 220;
    const padding = 12;
    const left = Math.max(
      padding,
      Math.min(postActionContext.x, window.innerWidth - width - padding)
    );
    const top = Math.max(
      padding,
      Math.min(postActionContext.y, window.innerHeight - height - padding)
    );
    return { left, top };
  }, [postActionContext]);

  const clearLongPressTimer = useCallback((postKey: string) => {
    const timerId = longPressTimersRef.current[postKey];
    if (timerId) {
      window.clearTimeout(timerId);
      delete longPressTimersRef.current[postKey];
    }
    delete longPressTouchStartRef.current[postKey];
    delete longPressStartAtRef.current[postKey];
  }, []);

  const togglePostSelection = useCallback((postKey: string) => {
    setSelectionMode(true);
    setSelectedPostKeys((prev) => {
      if (prev.includes(postKey)) {
        return prev.filter((entry) => entry !== postKey);
      }
      return [...prev, postKey];
    });
  }, []);

  const beginLongPress = useCallback(
    (postKey: string, event?: ReactTouchEvent<HTMLElement>) => {
      if (typeof window === "undefined") return;
      clearLongPressTimer(postKey);
      longPressTriggeredRef.current[postKey] = false;
      longPressStartAtRef.current[postKey] = Date.now();
      const touch = event?.touches?.[0];
      if (touch) {
        longPressTouchStartRef.current[postKey] = {
          x: touch.clientX,
          y: touch.clientY,
        };
      }
      longPressTimersRef.current[postKey] = window.setTimeout(() => {
        longPressTriggeredRef.current[postKey] = true;
        togglePostSelection(postKey);
      }, HOLD_TO_SELECT_MS);
    },
    [clearLongPressTimer, togglePostSelection]
  );

  const endLongPress = useCallback(
    (postKey: string, event?: ReactTouchEvent<HTMLElement>) => {
      const startedAt = longPressStartAtRef.current[postKey];
      const elapsedMs = Number.isFinite(startedAt) ? Date.now() - Number(startedAt) : 0;
      const alreadyTriggered = Boolean(longPressTriggeredRef.current[postKey]);
      if (!alreadyTriggered && elapsedMs >= HOLD_TO_SELECT_MS) {
        longPressTriggeredRef.current[postKey] = true;
        togglePostSelection(postKey);
        event?.preventDefault();
        event?.stopPropagation();
      }
      clearLongPressTimer(postKey);
    },
    [clearLongPressTimer, togglePostSelection]
  );

  const handleLongPressMove = useCallback(
    (postKey: string, event: ReactTouchEvent<HTMLElement>) => {
      const start = longPressTouchStartRef.current[postKey];
      if (!start) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaX = Math.abs(touch.clientX - start.x);
      const deltaY = Math.abs(touch.clientY - start.y);
      if (deltaX > HOLD_MOVE_TOLERANCE_PX || deltaY > HOLD_MOVE_TOLERANCE_PX) {
        clearLongPressTimer(postKey);
      }
    },
    [clearLongPressTimer]
  );

  const handleCardPrimaryAction = useCallback(
    (post: ManagedPost, event?: ReactMouseEvent<HTMLElement>) => {
      const postKey = buildPostKey(post);
      if (longPressTriggeredRef.current[postKey]) {
        longPressTriggeredRef.current[postKey] = false;
        return;
      }
      const modifierPressed = Boolean(event?.ctrlKey || event?.metaKey || multiSelectModifierDown);
      if (modifierPressed) {
        event?.preventDefault();
        event?.stopPropagation();
        togglePostSelection(postKey);
        return;
      }
      if (selectionMode) {
        togglePostSelection(postKey);
        return;
      }
      setPreviewPost(post);
    },
    [multiSelectModifierDown, selectionMode, togglePostSelection]
  );

  const assignPostToFolder = useCallback((postKey: string, folderId: string) => {
    if (folderId === FOLDER_ALL) {
      setAssignments((prev) => {
        if (!(postKey in prev)) return prev;
        const next = { ...prev };
        delete next[postKey];
        return next;
      });
      setSuccess("Post moved to All posts.");
      return;
    }
    setAssignments((prev) => ({ ...prev, [postKey]: folderId }));
    setSuccess("Post moved.");
  }, []);

  const removeFolder = useCallback(
    (folderId: string) => {
      setFolders((prev) => {
        const next = prev.filter((folder) => folder.id !== folderId);
        if (foldersStorageKey) {
          writeLocalObject(foldersStorageKey, next);
        }
        return next;
      });
      setAssignments((prev) => {
        const next: Record<string, string> = {};
        Object.entries(prev).forEach(([postKey, value]) => {
          if (value !== folderId) {
            next[postKey] = value;
          }
        });
        if (assignmentsStorageKey) {
          writeLocalObject(assignmentsStorageKey, next);
        }
        return next;
      });
      if (activeFolderId === folderId) {
        setActiveFolderId(FOLDER_ALL);
      }
    },
    [activeFolderId, assignmentsStorageKey, foldersStorageKey]
  );

  const createFolder = () => {
    const cleaned = newFolderName.trim().replace(/\s+/g, " ");
    if (!cleaned) return;
    const exists = folders.some(
      (folder) => folder.name.toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) {
      setError("Folder name already exists.");
      return;
    }
    const nextFolder: FolderItem = {
      id: buildFolderId(cleaned),
      name: cleaned,
    };
    setFolders((prev) => {
      const next = [nextFolder, ...prev].slice(0, 100);
      if (foldersStorageKey) {
        writeLocalObject(foldersStorageKey, next);
      }
      return next;
    });
    setNewFolderName("");
    setError(null);
    setSuccess("Folder created.");
  };

  const openFolderActionsForId = useCallback(
    (folderId: string, event?: ReactMouseEvent<HTMLElement>) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const normalizedId = String(folderId || "").trim();
      if (!normalizedId || !foldersById.has(normalizedId)) return;
      setFolderActionId(normalizedId);
    },
    [foldersById]
  );

  const startRenameFolder = useCallback(
    (folderId: string) => {
      const folder = foldersById.get(folderId);
      if (!folder) return;
      setRenameFolderId(folder.id);
      setRenameFolderValue(folder.name);
      setFolderActionId(null);
    },
    [foldersById]
  );

  const saveRenamedFolder = useCallback(() => {
    const targetId = String(renameFolderId || "").trim();
    if (!targetId) return;
    const cleaned = normalizeFolderName(renameFolderValue);
    if (!cleaned) {
      setError("Folder name is required.");
      return;
    }
    const exists = folders.some(
      (folder) => folder.id !== targetId && folder.name.toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) {
      setError("Folder name already exists.");
      return;
    }
    setFolders((prev) =>
      prev.map((folder) => (folder.id === targetId ? { ...folder, name: cleaned } : folder))
    );
    setRenameFolderId(null);
    setRenameFolderValue("");
    setError(null);
    setSuccess("Folder renamed.");
  }, [folders, renameFolderId, renameFolderValue]);

  const startDeleteFolder = useCallback((folderId: string) => {
    const normalizedId = String(folderId || "").trim();
    if (!normalizedId) return;
    setDeleteFolderId(normalizedId);
    setFolderActionId(null);
  }, []);

  const confirmDeleteFolder = useCallback(() => {
    const targetId = String(deleteFolderId || "").trim();
    if (!targetId) return;
    removeFolder(targetId);
    setDeleteFolderId(null);
    setSuccess("Folder deleted.");
  }, [deleteFolderId, removeFolder]);

  const startMoveFolderPosts = useCallback(
    (folderId: string) => {
      const normalizedId = String(folderId || "").trim();
      if (!normalizedId) return;
      setMoveFolderSourceId(normalizedId);
      setMoveFolderTargetId(FOLDER_ALL);
      setFolderActionId(null);
    },
    []
  );

  const applyMoveFolderPosts = useCallback(() => {
    const sourceId = String(moveFolderSourceId || "").trim();
    if (!sourceId) return;
    const targetId = String(moveFolderTargetId || FOLDER_ALL).trim() || FOLDER_ALL;
    if (targetId === sourceId) {
      setMoveFolderSourceId(null);
      setMoveFolderTargetId(FOLDER_ALL);
      return;
    }
    let moved = 0;
    setAssignments((prev) => {
      const next = { ...prev };
      Object.entries(prev).forEach(([postKey, folderId]) => {
        if (folderId !== sourceId) return;
        moved += 1;
        if (targetId === FOLDER_ALL) {
          delete next[postKey];
        } else {
          next[postKey] = targetId;
        }
      });
      return next;
    });
    if (activeFolderId === sourceId) {
      setActiveFolderId(targetId === FOLDER_ALL ? FOLDER_ALL : targetId);
    }
    setMoveFolderSourceId(null);
    setMoveFolderTargetId(FOLDER_ALL);
    setSuccess(
      moved
        ? `Moved ${moved} post${moved === 1 ? "" : "s"} from folder.`
        : "No posts in this folder to move."
    );
  }, [activeFolderId, moveFolderSourceId, moveFolderTargetId]);

  const buildShareUrl = useCallback((post: ManagedPost, postKey: string) => {
    if (typeof window === "undefined") return "";
    const origin = String(window.location.origin || "").trim().replace(/\/+$/, "");
    const configuredBase = String(import.meta.env.VITE_PUBLIC_SITE_URL || "")
      .trim()
      .replace(/\/+$/, "");
    const base = origin.startsWith("http")
      ? origin
      : configuredBase.startsWith("http")
      ? configuredBase
      : "";
    if (!base) return "";
    const configuredApi = String(import.meta.env.VITE_API_URL || "")
      .trim()
      .replace(/\/+$/, "");
    const shareApiBase = (() => {
      if (!configuredApi) return `${base}/api`;
      if (/^https?:\/\//i.test(configuredApi)) {
        return /\/api$/i.test(configuredApi) ? configuredApi : `${configuredApi}/api`;
      }
      const normalizedPath = /\/api$/i.test(configuredApi)
        ? configuredApi
        : `${configuredApi}/api`;
      const path = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
      return `${base}${path}`;
    })();
    const shareId = String(post.documentId ?? post.numericId ?? post.id ?? postKey ?? "").trim();
    if (!shareId) return "";
    const params = new URLSearchParams();
    params.set("source", "user");
    params.set("id", shareId);
    params.set("site", base);
    return `${shareApiBase}/share/post?${params.toString()}`;
  }, []);

  const closePostActionMenus = useCallback(() => {
    setPostActionContext(null);
    setMobileActionPostKeys([]);
  }, []);

  const openEditForPostKeys = useCallback(
    (keys: string[]) => {
      const nextKeys = normalizeActionPostKeys(keys);
      if (nextKeys.length !== 1) {
        setError("Select exactly one post to edit.");
        return;
      }
      const target = postsByKey.get(nextKeys[0]);
      if (!target) {
        setError("Unable to load selected post.");
        return;
      }
      setEditPost(target);
      setEditText(target.text || "");
      closePostActionMenus();
    },
    [closePostActionMenus, normalizeActionPostKeys, postsByKey]
  );

  const openViewForPostKeys = useCallback(
    (keys: string[]) => {
      const nextKeys = normalizeActionPostKeys(keys);
      if (nextKeys.length !== 1) {
        setError("Select exactly one post to view.");
        return;
      }
      const target = postsByKey.get(nextKeys[0]);
      if (!target) {
        setError("Unable to load selected post.");
        return;
      }
      setPreviewPost(target);
      closePostActionMenus();
    },
    [closePostActionMenus, normalizeActionPostKeys, postsByKey]
  );

  const openDeleteForPostKeys = useCallback(
    (keys: string[]) => {
      const nextKeys = normalizeActionPostKeys(keys);
      if (!nextKeys.length) return;
      const folderIds = Array.from(
        new Set(
          nextKeys
            .map((postKey) => String(assignments[postKey] || "").trim())
            .filter(Boolean)
        )
      );
      let folderDeleteCandidate: string | null = null;
      if (
        activeFolderId !== FOLDER_ALL &&
        nextKeys.every((postKey) => assignments[postKey] === activeFolderId)
      ) {
        folderDeleteCandidate = activeFolderId;
      } else if (folderIds.length === 1) {
        folderDeleteCandidate = folderIds[0] || null;
      }
      setDeleteFolderOnlyId(folderDeleteCandidate);
      setDeleteMode(folderDeleteCandidate ? "folder" : "entirely");
      setDeletePostKeys(nextKeys);
      closePostActionMenus();
    },
    [activeFolderId, assignments, closePostActionMenus, normalizeActionPostKeys]
  );

  const openShareForPostKeys = useCallback(
    (keys: string[]) => {
      const nextKeys = normalizeActionPostKeys(keys);
      if (!nextKeys.length) return;
      setSharePostKeys(nextKeys);
      closePostActionMenus();
    },
    [closePostActionMenus, normalizeActionPostKeys]
  );

  const openMoveForPostKeys = useCallback(
    (keys: string[]) => {
      const nextKeys = normalizeActionPostKeys(keys);
      if (!nextKeys.length) return;
      setMovePostKeys(nextKeys);
      setMoveTargetFolderId(FOLDER_ALL);
      closePostActionMenus();
    },
    [closePostActionMenus, normalizeActionPostKeys]
  );

  const copyShareLinks = useCallback(async () => {
    const targets = normalizeActionPostKeys(sharePostKeys)
      .map((key) => {
        const post = postsByKey.get(key);
        if (!post) return "";
        return buildShareUrl(post, key);
      })
      .filter(Boolean);
    if (!targets.length) {
      setError("No shareable link found.");
      return;
    }
    const payload = targets.join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setSuccess(targets.length === 1 ? "Link copied." : `${targets.length} links copied.`);
      setSharePostKeys([]);
    } catch {
      setError("Unable to copy links.");
    }
  }, [buildShareUrl, normalizeActionPostKeys, postsByKey, sharePostKeys]);

  const applyMoveToFolder = useCallback(() => {
    const nextKeys = normalizeActionPostKeys(movePostKeys);
    if (!nextKeys.length) return;
    const nextFolderId = String(moveTargetFolderId || FOLDER_ALL).trim() || FOLDER_ALL;
    setAssignments((prev) => {
      const next = { ...prev };
      nextKeys.forEach((postKey) => {
        if (nextFolderId === FOLDER_ALL) {
          delete next[postKey];
        } else {
          next[postKey] = nextFolderId;
        }
      });
      return next;
    });
    setMovePostKeys([]);
    setMoveTargetFolderId(FOLDER_ALL);
    setSuccess(
      `Moved ${nextKeys.length} post${nextKeys.length === 1 ? "" : "s"}${
        nextFolderId === FOLDER_ALL ? " to All posts." : "."
      }`
    );
  }, [movePostKeys, moveTargetFolderId, normalizeActionPostKeys]);

  const openVisibilityForPostKeys = useCallback(
    (keys: string[]) => {
      const nextKeys = normalizeActionPostKeys(keys);
      if (!nextKeys.length) return;
      const firstPost = postsByKey.get(nextKeys[0]);
      setVisibilityValue(String(firstPost?.visibility || "friends"));
      setVisibilityPostKeys(nextKeys);
      closePostActionMenus();
    },
    [closePostActionMenus, normalizeActionPostKeys, postsByKey]
  );

  const openVisibilityEditor = useCallback(
    (post: ManagedPost, event?: ReactMouseEvent<HTMLElement>) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const postKey = buildPostKey(post);
      if (!postKey) return;
      openVisibilityForPostKeys([postKey]);
    },
    [openVisibilityForPostKeys]
  );

  const saveVisibilityForPosts = useCallback(async () => {
    const targets = normalizeActionPostKeys(visibilityPostKeys);
    if (!targets.length) return;
    const nextVisibility = String(visibilityValue || "friends").trim() || "friends";
    setSavingVisibility(true);
    setError(null);
    let updatedCount = 0;
    try {
      for (const postKey of targets) {
        const target = postsByKey.get(postKey);
        if (!target) continue;
        const attempts = buildPostUpdateAttempts(target);
        let updated = false;
        for (const path of attempts) {
          try {
            await api.put(path, { data: { visibility: nextVisibility, trustedCircle: null } });
            updated = true;
            break;
          } catch (err: unknown) {
            if (axios.isAxiosError(err) && err.response?.status === 404) continue;
            break;
          }
        }
        if (!updated) continue;
        updatedCount += 1;
        setPosts((prev) =>
          prev.map((entry) =>
            buildPostKey(entry) === postKey ? { ...entry, visibility: nextVisibility } : entry
          )
        );
      }
      if (!updatedCount) {
        setError("Unable to update visibility.");
        return;
      }
      setVisibilityPostKeys([]);
      setSuccess(
        `Updated visibility on ${updatedCount} post${updatedCount === 1 ? "" : "s"}.`
      );
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to update visibility."
        : "Unable to update visibility.";
      setError(String(message));
    } finally {
      setSavingVisibility(false);
    }
  }, [normalizeActionPostKeys, postsByKey, visibilityPostKeys, visibilityValue]);

  const openFolderEditor = useCallback(
    (postKey: string, event?: ReactMouseEvent<HTMLElement>) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const normalizedKey = String(postKey || "").trim();
      if (!normalizedKey) return;
      if (!postsByKey.has(normalizedKey)) return;
      const currentFolder = String(assignments[normalizedKey] || "").trim() || FOLDER_ALL;
      setFolderPostKey(normalizedKey);
      setFolderValue(currentFolder);
    },
    [assignments, postsByKey]
  );

  const saveFolderForPost = useCallback(() => {
    const postKey = String(folderPostKey || "").trim();
    if (!postKey) return;
    const nextFolder = String(folderValue || FOLDER_ALL).trim() || FOLDER_ALL;
    setAssignments((prev) => {
      const next = { ...prev };
      if (nextFolder === FOLDER_ALL) {
        delete next[postKey];
      } else {
        next[postKey] = nextFolder;
      }
      return next;
    });
    setFolderPostKey(null);
    setFolderValue(FOLDER_ALL);
    setSuccess(nextFolder === FOLDER_ALL ? "Removed from folder." : "Folder updated.");
  }, [folderPostKey, folderValue]);

  const openPostActionModalForPost = useCallback(
    (postKey: string) => {
      const nextKeys = resolveActionKeysForPost(postKey);
      if (!nextKeys.length) return;
      setMobileActionPostKeys(nextKeys);
    },
    [resolveActionKeysForPost]
  );

  const deleteSinglePost = useCallback(async (post: ManagedPost): Promise<boolean> => {
    const attempts = buildPostDeleteAttempts(post);
    for (const path of attempts) {
      try {
        await api.delete(path);
        const postKey = buildPostKey(post);
        setPosts((prev) => prev.filter((entry) => buildPostKey(entry) !== postKey));
        setAssignments((prev) => {
          if (!(postKey in prev)) return prev;
          const next = { ...prev };
          delete next[postKey];
          return next;
        });
        setSelectedPostKeys((prev) => prev.filter((entry) => entry !== postKey));
        return true;
      } catch (err: unknown) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          continue;
        }
        throw err;
      }
    }
    return false;
  }, []);

  const confirmDeletePost = async () => {
    const targets = normalizeActionPostKeys(deletePostKeys);
    if (!targets.length) return;
    if (deleteMode === "folder" && deleteFolderOnlyId) {
      const targetSet = new Set(targets);
      let removedCount = 0;
      setError(null);
      setAssignments((prev) => {
        const next = { ...prev };
        targets.forEach((postKey) => {
          if (next[postKey] !== deleteFolderOnlyId) return;
          delete next[postKey];
          removedCount += 1;
        });
        return next;
      });
      setSelectedPostKeys((prev) => prev.filter((entry) => !targetSet.has(entry)));
      setDeletePostKeys([]);
      setDeleteMode("entirely");
      setDeleteFolderOnlyId(null);
      if (!removedCount) {
        setError("Selected post(s) are not in this folder.");
      } else {
        setSuccess(
          `Removed ${removedCount} post${removedCount === 1 ? "" : "s"} from folder.`
        );
      }
      return;
    }

    setDeletingKey(targets.length === 1 ? targets[0] : "__bulk__");
    setError(null);
    let removedCount = 0;
    try {
      for (const postKey of targets) {
        const post = postsByKey.get(postKey);
        if (!post) continue;
        try {
          const removed = await deleteSinglePost(post);
          if (removed) removedCount += 1;
        } catch {
          // continue deleting others
        }
      }
      if (!removedCount) {
        setError("Unable to delete selected post(s).");
      } else {
        setDeletePostKeys([]);
        setDeleteMode("entirely");
        setDeleteFolderOnlyId(null);
        setSuccess(
          `${removedCount} post${removedCount === 1 ? "" : "s"} deleted.`
        );
      }
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to delete selected posts."
        : "Unable to delete selected posts.";
      setError(String(message));
    } finally {
      setDeletingKey(null);
    }
  };

  const savePostEdit = async () => {
    if (!editPost) return;
    const nextText = sanitizePostText(editText).trim();
    if (!nextText) {
      setError("Post text cannot be empty.");
      return;
    }
    const attempts = buildPostUpdateAttempts(editPost);
    setSavingEdit(true);
    setError(null);
    try {
      let updated = false;
      for (const path of attempts) {
        try {
          await api.put(path, { data: { Users_Content: nextText } });
          updated = true;
          break;
        } catch (err: unknown) {
          if (axios.isAxiosError(err) && err.response?.status === 404) {
            continue;
          }
          throw err;
        }
      }
      if (!updated) {
        setError("Unable to save this post.");
        return;
      }
      const postKey = buildPostKey(editPost);
      setPosts((prev) =>
        prev.map((entry) =>
          buildPostKey(entry) === postKey ? { ...entry, text: nextText } : entry
        )
      );
      setEditPost(null);
      setEditText("");
      setSuccess("Post updated.");
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to save this post."
        : "Unable to save this post.";
      setError(String(message));
    } finally {
      setSavingEdit(false);
    }
  };

  const runBulkDelete = () => {
    openDeleteForPostKeys(selectedPostKeys);
  };

  const selectAllFilteredPosts = () => {
    const next = normalizeActionPostKeys(filteredPostKeys);
    if (!next.length) return;
    setSelectionMode(true);
    setSelectedPostKeys(next);
    setSuccess(`${next.length} post${next.length === 1 ? "" : "s"} selected.`);
  };

  const resetSelection = () => {
    setSelectionMode(false);
    setSelectedPostKeys([]);
  };

  const onFolderDrop = (event: ReactDragEvent<HTMLElement>, folderId: string) => {
    event.preventDefault();
    const postKey = event.dataTransfer.getData("text/post-key");
    if (!postKey) return;
    assignPostToFolder(postKey, folderId);
    setDropTargetFolderId(null);
  };

  const statusText = loading
    ? "Loading posts..."
    : `${filteredPosts.length} post${filteredPosts.length === 1 ? "" : "s"} shown`;

  return (
    <div className="dashboard-shell post-manager-shell" style={pageBackground}>
      <Sidebar active="me" />
      <div className="main-content post-manager-content">
        <TopbarSearch />

        <section className="panel post-manager-panel">
          <div className="post-manager-header">
            <div>
              <p className="eyebrow">Content</p>
              <h3>Post Manager</h3>
              <p className="panel-sub">
                Bulk-edit, organize, and delete your posts with drag-and-drop folders.
              </p>
            </div>
            <div className="post-manager-header-actions">
              <button className="btn ghost" type="button" onClick={() => navigate("/my-posts")}>
                Back to My Posts
              </button>
              <button className="btn ghost" type="button" onClick={() => void fetchPosts()}>
                Refresh
              </button>
            </div>
          </div>

          <div className="post-manager-meta-row">
            <span className="post-manager-meta">{statusText}</span>
            <span className="post-manager-meta">
              {isTouchDevice
                ? "Mobile tip: hold a post for 1.5 seconds to start multi-select."
                : "Desktop tip: right-click a post or folder for quick actions."}
            </span>
          </div>

          {error && <p className="status status-error">{error}</p>}
          {success && <p className="status status-success">{success}</p>}

          <div className="post-manager-folders">
            <div className="post-manager-folder-create">
              <input
                className="auth-input"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                maxLength={48}
                placeholder="Create folder"
              />
              <button className="btn primary" type="button" onClick={createFolder}>
                Add folder
              </button>
            </div>

            <div className="post-manager-folder-list">
              <button
                type="button"
                className={`post-manager-folder-chip${
                  activeFolderId === FOLDER_ALL ? " is-active" : ""
                }`}
                onClick={() => setActiveFolderId(FOLDER_ALL)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropTargetFolderId(FOLDER_ALL);
                }}
                onDrop={(event) => onFolderDrop(event, FOLDER_ALL)}
                onDragLeave={() => setDropTargetFolderId(null)}
              >
                All posts <span>{posts.length}</span>
              </button>
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className={`post-manager-folder-chip-wrap${
                    dropTargetFolderId === folder.id ? " is-drop-target" : ""
                  }`}
                  onContextMenu={(event) => openFolderActionsForId(folder.id, event)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropTargetFolderId(folder.id);
                  }}
                  onDrop={(event) => onFolderDrop(event, folder.id)}
                  onDragLeave={() => setDropTargetFolderId(null)}
                >
                  <button
                    type="button"
                    className={`post-manager-folder-chip${
                      activeFolderId === folder.id ? " is-active" : ""
                    }`}
                    onClick={() => setActiveFolderId(folder.id)}
                    onContextMenu={(event) => openFolderActionsForId(folder.id, event)}
                  >
                    {folder.name} <span>{folderPostCounts[folder.id] || 0}</span>
                  </button>
                  <button
                    type="button"
                    className="post-manager-folder-remove"
                    aria-label={`Folder actions for ${folder.name}`}
                    onClick={() => openFolderActionsForId(folder.id)}
                  >
                    ⋮
                  </button>
                </div>
              ))}
            </div>
          </div>

          {(selectionMode || selectedPostKeys.length > 0) && (
            <div className="post-manager-bulk-toolbar">
              <div className="post-manager-bulk-title">
                {selectedPostKeys.length} selected
              </div>
              <div className="post-manager-bulk-controls">
                <button
                  className="btn ghost post-manager-bulk-btn"
                  type="button"
                  disabled={!selectedPostKeys.length}
                  onClick={() => setMobileActionPostKeys(normalizeActionPostKeys(selectedPostKeys))}
                >
                  Actions
                </button>
                <button
                  className="btn ghost post-manager-bulk-btn"
                  type="button"
                  disabled={!filteredPostKeys.length}
                  onClick={selectAllFilteredPosts}
                >
                  Select All
                </button>
                <button
                  className="btn ghost post-manager-bulk-btn"
                  type="button"
                  onClick={resetSelection}
                >
                  Clear
                </button>
                <button
                  className="btn danger post-manager-bulk-btn post-manager-bulk-btn--delete"
                  type="button"
                  disabled={!selectedPostKeys.length || Boolean(deletingKey)}
                  onClick={runBulkDelete}
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="status">Loading posts...</p>
          ) : filteredPosts.length === 0 ? (
            <p className="status">
              {activeFolderId === FOLDER_ALL
                ? "No posts yet."
                : "No posts in this folder yet."}
            </p>
          ) : (
            <div className="post-manager-grid" role="list">
              {filteredPosts.map((post) => {
                const postKey = buildPostKey(post);
                const isSelected = selectedPostKeys.includes(postKey);
                const showSelectionMarker =
                  selectionMode ||
                  selectedPostKeys.length > 0 ||
                  (!isTouchDevice && multiSelectModifierDown);
                const folderId = assignments[postKey];
                const folderName = folders.find((folder) => folder.id === folderId)?.name;
                const folderLabel = folderName || "none";
                const postUrl = extractFirstUrl(post.text);
                const preview = postUrl ? previewCache[postUrl] : undefined;
                const previewImage = preview?.image;
                return (
                  <article
                    key={postKey}
                    className={`post-manager-card${isSelected ? " is-selected" : ""}`}
                    draggable={!isTouchDevice}
                    role="listitem"
                    onDragStart={(event) => {
                      if (isTouchDevice) return;
                      event.dataTransfer.setData("text/post-key", postKey);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(event) => handleCardPrimaryAction(post, event)}
                    onTouchStart={(event) => beginLongPress(postKey, event)}
                    onTouchEnd={(event) => endLongPress(postKey, event)}
                    onTouchCancel={() => endLongPress(postKey)}
                    onTouchMove={(event) => handleLongPressMove(postKey, event)}
                    onContextMenu={(event) => {
                      if (isTouchDevice) {
                        event.preventDefault();
                        return;
                      }
                      openPostActionContextMenu(event, postKey);
                    }}
                  >
                    <button
                      type="button"
                      className="post-manager-card-menu-btn"
                      aria-label="Post options"
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        event.stopPropagation();
                        openPostActionModalForPost(postKey);
                      }}
                      onTouchStart={(event) => event.stopPropagation()}
                      onTouchEnd={(event) => event.stopPropagation()}
                    >
                      ⋮
                    </button>
                    {showSelectionMarker && (
                      <span
                        className={`post-manager-select-circle${
                          isSelected ? " is-selected" : ""
                        }`}
                        aria-hidden="true"
                      >
                        {isSelected ? "✓" : ""}
                      </span>
                    )}
                    <div className="post-manager-thumb">
                      {post.media ? (
                        isVideoUrl(post.media) ? (
                          <video src={post.media} muted playsInline preload="metadata" />
                        ) : (
                          <img src={post.media} alt="Post thumbnail" loading="lazy" />
                        )
                      ) : previewImage ? (
                        <img src={previewImage} alt={preview?.title || "Link preview"} loading="lazy" />
                      ) : (
                        <div className="post-manager-thumb-fallback">No media</div>
                      )}
                    </div>

                    <div className="post-manager-card-body">
                      <p className="post-manager-card-date">
                        {formatPostUpdateLabel(post.createdAt || "")}
                      </p>
                      <p className="post-manager-card-text">{post.text || "No caption."}</p>
                      <div className="post-manager-card-meta">
                        <button
                          type="button"
                          className="post-manager-pill post-manager-pill-action post-manager-pill--visibility"
                          onClick={(event) => openVisibilityEditor(post, event)}
                          onTouchStart={(event) => event.stopPropagation()}
                          onTouchEnd={(event) => event.stopPropagation()}
                        >
                          {post.visibility ? `Visibility: ${post.visibility}` : "Visibility: friends"}
                        </button>
                        <button
                          type="button"
                          className="post-manager-pill post-manager-pill-action"
                          onClick={(event) => openFolderEditor(postKey, event)}
                          onTouchStart={(event) => event.stopPropagation()}
                          onTouchEnd={(event) => event.stopPropagation()}
                        >
                          {`Folder: ${folderLabel}`}
                        </button>
                        {!post.media && preview?.siteName && (
                          <span className="post-manager-pill">Source: {preview.siteName}</span>
                        )}
                      </div>
                    </div>

                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {postActionContext && (
        <div
          ref={contextMenuRef}
          className="post-manager-context-menu"
          style={postActionContextStyle}
          role="menu"
          aria-label="Post actions"
        >
          <button
            type="button"
            className="post-manager-context-item"
            role="menuitem"
            disabled={postActionContext.postKeys.length !== 1}
            onClick={() => openEditForPostKeys(postActionContext.postKeys)}
          >
            Edit
          </button>
          <button
            type="button"
            className="post-manager-context-item"
            role="menuitem"
            onClick={() => openDeleteForPostKeys(postActionContext.postKeys)}
          >
            Delete
          </button>
          <button
            type="button"
            className="post-manager-context-item"
            role="menuitem"
            onClick={() => openShareForPostKeys(postActionContext.postKeys)}
          >
            Share
          </button>
          <button
            type="button"
            className="post-manager-context-item"
            role="menuitem"
            onClick={() => openMoveForPostKeys(postActionContext.postKeys)}
          >
            Move to another folder
          </button>
        </div>
      )}

      <PopupModal
        open={Boolean(previewPost)}
        onClose={() => setPreviewPost(null)}
        title="Full post view"
        className="post-manager-modal"
      >
        {previewPost && (() => {
          const postUrl = extractFirstUrl(previewPost.text);
          const preview = postUrl ? previewCache[postUrl] : undefined;
          const previewImage = preview?.image;
          return (
            <div className="post-manager-preview">
              {previewPost.media ? (
                isVideoUrl(previewPost.media) ? (
                  <video
                    src={previewPost.media}
                    controls
                    playsInline
                    className="post-manager-preview-media"
                  />
                ) : (
                  <img
                    src={previewPost.media}
                    alt="Post media"
                    className="post-manager-preview-media"
                  />
                )
              ) : previewImage ? (
                <img
                  src={previewImage}
                  alt={preview?.title || "Link preview"}
                  className="post-manager-preview-media"
                />
              ) : (
                <div className="post-manager-preview-empty">No media attached.</div>
              )}
              <p className="post-manager-preview-text">{previewPost.text || "No caption."}</p>
              {postUrl && (
                <a
                  className="post-manager-preview-link"
                  href={postUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {preview?.title || postUrl}
                </a>
              )}
              <p className="post-manager-preview-date">
                {formatPostUpdateLabel(previewPost.createdAt || "")}
              </p>
            </div>
          );
        })()}
      </PopupModal>

      <PopupModal
        open={Boolean(editPost)}
        onClose={() => {
          setEditPost(null);
          setEditText("");
        }}
        title="Edit post"
        className="post-manager-modal"
      >
        <div className="post-manager-edit-form">
          <textarea
            className="auth-input post-manager-edit-textarea"
            rows={6}
            value={editText}
            onChange={(event) => setEditText(sanitizePostText(event.target.value))}
            placeholder="Update your post text"
          />
          <div className="post-manager-modal-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setEditPost(null);
                setEditText("");
              }}
              disabled={savingEdit}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => void savePostEdit()}
              disabled={savingEdit}
            >
              {savingEdit ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </PopupModal>

      <PopupModal
        open={Boolean(deletePostKeys.length)}
        onClose={() => {
          setDeletePostKeys([]);
          setDeleteMode("entirely");
          setDeleteFolderOnlyId(null);
        }}
        title="Delete post"
        className="post-manager-modal"
      >
        <div className="post-manager-delete-confirm">
          {(() => {
            const folderName = deleteFolderOnlyId
              ? foldersById.get(deleteFolderOnlyId)?.name || "this folder"
              : "";
            return (
              <>
                <p>
                  {deleteMode === "folder" && deleteFolderOnlyId
                    ? `Remove ${
                        deletePostKeys.length > 1
                          ? `${deletePostKeys.length} posts`
                          : "this post"
                      } from "${folderName}" or delete entirely?`
                    : `Are you sure you want to delete ${
                        deletePostKeys.length > 1
                          ? `${deletePostKeys.length} posts`
                          : "this post"
                      }?`}
                </p>
                {deleteFolderOnlyId && (
                  <div className="post-manager-delete-mode">
                    <label className="post-manager-delete-mode-option">
                      <input
                        type="radio"
                        name="post-delete-mode"
                        checked={deleteMode === "folder"}
                        onChange={() => setDeleteMode("folder")}
                      />
                      <span>
                        Remove from folder only
                        <small>Keep the post, only remove it from "{folderName}".</small>
                      </span>
                    </label>
                    <label className="post-manager-delete-mode-option">
                      <input
                        type="radio"
                        name="post-delete-mode"
                        checked={deleteMode === "entirely"}
                        onChange={() => setDeleteMode("entirely")}
                      />
                      <span>
                        Delete entirely
                        <small>Permanently delete the post from your account.</small>
                      </span>
                    </label>
                  </div>
                )}
                <p>
                  {deleteMode === "folder" && deleteFolderOnlyId
                    ? "This only removes selected posts from the folder."
                    : "This action cannot be undone."}
                </p>
              </>
            );
          })()}
          <div className="post-manager-modal-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setDeletePostKeys([]);
                setDeleteMode("entirely");
                setDeleteFolderOnlyId(null);
              }}
            >
              Cancel
            </button>
            <button
              className={deleteMode === "folder" ? "btn primary" : "btn danger"}
              type="button"
              onClick={() => void confirmDeletePost()}
              disabled={Boolean(deletingKey)}
            >
              {deletingKey
                ? deleteMode === "folder"
                  ? "Removing..."
                  : "Deleting..."
                : deleteMode === "folder"
                ? "Remove from folder"
                : "Delete entirely"}
            </button>
          </div>
        </div>
      </PopupModal>

      <PopupModal
        open={Boolean(mobileActionPostKeys.length)}
        onClose={() => setMobileActionPostKeys([])}
        title={
          mobileActionPostKeys.length > 1
            ? `${mobileActionPostKeys.length} posts selected`
            : "Post actions"
        }
        className="post-manager-modal"
      >
        {(() => {
          const actionKeys = normalizeActionPostKeys(mobileActionPostKeys);
          const single = actionKeys.length === 1;
          return (
            <div className="post-manager-action-sheet">
              <button
                type="button"
                className="btn ghost"
                disabled={!single}
                onClick={() => openViewForPostKeys(actionKeys)}
              >
                View
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={!single}
                onClick={() => openEditForPostKeys(actionKeys)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => openVisibilityForPostKeys(actionKeys)}
              >
                Visibility
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => openMoveForPostKeys(actionKeys)}
              >
                Move to another folder
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => openShareForPostKeys(actionKeys)}
              >
                Share
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => openDeleteForPostKeys(actionKeys)}
              >
                Delete
              </button>
            </div>
          );
        })()}
      </PopupModal>

      <PopupModal
        open={Boolean(visibilityPostKeys.length)}
        onClose={() => {
          setVisibilityPostKeys([]);
          setSavingVisibility(false);
        }}
        title={
          visibilityPostKeys.length > 1
            ? `Post visibility (${visibilityPostKeys.length} selected)`
            : "Post visibility"
        }
        className="post-manager-modal"
      >
        <div className="post-manager-edit-form">
          <p className="post-manager-modal-note">
            {visibilityPostKeys.length > 1
              ? "Choose who can view the selected posts."
              : "Choose who can view this post."}
          </p>
          <select
            className="auth-input"
            value={visibilityValue}
            onChange={(event) => setVisibilityValue(event.target.value)}
            disabled={savingVisibility}
          >
            <option value="public">Public</option>
            <option value="friends">Friends</option>
            <option value="private">Private</option>
          </select>
          <div className="post-manager-modal-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setVisibilityPostKeys([]);
                setSavingVisibility(false);
              }}
              disabled={savingVisibility}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => void saveVisibilityForPosts()}
              disabled={savingVisibility}
            >
              {savingVisibility ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </PopupModal>

      <PopupModal
        open={Boolean(folderPostKey)}
        onClose={() => {
          setFolderPostKey(null);
          setFolderValue(FOLDER_ALL);
        }}
        title="Post folder"
        className="post-manager-modal"
      >
        <div className="post-manager-edit-form">
          <p className="post-manager-modal-note">Choose which folder this post belongs to.</p>
          <select
            className="auth-input"
            value={folderValue}
            onChange={(event) => setFolderValue(event.target.value)}
          >
            <option value={FOLDER_ALL}>All posts (no folder)</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <div className="post-manager-modal-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setFolderPostKey(null);
                setFolderValue(FOLDER_ALL);
              }}
            >
              Cancel
            </button>
            <button className="btn primary" type="button" onClick={saveFolderForPost}>
              Save
            </button>
          </div>
        </div>
      </PopupModal>

      <PopupModal
        open={Boolean(folderActionId)}
        onClose={() => setFolderActionId(null)}
        title={folderActionId ? `Folder actions` : "Folder actions"}
        className="post-manager-modal"
      >
        {(() => {
          const folder = folderActionId ? foldersById.get(folderActionId) : null;
          if (!folder) {
            return <p className="post-manager-modal-note">Unable to load folder.</p>;
          }
          return (
            <div className="post-manager-action-sheet">
              <p className="post-manager-modal-note">{folder.name}</p>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setActiveFolderId(folder.id);
                  setFolderActionId(null);
                }}
              >
                Open folder
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => startRenameFolder(folder.id)}
              >
                Rename folder
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => startMoveFolderPosts(folder.id)}
              >
                Move folder posts
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => startDeleteFolder(folder.id)}
              >
                Delete folder
              </button>
            </div>
          );
        })()}
      </PopupModal>

      <PopupModal
        open={Boolean(renameFolderId)}
        onClose={() => {
          setRenameFolderId(null);
          setRenameFolderValue("");
        }}
        title="Rename folder"
        className="post-manager-modal"
      >
        <div className="post-manager-edit-form">
          <input
            className="auth-input"
            value={renameFolderValue}
            maxLength={48}
            onChange={(event) => setRenameFolderValue(event.target.value)}
            placeholder="Folder name"
          />
          <div className="post-manager-modal-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setRenameFolderId(null);
                setRenameFolderValue("");
              }}
            >
              Cancel
            </button>
            <button className="btn primary" type="button" onClick={saveRenamedFolder}>
              Save
            </button>
          </div>
        </div>
      </PopupModal>

      <PopupModal
        open={Boolean(moveFolderSourceId)}
        onClose={() => {
          setMoveFolderSourceId(null);
          setMoveFolderTargetId(FOLDER_ALL);
        }}
        title="Move folder posts"
        className="post-manager-modal"
      >
        <div className="post-manager-edit-form">
          <p className="post-manager-modal-note">
            Move all posts in this folder to:
          </p>
          <select
            className="auth-input"
            value={moveFolderTargetId}
            onChange={(event) => setMoveFolderTargetId(event.target.value)}
          >
            <option value={FOLDER_ALL}>All posts (no folder)</option>
            {folders
              .filter((folder) => folder.id !== moveFolderSourceId)
              .map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
          </select>
          <div className="post-manager-modal-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setMoveFolderSourceId(null);
                setMoveFolderTargetId(FOLDER_ALL);
              }}
            >
              Cancel
            </button>
            <button className="btn primary" type="button" onClick={applyMoveFolderPosts}>
              Move
            </button>
          </div>
        </div>
      </PopupModal>

      <PopupModal
        open={Boolean(deleteFolderId)}
        onClose={() => setDeleteFolderId(null)}
        title="Delete folder"
        className="post-manager-modal"
      >
        <div className="post-manager-delete-confirm">
          <p>Are you sure you want to delete this folder?</p>
          <p>Posts will remain available in All posts.</p>
          <div className="post-manager-modal-actions">
            <button className="btn ghost" type="button" onClick={() => setDeleteFolderId(null)}>
              Cancel
            </button>
            <button className="btn danger" type="button" onClick={confirmDeleteFolder}>
              Delete
            </button>
          </div>
        </div>
      </PopupModal>

      <PopupModal
        open={Boolean(movePostKeys.length)}
        onClose={() => {
          setMovePostKeys([]);
          setMoveTargetFolderId(FOLDER_ALL);
        }}
        title="Move posts"
        className="post-manager-modal"
      >
        <div className="post-manager-edit-form">
          <p className="post-manager-modal-note">
            {movePostKeys.length > 1
              ? `Move ${movePostKeys.length} selected posts to:`
              : "Move selected post to:"}
          </p>
          <select
            className="auth-input"
            value={moveTargetFolderId}
            onChange={(event) => setMoveTargetFolderId(event.target.value)}
          >
            <option value={FOLDER_ALL}>All posts (no folder)</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <div className="post-manager-modal-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setMovePostKeys([]);
                setMoveTargetFolderId(FOLDER_ALL);
              }}
            >
              Cancel
            </button>
            <button className="btn primary" type="button" onClick={applyMoveToFolder}>
              Move
            </button>
          </div>
        </div>
      </PopupModal>

      <PopupModal
        open={Boolean(sharePostKeys.length)}
        onClose={() => setSharePostKeys([])}
        title="Share post"
        className="post-manager-modal"
      >
        {(() => {
          const normalizedKeys = normalizeActionPostKeys(sharePostKeys);
          const primaryKey = normalizedKeys[0] || "";
          const primaryPost = primaryKey ? postsByKey.get(primaryKey) : null;
          const shareUrl = primaryPost ? buildShareUrl(primaryPost, primaryKey) : "";
          const encodedUrl = encodeURIComponent(shareUrl);
          return (
            <div className="post-manager-share-sheet">
              <p className="post-manager-modal-note">
                {normalizedKeys.length > 1
                  ? "Choose copy links to share all selected posts."
                  : "Choose where you want to share this post."}
              </p>
              <div className="post-manager-action-sheet">
                <button className="btn primary" type="button" onClick={() => void copyShareLinks()}>
                  {normalizedKeys.length > 1 ? "Copy links" : "Copy link"}
                </button>
                {normalizedKeys.length === 1 && shareUrl && (
                  <a
                    className="btn ghost"
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Facebook
                  </a>
                )}
                {normalizedKeys.length === 1 && shareUrl && (
                  <a
                    className="btn ghost"
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    LinkedIn
                  </a>
                )}
                {normalizedKeys.length === 1 && shareUrl && (
                  <a
                    className="btn ghost"
                    href={`https://twitter.com/intent/tweet?url=${encodedUrl}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    X
                  </a>
                )}
                {normalizedKeys.length === 1 && shareUrl && (
                  <a
                    className="btn ghost"
                    href={`https://www.reddit.com/submit?url=${encodedUrl}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Reddit
                  </a>
                )}
                {normalizedKeys.length === 1 && shareUrl && (
                  <a
                    className="btn ghost"
                    href={`https://api.whatsapp.com/send?text=${encodedUrl}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>
                )}
              </div>
            </div>
          );
        })()}
      </PopupModal>
    </div>
  );
}
