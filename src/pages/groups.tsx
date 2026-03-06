import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Search, Star, Users } from "lucide-react";
import "../css/dashboard.css";
import "../css/groups.css";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import RightSidebarShell from "../components/RightSidebarShell";
import PopupModal from "../components/PopupModal";
import GroupPostsFeed, { type GroupFeedPost } from "../components/GroupPostsFeed";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { pickMediaUrl, pickMediaUrls } from "../utils/media";

type GroupSummary = {
  id: number | string;
  documentId?: string;
  name: string;
  description?: string;
  location?: string;
  visibility: "public" | "private";
  kind?: string;
  backgroundImage?: string;
  gradientStart?: string;
  gradientEnd?: string;
  gradientAngle?: number;
  role?: "admin" | "moderator" | "member";
  memberCount?: number;
  friendMemberCount?: number;
  isMember?: boolean;
  isFavorite?: boolean;
};

type GroupInvite = {
  id: number | string;
  group: GroupSummary;
  inviterName: string;
};

type PendingJoinRequest = {
  id: number | string;
  groupId: string;
};

type GroupVisibilityFilter = "all" | "public" | "private";
type GroupSortMode = "recommended" | "popular" | "name" | "friends";

const GROUP_FAVORITES_KEY = "groups:favorites:v1";

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? normalize(data)?.id;
  const numericId = Number(rawId);
  return Number.isFinite(numericId) ? numericId : undefined;
};
const isContactLikeLabel = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return true;
  if (/^phone[-_\s:]*\d+$/i.test(trimmed)) return true;
  if (/^\+?\d[\d\s().-]{6,}$/.test(trimmed)) return true;
  return false;
};
const getUserDisplayName = (entry: any, fallback = "Member") => {
  const attrs = normalize(entry);
  const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
  const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const handle = String(attrs?.handle || attrs?.username || "").trim();
  if (fullName) return fullName;
  if (handle && !isContactLikeLabel(handle)) return handle;
  return fallback;
};
const getGroupKey = (group: { id: number | string; documentId?: string }) =>
  String(group.documentId ?? group.id);
const getErrorMessage = (error: unknown, fallback: string) =>
  String(
    (error as any)?.response?.data?.error?.message ||
      (error as any)?.response?.data?.message ||
      fallback
  );

const hexToRgba = (value: string, alpha: number) => {
  const hex = (value || "").replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return value;
};

const toGroupSummary = (entry: any): GroupSummary => {
  const attrs = normalize(entry);
  return {
    id: entry?.id ?? attrs.documentId ?? attrs.id,
    documentId: entry?.documentId ?? attrs.documentId,
    name: attrs.name || "Group",
    description: attrs.description || "",
    location: String(attrs.location || "").trim(),
    visibility: attrs.visibility === "public" ? "public" : "private",
    kind: attrs.kind || "group",
    backgroundImage: pickMediaUrl(attrs.backgroundImage, { kind: "cover" }),
    gradientStart: attrs.gradientStart || "",
    gradientEnd: attrs.gradientEnd || "",
    gradientAngle: Number(attrs.gradientAngle ?? 135),
  };
};

const buildGroupStyle = (group: GroupSummary) => {
  const hasGradient = Boolean(group.gradientStart || group.gradientEnd);
  const angle = Number.isFinite(group.gradientAngle || 0) ? group.gradientAngle : 135;
  const gradient = hasGradient
    ? `linear-gradient(${angle}deg, ${hexToRgba(
        group.gradientStart || "#2563eb",
        0.85
      )}, ${hexToRgba(group.gradientEnd || "#22d3ee", 0.85)})`
    : "linear-gradient(135deg, rgba(8, 12, 22, 0.9), rgba(8, 12, 22, 0.4))";
  if (group.backgroundImage) {
    return {
      backgroundImage: `${gradient}, url("${group.backgroundImage}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { backgroundImage: gradient };
};

const buildIdFilter = (field: string, ids: number[]) =>
  ids.map((id, index) => `filters[${field}][id][$in][${index}]=${id}`).join("&");

const readFavoriteGroupKeys = (userId?: number | null) => {
  if (typeof window === "undefined") return [];
  const currentUserId = Number(userId || 0);
  if (!Number.isFinite(currentUserId) || currentUserId <= 0) return [];
  try {
    const raw = window.localStorage.getItem(GROUP_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const stored = parsed?.[String(currentUserId)];
    if (!Array.isArray(stored)) return [];
    return stored
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const writeFavoriteGroupKeys = (userId: number, keys: string[]) => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(GROUP_FAVORITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next = {
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      [String(userId)]: Array.from(
        new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))
      ),
    };
    window.localStorage.setItem(GROUP_FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // ignore local storage issues
  }
};

const formatGroupLocation = (value?: string) => {
  const trimmed = String(value || "").trim();
  return trimmed || "Location flexible";
};

const compareByName = (left: GroupSummary, right: GroupSummary) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

export default function Groups() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  usePageMeta({
    title: "Groups | Your Social Place",
    description: "Create groups, invite friends, and build shared momentum.",
  });
  const pageBackground = getBackgroundStyle("groups") || getBackgroundStyle("dashboard");

  const [myGroups, setMyGroups] = useState<GroupSummary[]>([]);
  const [publicGroups, setPublicGroups] = useState<GroupSummary[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [updates, setUpdates] = useState<GroupFeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupLocation, setGroupLocation] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [useGradient, setUseGradient] = useState(true);
  const [gradientStart, setGradientStart] = useState("#2563eb");
  const [gradientEnd, setGradientEnd] = useState("#22d3ee");
  const [gradientAngle, setGradientAngle] = useState(135);
  const [useImage, setUseImage] = useState(false);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<
    Record<string, PendingJoinRequest>
  >({});
  const [joinModalGroup, setJoinModalGroup] = useState<GroupSummary | null>(null);
  const [joinReason, setJoinReason] = useState("");
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [joinSubmitting, setJoinSubmitting] = useState(false);

  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverLocation, setDiscoverLocation] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<GroupVisibilityFilter>("all");
  const [sortMode, setSortMode] = useState<GroupSortMode>("recommended");
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteGroupKeys, setFavoriteGroupKeys] = useState<string[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [discoverModalOpen, setDiscoverModalOpen] = useState(false);

  const loadGroups = useCallback(async () => {
    const currentUserId = Number(user?.id || 0);
    if (!Number.isFinite(currentUserId) || currentUserId <= 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [memberRes, inviteRes, publicRes, joinRequestRes, friendsRes] = await Promise.all([
        api.get(
          `/group-members?filters[user][id][$eq]=${currentUserId}` +
            `&populate[group][populate][0]=backgroundImage&pagination[pageSize]=200`
        ),
        api.get(
          `/group-invites?filters[invitee][id][$eq]=${currentUserId}` +
            `&filters[status][$eq]=pending&populate=group&populate=inviter&sort=createdAt:desc`
        ),
        api.get(
          `/groups?filters[visibility][$eq]=public&populate=backgroundImage&pagination[pageSize]=200`
        ),
        api.get(
          `/group-join-requests?filters[requester][id][$eq]=${currentUserId}` +
            `&filters[status][$eq]=pending&populate=group&pagination[pageSize]=200`
        ),
        api.get(
          `/friends?filters[status][$eq]=accepted` +
            `&filters[$or][0][requester][id][$eq]=${currentUserId}` +
            `&filters[$or][1][target][id][$eq]=${currentUserId}` +
            `&populate=requester&populate=target&pagination[pageSize]=200`
        ),
      ]);

      const friendIds = new Set<number>();
      (friendsRes.data?.data ?? []).forEach((entry: any) => {
        const attrs = normalize(entry);
        const requesterId = getEntityId(attrs.requester);
        const targetId = getEntityId(attrs.target);
        const otherId =
          requesterId === currentUserId
            ? targetId
            : targetId === currentUserId
            ? requesterId
            : undefined;
        if (otherId) {
          friendIds.add(otherId);
        }
      });

      const memberGroups: GroupSummary[] = (memberRes.data?.data ?? [])
        .map((member: any) => {
          const memberAttrs = normalize(member);
          const groupEntry = getEntity(memberAttrs.group ?? member.group);
          if (!groupEntry) return null;
          const group = toGroupSummary(groupEntry);
          const role =
            memberAttrs.role === "admin"
              ? "admin"
              : memberAttrs.role === "moderator"
              ? "moderator"
              : "member";
          return { ...group, role, isMember: true };
        })
        .filter(Boolean) as GroupSummary[];
      const nonCircleGroups = memberGroups.filter(
        (group) => (group.kind || "group") !== "circle"
      );

      const inviteList: GroupInvite[] = (inviteRes.data?.data ?? [])
        .map((invite: any) => {
          const attrs = normalize(invite);
          const groupEntry = getEntity(attrs.group);
          const inviterEntry = getEntity(attrs.inviter);
          if (!groupEntry) return null;
          const inviterName = String(normalize(inviterEntry)?.email || "").trim() || "Someone";
          return {
            id: invite.id ?? attrs.documentId,
            group: toGroupSummary(groupEntry),
            inviterName,
          };
        })
        .filter(Boolean) as GroupInvite[];
      const filteredInvites = inviteList.filter(
        (invite) => (invite.group.kind || "group") !== "circle"
      );

      const publicList: GroupSummary[] = (publicRes.data?.data ?? [])
        .map((entry: any) => toGroupSummary(entry))
        .filter(Boolean) as GroupSummary[];
      const filteredPublic = publicList.filter(
        (group) => (group.kind || "group") !== "circle"
      );

      const pendingRequests = (joinRequestRes.data?.data ?? []).reduce(
        (acc: Record<string, PendingJoinRequest>, entry: any) => {
          const attrs = normalize(entry);
          const groupEntry = getEntity(attrs.group);
          if (!groupEntry) return acc;
          const group = toGroupSummary(groupEntry);
          acc[getGroupKey(group)] = {
            id: entry.id ?? attrs.documentId,
            groupId: getGroupKey(group),
          };
          return acc;
        },
        {}
      );

      const joinedGroupKeys = new Set(nonCircleGroups.map((group) => getGroupKey(group)));
      const availablePublic = filteredPublic.filter(
        (group) => !joinedGroupKeys.has(getGroupKey(group))
      );

      const catalogGroupIds = Array.from(
        new Set(
          [...nonCircleGroups, ...availablePublic]
            .map((group) => Number(group.id))
            .filter((id) => Number.isFinite(id))
        )
      );

      const myGroupIds = nonCircleGroups
        .map((group) => Number(group.id))
        .filter((id) => Number.isFinite(id));

      const [memberCountResults, updateRes] = await Promise.all([
        catalogGroupIds.length
          ? Promise.allSettled(
              catalogGroupIds.map(async (groupId) => {
                const totalRes = await api.get(
                  `/group-members?filters[group][id][$eq]=${groupId}` +
                    `&pagination[pageSize]=1`
                );
                const friendRes = friendIds.size
                  ? await api.get(
                      `/group-members?filters[group][id][$eq]=${groupId}` +
                        `&${buildIdFilter("user", Array.from(friendIds))}&pagination[pageSize]=1`
                    )
                  : null;
                return {
                  groupId,
                  memberCount:
                    Number(totalRes.data?.meta?.pagination?.total) ||
                    Number(totalRes.data?.data?.length) ||
                    0,
                  friendMemberCount:
                    Number(friendRes?.data?.meta?.pagination?.total) ||
                    Number(friendRes?.data?.data?.length) ||
                    0,
                };
              })
            )
          : Promise.resolve([]),
        myGroupIds.length
          ? api.get(
              `/group-posts?${buildIdFilter("group", myGroupIds)}` +
                `&populate=group&populate=owner&populate=media&sort=createdAt:desc&pagination[pageSize]=8`
            )
          : Promise.resolve({ data: { data: [] } }),
      ]);

      const memberCountsById: Record<string, number> = {};
      const friendCountsById: Record<string, number> = {};
      memberCountResults.forEach((result) => {
        if (result.status !== "fulfilled") return;
        memberCountsById[String(result.value.groupId)] = Number(result.value.memberCount ?? 0);
        friendCountsById[String(result.value.groupId)] = Number(
          result.value.friendMemberCount ?? 0
        );
      });

      const withMetrics = (group: GroupSummary) => {
        const groupIdKey = String(group.id);
        const role = group.role;
        return {
          ...group,
          memberCount: memberCountsById[groupIdKey] ?? (role ? 1 : 0),
          friendMemberCount: friendCountsById[groupIdKey] ?? 0,
          isMember: Boolean(role || group.isMember),
        } satisfies GroupSummary;
      };

      const updateList: GroupFeedPost[] = (updateRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const groupEntry = getEntity(attrs.group);
          const groupAttrs = normalize(groupEntry);
          const ownerEntry = getEntity(attrs.owner);
          const numericId = Number(entry.id ?? attrs.id);
          return {
            id: entry.id ?? attrs.documentId,
            numericId: Number.isFinite(numericId) ? numericId : undefined,
            documentId: entry.documentId ?? attrs.documentId,
            title: String(attrs.title || "").trim(),
            content: String(attrs.body || attrs.content || "").trim(),
            imageUrl: pickMediaUrls(attrs.media, { kind: "post" })[0],
            createdAt: attrs.createdAt,
            ownerName: getUserDisplayName(ownerEntry, "Member"),
            ownerId: ownerEntry?.id ?? normalize(ownerEntry)?.id,
            likes: Number(attrs.likes ?? 0),
            reactionCounts: attrs.reactionCounts,
            myReaction: attrs.myReaction ?? entry?.myReaction ?? null,
            shares: Number(attrs.shares ?? 0),
            visibility: groupAttrs.visibility === "private" ? "private" : "public",
            groupId: groupEntry?.id ?? groupAttrs.id,
            groupDocumentId: groupEntry?.documentId ?? groupAttrs.documentId,
            groupName: String(groupAttrs.name || "Group"),
          };
        })
        .filter(
          (entry: GroupFeedPost) =>
            Boolean(entry.content || entry.title || entry.imageUrl || entry.groupName)
        ) as GroupFeedPost[];

      setMyGroups(nonCircleGroups.map(withMetrics));
      setInvites(filteredInvites);
      setPublicGroups(availablePublic.map(withMetrics));
      setPendingJoinRequests(pendingRequests);
      setUpdates(updateList);
    } catch {
      setError("Unable to load groups right now.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const currentUserId = Number(user?.id || 0);
    if (!Number.isFinite(currentUserId) || currentUserId <= 0) {
      setFavoriteGroupKeys([]);
      setFavoritesLoaded(false);
      return;
    }
    setFavoriteGroupKeys(readFavoriteGroupKeys(currentUserId));
    setFavoritesLoaded(true);
  }, [user?.id]);

  useEffect(() => {
    const currentUserId = Number(user?.id || 0);
    if (!favoritesLoaded || !Number.isFinite(currentUserId) || currentUserId <= 0) return;
    writeFavoriteGroupKeys(currentUserId, favoriteGroupKeys);
  }, [favoriteGroupKeys, favoritesLoaded, user?.id]);

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setCreateStatus("Add a group name to continue.");
      return;
    }
    setCreating(true);
    setCreateStatus(null);
    try {
      let backgroundId: number | undefined;
      if (useImage && backgroundFile) {
        const fd = new FormData();
        fd.append("files", backgroundFile);
        const uploadRes = await api.post("/upload", fd);
        backgroundId = uploadRes.data?.[0]?.id;
      }

      const payload: any = {
        name: groupName.trim(),
        description: groupDescription.trim(),
        location: groupLocation.trim() || null,
        visibility,
      };
      if (useGradient) {
        payload.gradientStart = gradientStart;
        payload.gradientEnd = gradientEnd;
        payload.gradientAngle = gradientAngle;
      }
      if (backgroundId) payload.backgroundImage = backgroundId;

      await api.post("/groups", { data: payload });
      setGroupName("");
      setGroupDescription("");
      setGroupLocation("");
      setVisibility("private");
      setUseGradient(true);
      setGradientStart("#2563eb");
      setGradientEnd("#22d3ee");
      setGradientAngle(135);
      setUseImage(false);
      setBackgroundFile(null);
      setCreateStatus("Group created! Invite your crew.");
      await loadGroups();
    } catch {
      setCreateStatus("Failed to create group.");
    } finally {
      setCreating(false);
    }
  };

  const handleOpenJoinModal = (group: GroupSummary) => {
    setJoinModalGroup(group);
    setJoinReason("");
    setJoinStatus(null);
  };

  const handleCloseJoinModal = () => {
    if (joinSubmitting) return;
    setJoinModalGroup(null);
    setJoinReason("");
    setJoinStatus(null);
  };

  const handleJoinGroup = async () => {
    if (!joinModalGroup) return;
    const reason = joinReason.trim();
    if (!reason) {
      setJoinStatus("Tell the group why you want to join.");
      return;
    }
    setJoinSubmitting(true);
    setJoinStatus(null);
    setError(null);
    try {
      await api.post("/group-join-requests", {
        data: {
          group: joinModalGroup.id,
          reason,
        },
      });
      await loadGroups();
      setJoinModalGroup(null);
      setJoinReason("");
      setJoinStatus(null);
    } catch (err) {
      setJoinStatus(getErrorMessage(err, "Unable to submit join request."));
    } finally {
      setJoinSubmitting(false);
    }
  };

  const handleAcceptInvite = async (inviteId: number | string) => {
    try {
      await api.put(`/group-invites/${inviteId}`, { data: { status: "accepted" } });
      await loadGroups();
    } catch {
      setError("Unable to accept invite.");
    }
  };

  const handleDeclineInvite = async (inviteId: number | string) => {
    try {
      await api.put(`/group-invites/${inviteId}`, { data: { status: "declined" } });
      await loadGroups();
    } catch {
      setError("Unable to decline invite.");
    }
  };

  const handleToggleFavorite = (group: GroupSummary) => {
    const groupKey = getGroupKey(group);
    setFavoriteGroupKeys((prev) =>
      prev.includes(groupKey)
        ? prev.filter((entry) => entry !== groupKey)
        : [...prev, groupKey]
    );
  };

  const clearDiscoverFilters = () => {
    setDiscoverQuery("");
    setDiscoverLocation("");
    setVisibilityFilter("all");
    setSortMode("recommended");
    setFriendsOnly(false);
    setFavoritesOnly(false);
  };

  const handleRightDiscoverHeadClick = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!document.body.classList.contains("ysp-right-sidebar-collapsed")) return;
    setDiscoverModalOpen(true);
  }, []);

  const favoriteGroupSet = useMemo(() => new Set(favoriteGroupKeys), [favoriteGroupKeys]);

  const browseGroups = useMemo(() => {
    const merged = new Map<string, GroupSummary>();
    [...myGroups, ...publicGroups].forEach((group) => {
      const groupKey = getGroupKey(group);
      const existing = merged.get(groupKey);
      merged.set(groupKey, {
        ...(existing ?? {}),
        ...group,
        memberCount: Number(group.memberCount ?? existing?.memberCount ?? 0),
        friendMemberCount: Number(group.friendMemberCount ?? existing?.friendMemberCount ?? 0),
        isMember: Boolean(group.role || group.isMember || existing?.isMember),
        isFavorite: favoriteGroupSet.has(groupKey),
      });
    });
    return Array.from(merged.values());
  }, [favoriteGroupSet, myGroups, publicGroups]);

  const favoriteGroups = useMemo(
    () => browseGroups.filter((group) => group.isFavorite).sort(compareByName),
    [browseGroups]
  );

  const activeFilters = Boolean(
    discoverQuery.trim() ||
      discoverLocation.trim() ||
      visibilityFilter !== "all" ||
      sortMode !== "recommended" ||
      friendsOnly ||
      favoritesOnly
  );

  const filteredBrowseGroups = useMemo(() => {
    const queryNeedle = discoverQuery.trim().toLowerCase();
    const locationNeedle = discoverLocation.trim().toLowerCase();
    const filtered = browseGroups.filter((group) => {
      const groupText = `${group.name} ${group.description || ""}`.toLowerCase();
      const groupLocationText = String(group.location || "").trim().toLowerCase();

      if (queryNeedle && !groupText.includes(queryNeedle)) return false;
      if (locationNeedle && !groupLocationText.includes(locationNeedle)) return false;
      if (visibilityFilter !== "all" && group.visibility !== visibilityFilter) return false;
      if (friendsOnly && Number(group.friendMemberCount ?? 0) <= 0) return false;
      if (favoritesOnly && !group.isFavorite) return false;
      return true;
    });

    return [...filtered].sort((left, right) => {
      if (sortMode === "name") {
        return compareByName(left, right);
      }
      if (sortMode === "popular") {
        const memberDiff = Number(right.memberCount ?? 0) - Number(left.memberCount ?? 0);
        if (memberDiff !== 0) return memberDiff;
        return compareByName(left, right);
      }
      if (sortMode === "friends") {
        const friendDiff =
          Number(right.friendMemberCount ?? 0) - Number(left.friendMemberCount ?? 0);
        if (friendDiff !== 0) return friendDiff;
        const memberDiff = Number(right.memberCount ?? 0) - Number(left.memberCount ?? 0);
        if (memberDiff !== 0) return memberDiff;
        return compareByName(left, right);
      }

      const favoriteDiff = Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite));
      if (favoriteDiff !== 0) return favoriteDiff;
      const friendDiff =
        Number(right.friendMemberCount ?? 0) - Number(left.friendMemberCount ?? 0);
      if (friendDiff !== 0) return friendDiff;
      const memberDiff = Number(right.memberCount ?? 0) - Number(left.memberCount ?? 0);
      if (memberDiff !== 0) return memberDiff;
      return compareByName(left, right);
    });
  }, [
    browseGroups,
    discoverLocation,
    discoverQuery,
    favoritesOnly,
    friendsOnly,
    sortMode,
    visibilityFilter,
  ]);

  const groupsWithFriendsCount = useMemo(
    () => browseGroups.filter((group) => Number(group.friendMemberCount ?? 0) > 0).length,
    [browseGroups]
  );

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (discoverQuery.trim()) parts.push(`Name: ${discoverQuery.trim()}`);
    if (discoverLocation.trim()) parts.push(`Location: ${discoverLocation.trim()}`);
    if (visibilityFilter !== "all") {
      parts.push(visibilityFilter === "public" ? "Public groups" : "Private groups");
    }
    if (friendsOnly) parts.push("Friends are in these groups");
    if (favoritesOnly) parts.push("Favorites only");
    if (sortMode === "popular") parts.push("Sorted by popularity");
    if (sortMode === "friends") parts.push("Sorted by shared friends");
    if (sortMode === "name") parts.push("Sorted by name");
    return parts.length ? parts.join(" • ") : "Showing every group you can access or discover.";
  }, [discoverLocation, discoverQuery, favoritesOnly, friendsOnly, sortMode, visibilityFilter]);

  const renderDiscoverPanel = (idPrefix: string) => (
    <section className="panel groups-sidebar-panel">
      <div className="panel-header groups-sidebar-panel__header">
        <div>
          <p className="eyebrow">Discover</p>
          <h3>Find your next group</h3>
          <p className="panel-sub">
            Search by name, filter by location and type, and surface groups where your
            friends already hang out.
          </p>
        </div>
      </div>

      <div className="groups-sidebar-stats">
        <article className="groups-sidebar-stat">
          <span>Browseable</span>
          <strong>{browseGroups.length}</strong>
        </article>
        <article className="groups-sidebar-stat">
          <span>Favorites</span>
          <strong>{favoriteGroups.length}</strong>
        </article>
        <article className="groups-sidebar-stat">
          <span>Friends inside</span>
          <strong>{groupsWithFriendsCount}</strong>
        </article>
        <article className="groups-sidebar-stat">
          <span>Mine</span>
          <strong>{myGroups.length}</strong>
        </article>
      </div>

      <div className="groups-sidebar-form">
        <label className="groups-filter-field" htmlFor={`${idPrefix}-name`}>
          <span>Name</span>
          <input
            id={`${idPrefix}-name`}
            type="search"
            value={discoverQuery}
            onChange={(event) => setDiscoverQuery(event.target.value)}
            placeholder="Search by group name"
          />
        </label>

        <label className="groups-filter-field" htmlFor={`${idPrefix}-location`}>
          <span>Location</span>
          <input
            id={`${idPrefix}-location`}
            type="text"
            value={discoverLocation}
            onChange={(event) => setDiscoverLocation(event.target.value)}
            placeholder="City, state, region, or online"
          />
        </label>

        <label className="groups-filter-field" htmlFor={`${idPrefix}-type`}>
          <span>Group type</span>
          <select
            id={`${idPrefix}-type`}
            value={visibilityFilter}
            onChange={(event) =>
              setVisibilityFilter(event.target.value as GroupVisibilityFilter)
            }
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>

        <label className="groups-filter-field" htmlFor={`${idPrefix}-sort`}>
          <span>Popularity</span>
          <select
            id={`${idPrefix}-sort`}
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as GroupSortMode)}
          >
            <option value="recommended">Recommended</option>
            <option value="popular">Most popular</option>
            <option value="friends">Most friends inside</option>
            <option value="name">Alphabetical</option>
          </select>
        </label>
      </div>

      <div className="groups-sidebar-toggles">
        <label className="groups-sidebar-toggle">
          <input
            type="checkbox"
            checked={friendsOnly}
            onChange={(event) => setFriendsOnly(event.target.checked)}
          />
          <span className="groups-sidebar-switch" aria-hidden="true">
            <span className="groups-sidebar-switch__thumb" />
          </span>
          <span className="groups-sidebar-toggle__text">Only show groups with friends</span>
        </label>
        <label className="groups-sidebar-toggle">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(event) => setFavoritesOnly(event.target.checked)}
          />
          <span className="groups-sidebar-switch" aria-hidden="true">
            <span className="groups-sidebar-switch__thumb" />
          </span>
          <span className="groups-sidebar-toggle__text">Only show favorite groups</span>
        </label>
      </div>

      <div className="groups-sidebar-actions">
        <button
          className="btn ghost"
          type="button"
          onClick={clearDiscoverFilters}
          disabled={!activeFilters}
        >
          Clear filters
        </button>
      </div>
    </section>
  );

  const renderSidebarContent = () => (
    <div className="groups-sidebar groups-sidebar--desktop-hidden">
      {renderDiscoverPanel("groups-sidebar")}
    </div>
  );

  const renderRightSidebarContent = () => (
    <div className="groups-sidebar">
      {renderDiscoverPanel("groups-right")}
    </div>
  );

  const renderGroupCard = (group: GroupSummary) => {
    const groupKey = getGroupKey(group);
    const isFavorite = favoriteGroupSet.has(groupKey);
    const isPending = Boolean(pendingJoinRequests[groupKey]);
    const isMember = Boolean(group.role || group.isMember);
    const friendCount = Number(group.friendMemberCount ?? 0);
    const memberCount = Number(group.memberCount ?? 0);

    return (
      <article key={groupKey} className="group-card" style={buildGroupStyle(group)}>
        <div className="group-card__overlay" />
        <button
          className={`group-card__favorite${isFavorite ? " is-active" : ""}`}
          type="button"
          onClick={() => handleToggleFavorite(group)}
          aria-label={isFavorite ? "Remove favorite group" : "Favorite this group"}
          title={isFavorite ? "Remove favorite" : "Favorite this group"}
        >
          <Star size={16} fill={isFavorite ? "currentColor" : "none"} />
        </button>
        <div className="group-card__content">
          <div className="group-card__tags">
            <span className="pill">{group.visibility}</span>
            {group.role && <span className="pill subtle">{group.role}</span>}
            {!isMember && isPending && <span className="pill subtle">pending</span>}
            {friendCount > 0 && (
              <span className="pill subtle">
                {friendCount} friend{friendCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <h4>{group.name}</h4>
          <p>{group.description || "Fresh energy, open momentum."}</p>
          <div className="group-card__meta">
            <span>
              <MapPin size={14} />
              {formatGroupLocation(group.location)}
            </span>
            <span>
              <Users size={14} />
              {memberCount} member{memberCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="group-card__actions">
          <button
            className="btn ghost"
            type="button"
            onClick={() => navigate(`/groups/${group.documentId ?? group.id}`)}
          >
            {isMember ? "Open group" : "Preview"}
          </button>
          {!isMember && group.visibility === "public" && (
            <button
              className="btn primary"
              type="button"
              onClick={() => handleOpenJoinModal(group)}
              disabled={isPending}
            >
              {isPending ? "Pending" : "Join"}
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="dashboard-shell" style={pageBackground}>
      <Sidebar
        active="groups"
        hideBio
        sidebarContent={renderSidebarContent()}
      />
      <RightSidebarShell
        ariaLabel="Group discover sidebar"
        headTitle="Discover"
        headSubtitle={`${filteredBrowseGroups.length} results`}
        headIcon={<Search size={18} />}
        headTooltip="Group discover"
        onHeadClick={handleRightDiscoverHeadClick}
        className="right-search-sidebar"
      >
        {renderRightSidebarContent()}
      </RightSidebarShell>

      <div className="main-content group-shell">
        <div className="topbar-greeting">
          <span className="topbar-greeting-title">Groups</span>
          <span className="topbar-greeting-sub">
            Build a space, favorite the ones that matter, and discover where your people
            already are.
          </span>
        </div>
        {error && <p className="status status-error">{error}</p>}
        {loading && <p className="status">Loading groups...</p>}

        <div className="panel-grid">
          <section className="panel group-create-panel">
            <div className="panel-header">
              <p className="eyebrow">New group</p>
              <h3>Launch a space</h3>
              <p className="panel-sub">
                Pick a name, add a location, keep it public or private, and drop in a
                background vibe.
              </p>
              <div className="group-create-actions">
                {!showCreateForm && (
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => setShowCreateForm(true)}
                  >
                    Create a group
                  </button>
                )}
                {showCreateForm && (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                  >
                    Hide options
                  </button>
                )}
              </div>
            </div>
            {!showCreateForm ? (
              <div className="group-create-collapsed">
                <p className="status">
                  Click “Create a group” to choose your name, location, privacy, and vibe.
                </p>
              </div>
            ) : (
              <div className="form-grid group-form">
                <input
                  className="auth-input"
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group name"
                />
                <textarea
                  className="auth-input"
                  rows={3}
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Short description (optional)"
                />
                <input
                  className="auth-input"
                  type="text"
                  value={groupLocation}
                  onChange={(e) => setGroupLocation(e.target.value)}
                  placeholder="Location, region, or online"
                />
                <div className="group-toggle-row">
                  <label className="group-toggle">
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === "public"}
                      onChange={() => setVisibility("public")}
                    />
                    <span>Public</span>
                  </label>
                  <label className="group-toggle">
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === "private"}
                      onChange={() => setVisibility("private")}
                    />
                    <span>Private</span>
                  </label>
                </div>
                <div className="group-toggle-row">
                  <label className="group-toggle">
                    <input
                      type="checkbox"
                      checked={useGradient}
                      onChange={() => setUseGradient((prev) => !prev)}
                    />
                    <span>Use gradient</span>
                  </label>
                  <label className="group-toggle">
                    <input
                      type="checkbox"
                      checked={useImage}
                      onChange={() => setUseImage((prev) => !prev)}
                    />
                    <span>Use image</span>
                  </label>
                </div>
                {useGradient && (
                  <div className="group-gradient-row">
                    <label>
                      <span>Start</span>
                      <input
                        type="color"
                        value={gradientStart}
                        onChange={(e) => setGradientStart(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>End</span>
                      <input
                        type="color"
                        value={gradientEnd}
                        onChange={(e) => setGradientEnd(e.target.value)}
                      />
                    </label>
                    <label className="group-angle">
                      <span>Angle</span>
                      <input
                        type="range"
                        min={0}
                        max={180}
                        value={gradientAngle}
                        onChange={(e) => setGradientAngle(Number(e.target.value))}
                      />
                    </label>
                  </div>
                )}
                {useImage && (
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      setBackgroundFile(e.target.files?.[0] ? e.target.files[0] : null)
                    }
                  />
                )}
                {createStatus && <div className="status">{createStatus}</div>}
                <div className="group-create-actions group-create-actions--form">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={handleCreateGroup}
                    disabled={creating}
                  >
                    {creating ? "Creating..." : "Create group"}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="panel group-invite-panel">
            <div className="panel-header">
              <p className="eyebrow">Invites</p>
              <h3>Pending invites</h3>
              <p className="panel-sub">Tap to accept and join the vibe.</p>
            </div>
            {invites.length === 0 && <p className="status">No invites yet.</p>}
            <div className="group-invite-list">
              {invites.map((invite) => (
                <div className="group-invite-card" key={invite.id}>
                  <div>
                    <strong>{invite.group.name}</strong>
                    <p className="group-invite-meta">Invited by {invite.inviterName}</p>
                  </div>
                  <div className="group-invite-actions">
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => handleDeclineInvite(invite.id)}
                    >
                      Decline
                    </button>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => handleAcceptInvite(invite.id)}
                    >
                      Join
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {favoriteGroups.length > 0 && (
          <section className="group-section">
            <div className="group-section-header">
              <div>
                <p className="eyebrow">Favorites</p>
                <h3>Starred groups</h3>
                <p className="panel-sub">Quick access to the communities you want on repeat.</p>
              </div>
            </div>
            <div className="group-card-grid">{favoriteGroups.map(renderGroupCard)}</div>
          </section>
        )}

        <section className="group-section group-updates-section">
          <div className="group-section-header">
            <div>
              <p className="eyebrow">Updates</p>
              <h3>Fresh activity</h3>
              <p className="panel-sub">Latest Group Posts</p>
            </div>
          </div>
          <GroupPostsFeed
            posts={updates}
            onPostsChange={setUpdates}
            emptyMessage="No new updates yet."
            collapseCount={0}
            onOpenGroup={(post) => {
              if (!post.groupId && !post.groupDocumentId) return;
              navigate(`/groups/${post.groupDocumentId ?? post.groupId}`);
            }}
          />
        </section>

        <section className="group-section">
          <div className="group-section-header">
            <div>
              <p className="eyebrow">My groups</p>
              <h3>Spaces you manage or follow</h3>
            </div>
          </div>
          <div className="group-card-grid">
            {myGroups.map(renderGroupCard)}
            {myGroups.length === 0 && !loading && (
              <p className="status">You have not joined any groups yet.</p>
            )}
          </div>
        </section>

        <section className="group-section group-browser-section">
          <div className="group-section-header">
            <div>
              <p className="eyebrow">Browse</p>
              <h3>Searchable group directory</h3>
              <p className="panel-sub">{filterSummary}</p>
            </div>
            <span className="group-results-meta">
              {filteredBrowseGroups.length} result{filteredBrowseGroups.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="group-card-grid">
            {filteredBrowseGroups.map(renderGroupCard)}
            {filteredBrowseGroups.length === 0 && !loading && (
              <p className="status">
                No groups match those filters yet. Try widening the location or turning off
                favorites/friends-only filters.
              </p>
            )}
          </div>
        </section>

        <PopupModal
          open={discoverModalOpen}
          title="Find your next group"
          onClose={() => setDiscoverModalOpen(false)}
          className="group-discover-modal"
          bodyClassName="group-discover-modal__body"
        >
          <div className="group-discover-modal__content">
            {renderDiscoverPanel("groups-modal")}
          </div>
        </PopupModal>

        <PopupModal
          open={Boolean(joinModalGroup)}
          title={joinModalGroup ? `Join ${joinModalGroup.name}` : "Join group"}
          onClose={handleCloseJoinModal}
          className="group-join-modal"
          bodyClassName="group-join-modal__body"
        >
          <div className="group-join-modal__lead">
            Your request will be sent to the group admin and moderators for review.
          </div>
          <div className="group-join-modal__card">
            <label className="group-join-modal__label" htmlFor="group-join-reason">
              Why do you want to join this group?
            </label>
            <textarea
              id="group-join-reason"
              className="group-join-modal__textarea"
              rows={6}
              maxLength={600}
              placeholder="Share your reason, goals, or how you plan to contribute."
              value={joinReason}
              onChange={(e) => setJoinReason(e.target.value)}
            />
            <div className="group-join-modal__footer">
              <span>{joinReason.trim().length}/600</span>
              <span>Requests stay pending until reviewed.</span>
            </div>
          </div>
          {joinStatus && <p className="status status-error">{joinStatus}</p>}
          <div className="group-join-modal__actions">
            <button className="btn ghost" type="button" onClick={handleCloseJoinModal}>
              Cancel
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={handleJoinGroup}
              disabled={joinSubmitting}
            >
              {joinSubmitting ? "Sending..." : "Send request"}
            </button>
          </div>
        </PopupModal>
      </div>
    </div>
  );
}
