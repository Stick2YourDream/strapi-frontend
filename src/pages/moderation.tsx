import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Flag,
  LayoutDashboard,
  Search,
  Shield,
  SlidersHorizontal,
  Store,
  Users,
} from "lucide-react";
import api from "../api/strapi";
import PopupModal from "../components/PopupModal";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import "../css/dashboard.css";
import "../css/moderation.css";
import { usePageMeta } from "../hooks/usePageMeta";

type ReportItem = {
  id: number;
  targetType: string;
  targetId: string;
  reason: string;
  details?: string;
  status: "open" | "reviewed" | "dismissed";
  createdAt?: string;
  reporter?: {
    id: number;
    email?: string | null;
    label?: string | null;
  } | null;
  targetLabel?: string | null;
};

type ModerationState = {
  warningCount?: number;
  strikeLevel?: number;
  blockedUntil?: string | null;
  lastWarningAt?: string | null;
};

type ModerationUser = {
  id: number;
  displayName: string;
  username?: string;
  email?: string;
  appRole?: string;
  blocked?: boolean;
  deactivationReason?: string | null;
  ageVerified?: boolean;
  ageVerificationRequiredAt?: string | null;
  ageVerificationDueAt?: string | null;
  profile?: {
    firstName?: string;
    lastName?: string;
    handle?: string;
  } | null;
  moderation?: ModerationState | null;
};

type ReportFilter = "all" | "open" | "reviewed" | "dismissed";
type PageToken =
  | { kind: "page"; value: number }
  | { kind: "ellipsis"; key: string };

const STOREFRONT_DEMO_ENABLED_KEY = "storefront:demoListingsEnabled";
const STOREFRONT_DEMO_COUNT_KEY = "storefront:demoListingsCount";
const STOREFRONT_DASHBOARD_MOCK_ENABLED_KEY = "storefront:sellerDashboardMockEnabled";
const STOREFRONT_DASHBOARD_MOCK_DATA_KEY = "storefront:sellerDashboardMockData";
const STOREFRONT_DEMO_MAX = 20;
type MobileMenuVariant = "panel" | "drawer";
const DEFAULT_STOREFRONT_DEMO_ENABLED = false;
const DEFAULT_SELLER_DASHBOARD_MOCK = {
  listings: [
    {
      id: "mock-listing-1",
      rawId: 1101,
      title: "Vintage film camera kit",
      price: 420,
      category: "Collectibles",
      condition: "Like new",
      location: "Seattle, WA",
      description: "Includes lens, case, and original strap.",
      images: [],
      seller: {
        id: "seller-1",
        userId: 316,
        name: "Jason Adams",
        handle: "jason",
        avatarUrl: "",
        rating: 4.9,
        responseTime: "Typically replies in under 1 hour",
        verifiedLevel: "verified",
        badges: ["Top seller"],
      },
      stock: 3,
      shipping: "Delivery arranged privately",
      shippingEnabled: false,
      shippingCarriers: [],
      shippingInternational: false,
      localPickup: true,
      cashAccepted: true,
      shippingNotes: "",
      noShippingRequired: true,
      isDemo: true,
    },
    {
      id: "mock-listing-2",
      rawId: 1102,
      title: "Minimalist desk setup bundle",
      price: 320,
      category: "Home & Garden",
      condition: "Good",
      location: "Portland, OR",
      description: "Desk mat, lamp, and organizers.",
      images: [],
      seller: {
        id: "seller-1",
        userId: 316,
        name: "Jason Adams",
        handle: "jason",
        avatarUrl: "",
        rating: 4.9,
        responseTime: "Typically replies in under 1 hour",
        verifiedLevel: "verified",
        badges: ["Top seller"],
      },
      stock: 2,
      shipping: "Delivery arranged privately",
      shippingEnabled: false,
      shippingCarriers: [],
      shippingInternational: false,
      localPickup: true,
      cashAccepted: true,
      shippingNotes: "",
      noShippingRequired: true,
      isDemo: true,
    },
  ],
  offers: [
    {
      id: "mock-offer-1",
      listingId: 1101,
      buyerId: 501,
      sellerId: 316,
      buyerName: "Taylor Morgan",
      offeredPrice: 395,
      currency: "USD",
      status: "pending",
      createdAt: new Date().toISOString(),
    },
  ],
  orders: [
    {
      id: 2201,
      listingId: 1102,
      listingTitle: "Minimalist desk setup bundle",
      buyerId: 502,
      buyerName: "Alex Rivera",
      sellerId: 316,
      sellerName: "Jason Adams",
      amount: 320,
      currency: "USD",
      platformFee: 9.6,
      net: 310.4,
      status: "paid",
      createdAt: new Date().toISOString(),
      payoutStatus: "pending",
      shippingStatus: "delivery_arranged",
      paymentProvider: "paypal",
    },
  ],
  messages: [
    {
      id: 3301,
      body: "Is the bundle still available this weekend?",
      createdAt: new Date().toISOString(),
      listingTitle: "Minimalist desk setup bundle",
      senderName: "Alex Rivera",
      recipientName: "Jason Adams",
    },
  ],
  disputes: [
    {
      id: 4401,
      status: "open",
      reason: "Shipping delay",
      createdAt: new Date().toISOString(),
      buyerName: "Taylor Morgan",
      sellerName: "Jason Adams",
      listingTitle: "Vintage film camera kit",
    },
  ],
  verification: {
    sellerIdStatus: "verified",
    sellerPayoutStatus: "verified",
    buyerPaymentStatus: "verified",
    buyerAddressStatus: "verified",
    payoutProvider: "paypal",
    payoutEmail: "seller@paypal.com",
  },
};

const buildSellerDashboardMockEnabledKey = (userId?: number | null) =>
  userId ? `${STOREFRONT_DASHBOARD_MOCK_ENABLED_KEY}:${userId}` : null;

const buildSellerDashboardMockDataKey = (userId?: number | null) =>
  userId ? `${STOREFRONT_DASHBOARD_MOCK_DATA_KEY}:${userId}` : null;

const readStorefrontDemoEnabled = () => {
  if (typeof window === "undefined") return DEFAULT_STOREFRONT_DEMO_ENABLED;
  const raw = window.localStorage.getItem(STOREFRONT_DEMO_ENABLED_KEY);
  if (raw === null) return DEFAULT_STOREFRONT_DEMO_ENABLED;
  return raw === "true";
};

const normalizeMobileMenuVariant = (value: unknown): MobileMenuVariant =>
  value === "panel" ? "panel" : "drawer";

const readStorefrontDemoCount = () => {
  if (typeof window === "undefined") return 0;
  const raw = Number(window.localStorage.getItem(STOREFRONT_DEMO_COUNT_KEY) || 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(STOREFRONT_DEMO_MAX, raw));
};

const readSellerDashboardMockEnabled = (userId?: number | null) => {
  if (typeof window === "undefined") return false;
  const scopedKey = buildSellerDashboardMockEnabledKey(userId);
  if (!scopedKey) return false;
  const raw = window.localStorage.getItem(scopedKey);
  if (raw !== null) return raw === "true";
  const legacy = window.localStorage.getItem(STOREFRONT_DASHBOARD_MOCK_ENABLED_KEY);
  if (legacy !== null) {
    window.localStorage.setItem(scopedKey, legacy);
    window.localStorage.removeItem(STOREFRONT_DASHBOARD_MOCK_ENABLED_KEY);
    return legacy === "true";
  }
  return false;
};

const readSellerDashboardMockData = (userId?: number | null) => {
  if (typeof window === "undefined") return null;
  const scopedKey = buildSellerDashboardMockDataKey(userId);
  if (!scopedKey) return null;
  const raw = window.localStorage.getItem(scopedKey);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const legacy = window.localStorage.getItem(STOREFRONT_DASHBOARD_MOCK_DATA_KEY);
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy);
      window.localStorage.setItem(scopedKey, legacy);
      window.localStorage.removeItem(STOREFRONT_DASHBOARD_MOCK_DATA_KEY);
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
};

const clampStorefrontDemoCount = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(STOREFRONT_DEMO_MAX, value));
};

const persistStorefrontDemoState = (enabled: boolean, count: number) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STOREFRONT_DEMO_ENABLED_KEY, String(enabled));
  window.localStorage.setItem(STOREFRONT_DEMO_COUNT_KEY, String(count));
  window.dispatchEvent(new Event("storefront:demo-updated"));
};

const persistSellerDashboardMockState = (
  userId: number | null | undefined,
  enabled: boolean,
  payload?: unknown
) => {
  if (typeof window === "undefined") return;
  const enabledKey = buildSellerDashboardMockEnabledKey(userId);
  const dataKey = buildSellerDashboardMockDataKey(userId);
  if (!enabledKey || !dataKey) return;
  window.localStorage.setItem(enabledKey, String(enabled));
  if (payload) {
    window.localStorage.setItem(dataKey, JSON.stringify(payload));
  }
  window.localStorage.removeItem(STOREFRONT_DASHBOARD_MOCK_ENABLED_KEY);
  window.localStorage.removeItem(STOREFRONT_DASHBOARD_MOCK_DATA_KEY);
  window.dispatchEvent(new Event("storefront:seller-dashboard-mock-updated"));
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
};

const AGE_LOCK_REASON = "age_verification_required";
const MODERATION_BAN_REASON = "moderation_ban";
const MODERATION_BLOCK_REASON = "moderation_block";

const deactivationReasonLower = (entry?: ModerationUser | null) =>
  String(entry?.deactivationReason || "").toLowerCase();

const isAgeLocked = (entry?: ModerationUser | null) =>
  Boolean(
    entry?.blocked && deactivationReasonLower(entry) === AGE_LOCK_REASON
  );

const isModerationBanned = (entry?: ModerationUser | null) =>
  Boolean(
    Number(entry?.moderation?.strikeLevel || 0) >= 3 ||
      (entry?.blocked && deactivationReasonLower(entry) === MODERATION_BAN_REASON)
  );

const isModerationBlocked = (entry?: ModerationUser | null) => {
  if (!entry || isAgeLocked(entry) || isModerationBanned(entry)) return false;
  return Boolean(
    entry?.moderation?.blockedUntil ||
      (entry?.blocked && deactivationReasonLower(entry) === MODERATION_BLOCK_REASON)
  );
};

const statusLabel = (entry?: ModerationUser | null) => {
  if (isAgeLocked(entry)) return "Locked (Age verification overdue)";
  if (isModerationBanned(entry)) return "Banned";
  const blockedUntil = entry?.moderation?.blockedUntil;
  if (isModerationBlocked(entry)) {
    const formatted = formatDateTime(blockedUntil);
    return formatted ? `Blocked until ${formatted}` : "Blocked";
  }
  return "Active";
};

const userStatusTone = (entry?: ModerationUser | null) => {
  if (isAgeLocked(entry)) return "age";
  if (isModerationBanned(entry)) return "banned";
  if (isModerationBlocked(entry)) return "blocked";
  return "active";
};

const usernameLabel = (entry: ModerationUser) => {
  const username = String(entry.username || "").trim();
  if (username) return username;
  const handle = String(entry.profile?.handle || "").trim().replace(/^@+/, "");
  if (handle) return handle;
  const displayName = String(entry.displayName || "").trim();
  if (displayName) return displayName;
  return `user-${entry.id}`;
};

const buildPageTokens = (current: number, total: number): PageToken[] => {
  if (total <= 0) return [];
  if (total <= 7) {
    return Array.from({ length: total }, (_, idx) => ({
      kind: "page" as const,
      value: idx + 1,
    }));
  }

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);

  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
  }

  const sortedPages = Array.from(pages)
    .filter((value) => value >= 1 && value <= total)
    .sort((a, b) => a - b);

  const tokens: PageToken[] = [];
  let previous: number | null = null;

  for (const value of sortedPages) {
    if (previous !== null && value - previous > 1) {
      if (value - previous === 2) {
        tokens.push({ kind: "page", value: previous + 1 });
      } else {
        tokens.push({ kind: "ellipsis", key: `gap-${previous}-${value}` });
      }
    }
    tokens.push({ kind: "page", value });
    previous = value;
  }

  return tokens;
};

export default function Moderation() {
  const { user, refreshAppSettings } = useAuth();
  const isStaff = user?.appRole === "admin" || user?.appRole === "moderator";
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [reportFilter, setReportFilter] = useState<ReportFilter>("open");
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportUpdating, setReportUpdating] = useState<Record<number, boolean>>({});

  const [userQuery, setUserQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [userResults, setUserResults] = useState<ModerationUser[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [userAction, setUserAction] = useState<Record<number, boolean>>({});
  const [userActionNotice, setUserActionNotice] = useState<Record<number, string>>({});
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [selectedUser, setSelectedUser] = useState<ModerationUser | null>(null);
  const pageSize = 5;
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [storefrontDemoEnabled, setStorefrontDemoEnabled] = useState(
    readStorefrontDemoEnabled
  );
  const [storefrontDemoCount, setStorefrontDemoCount] = useState(
    readStorefrontDemoCount
  );
  const [storefrontDemoStatus, setStorefrontDemoStatus] = useState<string | null>(null);
  const [sellerDashboardMockEnabled, setSellerDashboardMockEnabled] = useState(() =>
    readSellerDashboardMockEnabled(user?.id ?? null)
  );
  const [sellerDashboardMockPayload, setSellerDashboardMockPayload] = useState(() =>
    JSON.stringify(
      readSellerDashboardMockData(user?.id ?? null) || DEFAULT_SELLER_DASHBOARD_MOCK,
      null,
      2
    )
  );
  const [sellerDashboardMockStatus, setSellerDashboardMockStatus] = useState<string | null>(
    null
  );
  const [newsroomEnabled, setNewsroomEnabled] = useState(true);
  const [storefrontEnabled, setStorefrontEnabled] = useState(true);
  const [mobileMenuVariant, setMobileMenuVariant] = useState<MobileMenuVariant>("drawer");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  usePageMeta({
    title: "Moderation | Your Social Place",
    description: "Review reports and manage account restrictions.",
    type: "website",
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    if (!isStaff) return;
    let active = true;
    const loadReports = async () => {
      setReportsLoading(true);
      setReportError(null);
      try {
        const res = await api.get("/moderation/reports");
        if (!active) return;
        setReports(res.data?.data ?? []);
      } catch (err) {
        if (!active) return;
        setReportError("Unable to load reports.");
      } finally {
        if (active) setReportsLoading(false);
      }
    };
    void loadReports();
    return () => {
      active = false;
    };
  }, [isStaff]);

  useEffect(() => {
    setSellerDashboardMockEnabled(readSellerDashboardMockEnabled(user?.id ?? null));
    setSellerDashboardMockPayload(
      JSON.stringify(
        readSellerDashboardMockData(user?.id ?? null) || DEFAULT_SELLER_DASHBOARD_MOCK,
        null,
        2
      )
    );
  }, [user?.id]);

  useEffect(() => {
    if (!isStaff) return;
    let active = true;

    const loadUsers = async () => {
      setUserLoading(true);
      setUserError(null);
      try {
        const res = await api.get("/moderation/users", {
          params: {
            query: activeQuery || undefined,
            page,
            pageSize,
          },
        });
        if (!active) return;
        setUserResults(res.data?.data ?? []);
        const pagination = res.data?.meta?.pagination;
        const total = Number(pagination?.total || 0);
        const count = Number(pagination?.pageCount || 0);
        setTotalUsers(Number.isFinite(total) ? total : 0);
        setPageCount(Number.isFinite(count) ? count : 0);
        if (count > 0 && page > count) {
          setPage(count);
        }
      } catch {
        if (!active) return;
        setUserError("Unable to load users.");
        setUserResults([]);
        setTotalUsers(0);
        setPageCount(0);
      } finally {
        if (active) setUserLoading(false);
      }
    };

    void loadUsers();
    return () => {
      active = false;
    };
  }, [activeQuery, isStaff, page, pageSize]);

  useEffect(() => {
    if (!isStaff) return;
    let active = true;
    const loadSettings = async () => {
      setSettingsLoading(true);
      setSettingsError(null);
      try {
        const res = await api.get("/moderation/settings");
        if (!active) return;
        const data = res.data?.data;
        setNewsroomEnabled(data?.newsroomEnabled !== false);
        setStorefrontEnabled(data?.storefrontEnabled !== false);
        setMobileMenuVariant(normalizeMobileMenuVariant(data?.mobileMenuVariant));
      } catch {
        if (active) {
          setSettingsError("Unable to load moderation settings.");
        }
      } finally {
        if (active) setSettingsLoading(false);
      }
    };
    void loadSettings();
    return () => {
      active = false;
    };
  }, [isStaff]);

  if (!isStaff) {
    return <Navigate to="/dashboard" replace />;
  }

  const filteredReports = useMemo(() => {
    if (reportFilter === "all") return reports;
    return reports.filter((report) => report.status === reportFilter);
  }, [reportFilter, reports]);

  const userPageTokens = useMemo(() => buildPageTokens(page, pageCount), [page, pageCount]);
  const reportCounts = useMemo(
    () => ({
      total: reports.length,
      open: reports.filter((report) => report.status === "open").length,
      reviewed: reports.filter((report) => report.status === "reviewed").length,
      dismissed: reports.filter((report) => report.status === "dismissed").length,
    }),
    [reports]
  );
  const visibleUserStatusCounts = useMemo(
    () => ({
      active: userResults.filter(
        (entry) =>
          !isAgeLocked(entry) && !isModerationBanned(entry) && !isModerationBlocked(entry)
      ).length,
      blocked: userResults.filter((entry) => isModerationBlocked(entry)).length,
      banned: userResults.filter((entry) => isModerationBanned(entry)).length,
      ageLocked: userResults.filter((entry) => isAgeLocked(entry)).length,
    }),
    [userResults]
  );
  const activePlatformSurfaceCount = [storefrontEnabled, newsroomEnabled].filter(Boolean).length;
  const activeSandboxSurfaceCount = [
    storefrontDemoEnabled,
    sellerDashboardMockEnabled,
  ].filter(Boolean).length;
  const reportFilterLabel =
    reportFilter === "all"
      ? "All reports"
      : `${reportFilter.charAt(0).toUpperCase()}${reportFilter.slice(1)} only`;

  const updateReportStatus = async (reportId: number, status: ReportItem["status"]) => {
    if (reportUpdating[reportId]) return;
    setReportUpdating((prev) => ({ ...prev, [reportId]: true }));
    try {
      await api.put(`/moderation/reports/${reportId}`, { status });
      setReports((prev) =>
        prev.map((report) =>
          report.id === reportId ? { ...report, status } : report
        )
      );
    } catch {
      setReportError("Unable to update report.");
    } finally {
      setReportUpdating((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
    }
  };

  const handleUserSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = userQuery.trim();
    setActiveQuery(query);
    setPage(1);
  };

  const handleRestrictUser = async (targetId: number, action: string) => {
    if (userAction[targetId]) return;
    setUserAction((prev) => ({ ...prev, [targetId]: true }));
    setUserError(null);
    try {
      const res = await api.post(`/moderation/users/${targetId}/restrict`, { action });
      const updated = res.data?.data;
      const nextModeration = {
        warningCount: updated.warningCount,
        strikeLevel: updated.strikeLevel,
        blockedUntil: updated.blockedUntil,
        lastWarningAt: updated.lastWarningAt,
      };
      setUserResults((prev) =>
        prev.map((entry) =>
          entry.id === targetId
            ? {
                ...entry,
                moderation: nextModeration,
                blocked:
                  typeof updated?.blocked === "boolean" ? updated.blocked : entry.blocked,
                deactivationReason:
                  updated?.deactivationReason !== undefined
                    ? updated.deactivationReason
                    : entry.deactivationReason,
                ageVerified:
                  typeof updated?.ageVerified === "boolean"
                    ? updated.ageVerified
                    : entry.ageVerified,
                ageVerificationRequiredAt:
                  updated?.ageVerificationRequiredAt ?? entry.ageVerificationRequiredAt ?? null,
                ageVerificationDueAt:
                  updated?.ageVerificationDueAt ?? entry.ageVerificationDueAt ?? null,
              }
            : entry
        )
      );
      setSelectedUser((prev) =>
        prev && prev.id === targetId
          ? {
              ...prev,
              moderation: nextModeration,
              blocked:
                typeof updated?.blocked === "boolean" ? updated.blocked : prev.blocked,
              deactivationReason:
                updated?.deactivationReason !== undefined
                  ? updated.deactivationReason
                  : prev.deactivationReason,
              ageVerified:
                typeof updated?.ageVerified === "boolean"
                  ? updated.ageVerified
                  : prev.ageVerified,
              ageVerificationRequiredAt:
                updated?.ageVerificationRequiredAt ?? prev.ageVerificationRequiredAt ?? null,
              ageVerificationDueAt:
                updated?.ageVerificationDueAt ?? prev.ageVerificationDueAt ?? null,
            }
          : prev
      );
      const status = String(updated?.status || "").toLowerCase();
      const notice =
        status === "age-unlocked"
          ? `Age lock removed. User has another ${
              Number(updated?.ageVerificationGraceDays || 30) || 30
            } days to verify.`
          : status === "banned"
          ? "User has been banned."
          : status === "blocked"
          ? `User has been blocked${updated?.blockedUntil ? ` until ${formatDateTime(updated.blockedUntil)}.` : "."}`
          : "User is now active.";
      setUserActionNotice((prev) => ({ ...prev, [targetId]: notice }));
      window.setTimeout(() => {
        setUserActionNotice((prev) => {
          if (!prev[targetId]) return prev;
          const next = { ...prev };
          delete next[targetId];
          return next;
        });
      }, 3200);
    } catch {
      setUserError("Unable to update restriction.");
    } finally {
      setUserAction((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    }
  };

  const handleSeedDemoUsers = async () => {
    if (demoBusy) return;
    setDemoBusy(true);
    setDemoStatus(null);
    try {
      const res = await api.post("/moderation/demo-users/seed");
      const data = res.data?.data;
      const createdUsers = Number(data?.createdUsers || 0);
      const createdPosts = Number(data?.createdPosts || 0);
      const createdComments = Number(data?.createdComments || 0);
      const createdMessages = Number(data?.createdMessages || 0);
      const createdMedia = Number(data?.createdMedia || 0);
      const createdFriendships = Number(data?.createdFriendships || 0);
      const password = data?.password ? ` Default password: ${data.password}` : "";
      setDemoStatus(
        `Seeded ${createdUsers} users, ${createdPosts} posts, ${createdComments} comments, ${createdMessages} messages, ${createdMedia} media, ${createdFriendships} friends.${password}`
      );
    } catch (err) {
      if (err && typeof err === "object" && "response" in err) {
        const anyErr = err as any;
        const message =
          anyErr.response?.data?.error?.message ||
          anyErr.response?.data?.message ||
          "Unable to seed demo users.";
        setDemoStatus(String(message));
      } else {
        setDemoStatus("Unable to seed demo users.");
      }
    } finally {
      setDemoBusy(false);
    }
  };

  const handleSyncDemoUsers = async () => {
    if (demoBusy) return;
    setDemoBusy(true);
    setDemoStatus(null);
    try {
      const res = await api.post("/moderation/demo-users/sync");
      const data = res.data?.data;
      const createdPosts = Number(data?.createdPosts || 0);
      const createdComments = Number(data?.createdComments || 0);
      const createdMessages = Number(data?.createdMessages || 0);
      const createdMedia = Number(data?.createdMedia || 0);
      const createdFriendships = Number(data?.createdFriendships || 0);
      const demoUserCount = Number(data?.demoUserCount || 0);
      setDemoStatus(
        `Synced ${demoUserCount} demo users: ${createdPosts} posts, ${createdComments} comments, ${createdMessages} messages, ${createdMedia} media, ${createdFriendships} friends.`
      );
    } catch (err) {
      if (err && typeof err === "object" && "response" in err) {
        const anyErr = err as any;
        const message =
          anyErr.response?.data?.error?.message ||
          anyErr.response?.data?.message ||
          "Unable to sync demo users.";
        setDemoStatus(String(message));
      } else {
        setDemoStatus("Unable to sync demo users.");
      }
    } finally {
      setDemoBusy(false);
    }
  };

  const handleDeleteDemoUsers = async () => {
    if (demoBusy) return;
    const confirmed = window.confirm(
      "Delete all demo users and their content? This cannot be undone."
    );
    if (!confirmed) return;
    setDemoBusy(true);
    setDemoStatus(null);
    try {
      const res = await api.delete("/moderation/demo-users");
      const data = res.data?.data;
      const deletedUsers = Number(data?.deletedUsers || 0);
      setDemoStatus(`Deleted ${deletedUsers} demo users and related data.`);
    } catch (err) {
      if (err && typeof err === "object" && "response" in err) {
        const anyErr = err as any;
        const message =
          anyErr.response?.data?.error?.message ||
          anyErr.response?.data?.message ||
          "Unable to delete demo users.";
        setDemoStatus(String(message));
      } else {
        setDemoStatus("Unable to delete demo users.");
      }
    } finally {
      setDemoBusy(false);
    }
  };

  const handleStorefrontDemoToggle = (nextValue: boolean) => {
    setStorefrontDemoEnabled(nextValue);
    persistStorefrontDemoState(nextValue, storefrontDemoCount);
    setStorefrontDemoStatus(
      nextValue ? "StoreFront mock listings enabled." : "StoreFront mock listings disabled."
    );
  };

  const handleAddStorefrontDemoListings = () => {
    const nextCount = clampStorefrontDemoCount(storefrontDemoCount + 20);
    setStorefrontDemoEnabled(true);
    setStorefrontDemoCount(nextCount);
    persistStorefrontDemoState(true, nextCount);
    setStorefrontDemoStatus(`StoreFront demo listings set to ${nextCount}.`);
  };

  const handleClearStorefrontDemoListings = () => {
    setStorefrontDemoEnabled(false);
    setStorefrontDemoCount(0);
    persistStorefrontDemoState(false, 0);
    setStorefrontDemoStatus("StoreFront demo listings cleared.");
  };

  const handleToggleSellerDashboardMock = (nextValue: boolean) => {
    setSellerDashboardMockEnabled(nextValue);
    let payload: unknown = null;
    try {
      payload = JSON.parse(sellerDashboardMockPayload);
    } catch {
      payload = DEFAULT_SELLER_DASHBOARD_MOCK;
      setSellerDashboardMockPayload(JSON.stringify(DEFAULT_SELLER_DASHBOARD_MOCK, null, 2));
    }
    persistSellerDashboardMockState(user?.id ?? null, nextValue, payload);
    setSellerDashboardMockStatus(
      nextValue
        ? "Seller dashboard mock data enabled."
        : "Seller dashboard mock data disabled."
    );
  };

  const handleApplySellerDashboardMock = () => {
    try {
      const payload = JSON.parse(sellerDashboardMockPayload);
      persistSellerDashboardMockState(user?.id ?? null, sellerDashboardMockEnabled, payload);
      setSellerDashboardMockStatus("Seller dashboard mock data saved.");
    } catch {
      setSellerDashboardMockStatus("Invalid JSON. Please fix and try again.");
    }
  };

  const handleResetSellerDashboardMock = () => {
    const nextPayload = JSON.stringify(DEFAULT_SELLER_DASHBOARD_MOCK, null, 2);
    setSellerDashboardMockPayload(nextPayload);
    persistSellerDashboardMockState(
      user?.id ?? null,
      sellerDashboardMockEnabled,
      DEFAULT_SELLER_DASHBOARD_MOCK
    );
    setSellerDashboardMockStatus("Seller dashboard mock data reset to sample.");
  };

  const handleClearSellerDashboardMock = () => {
    setSellerDashboardMockEnabled(false);
    const enabledKey = buildSellerDashboardMockEnabledKey(user?.id ?? null);
    const dataKey = buildSellerDashboardMockDataKey(user?.id ?? null);
    if (enabledKey) {
      window.localStorage.removeItem(enabledKey);
    }
    if (dataKey) {
      window.localStorage.removeItem(dataKey);
    }
    window.localStorage.removeItem(STOREFRONT_DASHBOARD_MOCK_DATA_KEY);
    window.localStorage.removeItem(STOREFRONT_DASHBOARD_MOCK_ENABLED_KEY);
    window.dispatchEvent(new Event("storefront:seller-dashboard-mock-updated"));
    setSellerDashboardMockStatus("Seller dashboard mock data cleared.");
  };

  const applyPlatformSettings = async (next: {
    storefrontEnabled?: boolean;
    newsroomEnabled?: boolean;
    mobileMenuVariant?: MobileMenuVariant;
  }) => {
    if (settingsSaving) return;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const res = await api.put("/moderation/settings", next);
      const data = res.data?.data;
      if (typeof data?.storefrontEnabled === "boolean") {
        setStorefrontEnabled(data.storefrontEnabled);
      } else if (next.storefrontEnabled !== undefined) {
        setStorefrontEnabled(next.storefrontEnabled);
      }
      if (typeof data?.newsroomEnabled === "boolean") {
        setNewsroomEnabled(data.newsroomEnabled);
      } else if (next.newsroomEnabled !== undefined) {
        setNewsroomEnabled(next.newsroomEnabled);
      }
      if (data?.mobileMenuVariant === "panel" || data?.mobileMenuVariant === "drawer") {
        setMobileMenuVariant(data.mobileMenuVariant);
      } else if (next.mobileMenuVariant !== undefined) {
        setMobileMenuVariant(next.mobileMenuVariant);
      }
      await refreshAppSettings();
    } catch {
      setSettingsError("Unable to update moderation settings.");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleToggleNewsroom = async (nextValue: boolean) => {
    await applyPlatformSettings({
      newsroomEnabled: nextValue,
      storefrontEnabled,
    });
  };

  const handleToggleStorefront = async (nextValue: boolean) => {
    await applyPlatformSettings({
      storefrontEnabled: nextValue,
      newsroomEnabled,
    });
  };

  const handleMobileMenuVariantToggle = async (useDrawer: boolean) => {
    const nextVariant: MobileMenuVariant = useDrawer ? "drawer" : "panel";
    await applyPlatformSettings({
      mobileMenuVariant: nextVariant,
      storefrontEnabled,
      newsroomEnabled,
    });
  };

  return (
    <div className="dashboard-shell">
      <Sidebar active="moderation" mobileMenuVariant={mobileMenuVariant} />
      <div className="main-content moderation-content">
        <section className="panel moderation-hero">
          <div className="moderation-hero-head">
            <div className="moderation-hero-copy">
              <p className="eyebrow">Moderation</p>
              <h2 className="moderation-title">Safety command center</h2>
              <p className="panel-sub moderation-hero-sub">
                Review live reports, manage user risk states, and control platform access from one
                responsive operations workspace.
              </p>
            </div>
            <div className="moderation-hero-badges">
              <span className={`moderation-hero-chip ${storefrontEnabled ? "is-live" : "is-muted"}`}>
                <Store size={14} />
                StoreFront {storefrontEnabled ? "Live" : "Paused"}
              </span>
              <span className={`moderation-hero-chip ${newsroomEnabled ? "is-live" : "is-muted"}`}>
                <CheckCircle2 size={14} />
                Newsroom {newsroomEnabled ? "Live" : "Paused"}
              </span>
              <span className="moderation-hero-chip is-neutral">
                <SlidersHorizontal size={14} />
                Mobile {mobileMenuVariant === "drawer" ? "Drawer" : "Panel"}
              </span>
              <span
                className={`moderation-hero-chip ${
                  activeSandboxSurfaceCount ? "is-warn" : "is-neutral"
                }`}
              >
                <Database size={14} />
                Sandbox {activeSandboxSurfaceCount ? `${activeSandboxSurfaceCount} active` : "Idle"}
              </span>
            </div>
          </div>
          <div className="moderation-hero-stats">
            <article className="moderation-stat-card moderation-stat-card--reports">
              <div className="moderation-stat-top">
                <span className="moderation-stat-icon" aria-hidden="true">
                  <AlertTriangle size={18} />
                </span>
                <span className="moderation-stat-label">Open reports</span>
              </div>
              <strong>{reportCounts.open}</strong>
              <p>{reportCounts.total ? "Awaiting moderator review" : "No active report load"}</p>
            </article>
            <article className="moderation-stat-card moderation-stat-card--queue">
              <div className="moderation-stat-top">
                <span className="moderation-stat-icon" aria-hidden="true">
                  <Flag size={18} />
                </span>
                <span className="moderation-stat-label">Current queue</span>
              </div>
              <strong>{filteredReports.length}</strong>
              <p>{reportFilterLabel}</p>
            </article>
            <article className="moderation-stat-card moderation-stat-card--users">
              <div className="moderation-stat-top">
                <span className="moderation-stat-icon" aria-hidden="true">
                  <Users size={18} />
                </span>
                <span className="moderation-stat-label">At-risk users</span>
              </div>
              <strong>
                {visibleUserStatusCounts.blocked +
                  visibleUserStatusCounts.banned +
                  visibleUserStatusCounts.ageLocked}
              </strong>
              <p>{activeQuery ? `Matching "${activeQuery}"` : "Across the current page of results"}</p>
            </article>
            <article className="moderation-stat-card moderation-stat-card--platform">
              <div className="moderation-stat-top">
                <span className="moderation-stat-icon" aria-hidden="true">
                  <Shield size={18} />
                </span>
                <span className="moderation-stat-label">Platform surfaces</span>
              </div>
              <strong>{activePlatformSurfaceCount}/2</strong>
              <p>{settingsSaving ? "Saving environment state" : "Live access controls ready"}</p>
            </article>
          </div>
        </section>

        <div className="panel-grid moderation-grid">
          <div className="moderation-grid-column moderation-grid-column--main">
            <section className="panel moderation-panel moderation-panel--reports">
            <div className="moderation-panel-header">
              <div className="moderation-panel-heading">
                <span className="moderation-section-kicker">
                  <Flag size={14} />
                  Community inbox
                </span>
                <h3 className="moderation-panel-title">Reports</h3>
                <p className="panel-sub">All reports submitted by community members.</p>
              </div>
              <label className="moderation-select-wrap">
                <span>View</span>
                <select
                  className="auth-input moderation-filter"
                  value={reportFilter}
                  onChange={(event) => setReportFilter(event.target.value as ReportFilter)}
                >
                  <option value="open">Open</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="dismissed">Dismissed</option>
                  <option value="all">All</option>
                </select>
              </label>
            </div>

            <div className="moderation-mini-grid">
              <article className="moderation-mini-card">
                <span>Open</span>
                <strong>{reportCounts.open}</strong>
              </article>
              <article className="moderation-mini-card">
                <span>Reviewed</span>
                <strong>{reportCounts.reviewed}</strong>
              </article>
              <article className="moderation-mini-card">
                <span>Dismissed</span>
                <strong>{reportCounts.dismissed}</strong>
              </article>
              <article className="moderation-mini-card">
                <span>Showing</span>
                <strong>{filteredReports.length}</strong>
              </article>
            </div>

            {reportsLoading && <div className="status">Loading reports...</div>}
            {reportError && <div className="status status-error">{reportError}</div>}
            {!reportsLoading && filteredReports.length === 0 && (
              <div className="status">No reports in this view.</div>
            )}
            <div className="moderation-report-list">
              {filteredReports.map((report) => (
                <article key={report.id} className="moderation-report-card">
                  <div className="moderation-report-header">
                    <div className="moderation-report-heading">
                      <div className="moderation-report-topline">
                        <span className="moderation-surface-chip moderation-surface-chip--soft">
                          {report.targetType}
                        </span>
                        <span className="moderation-report-meta">Target #{report.targetId}</span>
                      </div>
                      <strong className="moderation-report-title">
                        {report.reason}
                      </strong>
                      <div className="moderation-report-meta">
                        Target: {report.targetType} {report.targetId}
                        {report.targetLabel ? ` (${report.targetLabel})` : ""}
                      </div>
                    </div>
                    <span
                      className={`moderation-report-status status-${report.status}`}
                    >
                      {report.status}
                    </span>
                  </div>
                  <div className="moderation-report-snapshot">
                    <div className="moderation-report-snapshot-item">
                      <span className="moderation-detail-label">Reporter</span>
                      <strong>{report.reporter?.label || "Unknown"}</strong>
                      <span>{report.reporter?.email || "No email shared"}</span>
                    </div>
                    <div className="moderation-report-snapshot-item">
                      <span className="moderation-detail-label">Filed</span>
                      <strong>{formatDateTime(report.createdAt) || "-"}</strong>
                      <span>Report #{report.id}</span>
                    </div>
                  </div>
                  {report.details && <p className="moderation-report-details">{report.details}</p>}
                  <div className="moderation-report-footer">
                    <span className="moderation-report-meta">
                      {report.status === "open"
                        ? "Use the actions below to resolve this report."
                        : "You can reopen this report at any time."}
                    </span>
                    <div className="moderation-action-row">
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={reportUpdating[report.id]}
                        onClick={() => updateReportStatus(report.id, "reviewed")}
                      >
                        Mark reviewed
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={reportUpdating[report.id]}
                        onClick={() => updateReportStatus(report.id, "dismissed")}
                      >
                        Dismiss
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={reportUpdating[report.id]}
                        onClick={() => updateReportStatus(report.id, "open")}
                      >
                        Reopen
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            </section>

            <section className="panel moderation-panel moderation-panel--users">
            <div className="moderation-panel-header">
              <div className="moderation-panel-heading">
                <span className="moderation-section-kicker">
                  <Users size={14} />
                  Account actions
                </span>
                <h3 className="moderation-panel-title">User restrictions</h3>
                <p className="panel-sub">
                  Search by name, handle, email, or user ID.
                </p>
              </div>
            </div>

            <form className="moderation-search" onSubmit={handleUserSearch}>
              <label className="moderation-search-input">
                <Search size={16} aria-hidden="true" />
                <input
                  className="auth-input"
                  placeholder="Search users..."
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                />
              </label>
              <button className="btn primary" type="submit" disabled={userLoading}>
                {userLoading ? "Searching..." : "Search"}
              </button>
            </form>

            <div className="moderation-mini-grid moderation-mini-grid--users">
              <article className="moderation-mini-card">
                <span>Active</span>
                <strong>{visibleUserStatusCounts.active}</strong>
              </article>
              <article className="moderation-mini-card">
                <span>Blocked</span>
                <strong>{visibleUserStatusCounts.blocked}</strong>
              </article>
              <article className="moderation-mini-card">
                <span>Banned</span>
                <strong>{visibleUserStatusCounts.banned}</strong>
              </article>
              <article className="moderation-mini-card">
                <span>Age locked</span>
                <strong>{visibleUserStatusCounts.ageLocked}</strong>
              </article>
            </div>

            {userLoading && <div className="status">Loading users...</div>}
            {userError && <div className="status status-error">{userError}</div>}
            {!userLoading && userResults.length === 0 && activeQuery && (
              <div className="status">No users found.</div>
            )}
            {!userLoading && userResults.length === 0 && !activeQuery && (
              <div className="status">No users yet.</div>
            )}
            <div className="moderation-user-pagination">
              <span className="moderation-report-meta">
                {totalUsers
                  ? `Showing ${(page - 1) * pageSize + 1}-${Math.min(
                      page * pageSize,
                      totalUsers
                    )} of ${totalUsers}`
                  : "Showing 0 users"}
              </span>
              <div className="moderation-user-pagination-controls">
                <button
                  className="btn ghost moderation-page-nav"
                  type="button"
                  disabled={page <= 1 || userLoading}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </button>
                <div className="moderation-page-list" aria-label="User pages">
                  {userPageTokens.map((token) =>
                    token.kind === "ellipsis" ? (
                      <span
                        key={token.key}
                        className="moderation-page-ellipsis"
                        aria-hidden="true"
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={`page-${token.value}`}
                        className={`moderation-page-btn${
                          token.value === page ? " is-active" : ""
                        }`}
                        type="button"
                        disabled={userLoading}
                        onClick={() => setPage(token.value)}
                        aria-current={token.value === page ? "page" : undefined}
                      >
                        {token.value}
                      </button>
                    )
                  )}
                </div>
                <button
                  className="btn ghost moderation-page-nav"
                  type="button"
                  disabled={pageCount === 0 || page >= pageCount || userLoading}
                  onClick={() => setPage((prev) => Math.min(pageCount || 1, prev + 1))}
                >
                  Next
                </button>
              </div>
            </div>
            <div className="moderation-user-list">
              {userResults.map((entry) => (
                <article key={entry.id} className="moderation-user-card">
                  <div className="moderation-user-card-head">
                    <div className="moderation-user-identity">
                      <div className="moderation-user-identity-top">
                        <button
                          type="button"
                          className="moderation-user-trigger"
                          onClick={() => setSelectedUser(entry)}
                        >
                          {usernameLabel(entry)}
                        </button>
                        <span
                          className={`moderation-user-status moderation-user-status--${userStatusTone(
                            entry
                          )}`}
                        >
                          {statusLabel(entry)}
                        </span>
                      </div>
                      <div className="moderation-user-meta-line">
                        <span>{entry.displayName || "No display name"}</span>
                        {entry.profile?.handle && (
                          <span>@{String(entry.profile.handle).replace(/^@+/, "")}</span>
                        )}
                        {entry.email && <span>{entry.email}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="moderation-user-facts">
                    <span className="moderation-surface-chip">Role {entry.appRole || "user"}</span>
                    <span className="moderation-surface-chip">
                      Warnings {Number(entry.moderation?.warningCount || 0)}
                    </span>
                    <span className="moderation-surface-chip">
                      Strikes {Number(entry.moderation?.strikeLevel || 0)}
                    </span>
                    {entry.ageVerificationDueAt && (
                      <span className="moderation-surface-chip">
                        Age due {formatDateTime(entry.ageVerificationDueAt)}
                      </span>
                    )}
                  </div>
                  <div className="moderation-action-row">
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id] || isModerationBanned(entry)}
                      onClick={() => handleRestrictUser(entry.id, "block-7")}
                    >
                      Block 7 days
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id] || isModerationBanned(entry)}
                      onClick={() => handleRestrictUser(entry.id, "block-30")}
                    >
                      Block 30 days
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => {
                        const isBanned = isModerationBanned(entry);
                        const isBlocked = isModerationBlocked(entry);
                        const nextAction = isBanned ? "unban" : isBlocked ? "unblock" : "ban";
                        handleRestrictUser(entry.id, nextAction);
                      }}
                    >
                      {isModerationBanned(entry)
                        ? "Unban"
                        : isModerationBlocked(entry)
                        ? "Unblock"
                        : "Ban"}
                    </button>
                    {isAgeLocked(entry) && (
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={userAction[entry.id]}
                        onClick={() => handleRestrictUser(entry.id, "age-unlock")}
                      >
                        Unlock age lock
                      </button>
                    )}
                  </div>
                  {userActionNotice[entry.id] && (
                    <div className="moderation-user-action-notice">
                      {userActionNotice[entry.id]}
                    </div>
                  )}
                </article>
              ))}
            </div>
            </section>
          </div>

          <div className="moderation-grid-column moderation-grid-column--side">
            <section className="panel moderation-panel moderation-panel--utility moderation-demo-panel">
            <div className="moderation-panel-header">
              <div className="moderation-panel-heading">
                <span className="moderation-section-kicker">
                  <Database size={14} />
                  Sandbox tools
                </span>
                <h3 className="moderation-panel-title">Demo user data</h3>
                <p className="panel-sub">
                  Seed or remove demo accounts, posts, comments, and messages.
                </p>
              </div>
            </div>
            <div className="moderation-action-row">
              <button
                className="btn ghost"
                type="button"
                disabled={demoBusy}
                onClick={() => void handleSeedDemoUsers()}
              >
                {demoBusy ? "Working..." : "Create demo users"}
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={demoBusy}
                onClick={() => void handleSyncDemoUsers()}
              >
                {demoBusy ? "Working..." : "Sync demo data"}
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={demoBusy}
                onClick={() => void handleDeleteDemoUsers()}
              >
                {demoBusy ? "Working..." : "Delete demo data"}
              </button>
            </div>
            {demoStatus && <div className="status">{demoStatus}</div>}
            </section>

            <section className="panel moderation-panel moderation-panel--utility moderation-demo-panel">
            <div className="moderation-panel-header">
              <div className="moderation-panel-heading">
                <span className="moderation-section-kicker">
                  <Store size={14} />
                  StoreFront sandbox
                </span>
                <h3 className="moderation-panel-title">StoreFront mock listings</h3>
                <p className="panel-sub">
                  Manage demo listings that appear on the StoreFront cards.
                </p>
              </div>
            </div>
            <div className="moderation-settings-row">
              <div>
                <strong>Show StoreFront mock listings</strong>
                <p className="moderation-report-meta">
                  Toggle demo cards for layout and marketplace testing.
                </p>
              </div>
              <label className="moderation-toggle">
                <input
                  type="checkbox"
                  checked={storefrontDemoEnabled}
                  onChange={(event) => handleStorefrontDemoToggle(event.target.checked)}
                />
                <span className="moderation-toggle-track" aria-hidden="true" />
                <span className="moderation-toggle-label">
                  {storefrontDemoEnabled ? "Enabled" : "Disabled"}
                </span>
              </label>
            </div>
            <div className="moderation-action-row">
              <button
                className="btn ghost"
                type="button"
                onClick={handleAddStorefrontDemoListings}
              >
                Add 20 StoreFront demo listings
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={handleClearStorefrontDemoListings}
              >
                Clear StoreFront demo listings
              </button>
            </div>
            <div className="moderation-report-meta">
              Extra demo listings: {storefrontDemoCount}
            </div>
            {storefrontDemoStatus && <div className="status">{storefrontDemoStatus}</div>}
            </section>

            <section className="panel moderation-panel moderation-panel--utility moderation-demo-panel">
            <div className="moderation-panel-header">
              <div className="moderation-panel-heading">
                <span className="moderation-section-kicker">
                  <LayoutDashboard size={14} />
                  Seller sandbox
                </span>
                <h3 className="moderation-panel-title">Seller dashboard mock data</h3>
                <p className="panel-sub">
                  Paste mock data for My Dashboard. Applies to this browser only.
                </p>
              </div>
            </div>
            <div className="moderation-settings-row">
              <div>
                <strong>Enable My Dashboard mock data</strong>
                <p className="moderation-report-meta">
                  When enabled, My Dashboard will render the mock data below.
                </p>
              </div>
              <label className="moderation-toggle">
                <input
                  type="checkbox"
                  checked={sellerDashboardMockEnabled}
                  onChange={(event) => handleToggleSellerDashboardMock(event.target.checked)}
                />
                <span className="moderation-toggle-track" aria-hidden="true" />
                <span className="moderation-toggle-label">
                  {sellerDashboardMockEnabled ? "Enabled" : "Disabled"}
                </span>
              </label>
            </div>
            <textarea
              className="auth-input moderation-json-editor"
              rows={10}
              value={sellerDashboardMockPayload}
              onChange={(event) => setSellerDashboardMockPayload(event.target.value)}
            />
            <div className="moderation-action-row">
              <button className="btn ghost" type="button" onClick={handleApplySellerDashboardMock}>
                Apply mock data
              </button>
              <button className="btn ghost" type="button" onClick={handleResetSellerDashboardMock}>
                Reset sample
              </button>
              <button className="btn ghost" type="button" onClick={handleClearSellerDashboardMock}>
                Clear mock data
              </button>
            </div>
            {sellerDashboardMockStatus && (
              <div className="status">{sellerDashboardMockStatus}</div>
            )}
            </section>

            <section className="panel moderation-panel moderation-panel--utility moderation-settings-panel">
            <div className="moderation-panel-header">
              <div className="moderation-panel-heading">
                <span className="moderation-section-kicker">
                  <SlidersHorizontal size={14} />
                  Platform controls
                </span>
                <h3 className="moderation-panel-title">Platform settings</h3>
                <p className="panel-sub">
                  Control access to StoreFront and Newsroom routes + sidebar buttons.
                </p>
              </div>
            </div>
            {settingsLoading && <div className="status">Loading settings...</div>}
            {!settingsLoading && (
              <>
                <div className="moderation-settings-row">
                  <div>
                    <strong>Mobile sidebar style</strong>
                    <p className="moderation-report-meta">
                      Switch between the separate drawer component and the current menu panel.
                      Applies across devices after save.
                    </p>
                  </div>
                  <label className="moderation-toggle">
                    <input
                      type="checkbox"
                      checked={mobileMenuVariant === "drawer"}
                      disabled={settingsSaving}
                      onChange={(event) =>
                        void handleMobileMenuVariantToggle(event.target.checked)
                      }
                    />
                    <span className="moderation-toggle-track" aria-hidden="true" />
                    <span className="moderation-toggle-label">
                      {mobileMenuVariant === "drawer" ? "Drawer" : "Panel"}
                    </span>
                  </label>
                </div>
                <div className="moderation-settings-row">
                  <div>
                    <strong>StoreFront availability</strong>
                    <p className="moderation-report-meta">
                      Toggle the StoreFront page, listing route, and sidebar button.
                    </p>
                  </div>
                  <label className="moderation-toggle">
                    <input
                      type="checkbox"
                      checked={storefrontEnabled}
                      disabled={settingsSaving}
                      onChange={(event) => handleToggleStorefront(event.target.checked)}
                    />
                    <span className="moderation-toggle-track" aria-hidden="true" />
                    <span className="moderation-toggle-label">
                      {storefrontEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </label>
                </div>
                <div className="moderation-settings-row">
                  <div>
                    <strong>Newsroom availability</strong>
                    <p className="moderation-report-meta">
                      Toggle the Newsroom page, button, and route.
                    </p>
                  </div>
                  <label className="moderation-toggle">
                    <input
                      type="checkbox"
                      checked={newsroomEnabled}
                      disabled={settingsSaving}
                      onChange={(event) => handleToggleNewsroom(event.target.checked)}
                    />
                    <span className="moderation-toggle-track" aria-hidden="true" />
                    <span className="moderation-toggle-label">
                      {newsroomEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </label>
                </div>
              </>
            )}
            {settingsError && <div className="status status-error">{settingsError}</div>}
            </section>
          </div>
        </div>
      </div>
      <PopupModal
        open={Boolean(selectedUser)}
        title={selectedUser ? usernameLabel(selectedUser) : "User details"}
        onClose={() => setSelectedUser(null)}
        className="moderation-user-modal"
      >
        {selectedUser && (
          <>
            <div className="moderation-user-modal-hero">
              <div className="moderation-user-modal-copy">
                <span className="moderation-section-kicker">
                  <Shield size={14} />
                  Moderation record
                </span>
                <h4>{usernameLabel(selectedUser)}</h4>
                <p>
                  {selectedUser.displayName || "No display name"}
                  {selectedUser.email ? ` · ${selectedUser.email}` : ""}
                  {selectedUser.profile?.handle
                    ? ` · @${String(selectedUser.profile.handle).replace(/^@+/, "")}`
                    : ""}
                </p>
              </div>
              <span
                className={`moderation-user-status moderation-user-status--${userStatusTone(
                  selectedUser
                )}`}
              >
                {statusLabel(selectedUser)}
              </span>
            </div>
            <div className="moderation-user-modal-grid">
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Username</span>
                <strong>{usernameLabel(selectedUser)}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Display name</span>
                <strong>{selectedUser.displayName || "-"}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Email</span>
                <strong>{selectedUser.email || "-"}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Handle</span>
                <strong>{selectedUser.profile?.handle || "-"}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Role</span>
                <strong>{selectedUser.appRole || "user"}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Status</span>
                <strong>{statusLabel(selectedUser)}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Warnings</span>
                <strong>{Number(selectedUser.moderation?.warningCount || 0)}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Strike level</span>
                <strong>{Number(selectedUser.moderation?.strikeLevel || 0)}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Last warning</span>
                <strong>{formatDateTime(selectedUser.moderation?.lastWarningAt) || "-"}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Blocked until</span>
                <strong>{formatDateTime(selectedUser.moderation?.blockedUntil) || "-"}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Deactivation reason</span>
                <strong>{selectedUser.deactivationReason || "-"}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">Age verification due</span>
                <strong>{formatDateTime(selectedUser.ageVerificationDueAt) || "-"}</strong>
              </div>
              <div className="moderation-user-detail">
                <span className="moderation-user-detail-label">User ID</span>
                <strong>{selectedUser.id}</strong>
              </div>
            </div>
            {userActionNotice[selectedUser.id] && (
              <div className="moderation-user-action-notice">
                {userActionNotice[selectedUser.id]}
              </div>
            )}
            <div className="moderation-action-row">
              <button
                className="btn ghost"
                type="button"
                disabled={userAction[selectedUser.id] || isModerationBanned(selectedUser)}
                onClick={() => handleRestrictUser(selectedUser.id, "block-7")}
              >
                Block 7 days
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={userAction[selectedUser.id] || isModerationBanned(selectedUser)}
                onClick={() => handleRestrictUser(selectedUser.id, "block-30")}
              >
                Block 30 days
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={userAction[selectedUser.id]}
                onClick={() => {
                  const isBanned = isModerationBanned(selectedUser);
                  const isBlocked = isModerationBlocked(selectedUser);
                  const nextAction = isBanned ? "unban" : isBlocked ? "unblock" : "ban";
                  handleRestrictUser(selectedUser.id, nextAction);
                }}
              >
                {isModerationBanned(selectedUser)
                  ? "Unban"
                  : isModerationBlocked(selectedUser)
                  ? "Unblock"
                  : "Ban"}
              </button>
              {isAgeLocked(selectedUser) && (
                <button
                  className="btn ghost"
                  type="button"
                  disabled={userAction[selectedUser.id]}
                  onClick={() => handleRestrictUser(selectedUser.id, "age-unlock")}
                >
                  Unlock age lock
                </button>
              )}
              <button
                className="btn ghost"
                type="button"
                onClick={() => setSelectedUser(null)}
              >
                Close
              </button>
            </div>
          </>
        )}
      </PopupModal>
    </div>
  );
}
