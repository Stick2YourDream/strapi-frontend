import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../api/strapi";
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
  email?: string;
  appRole?: string;
  blocked?: boolean;
  profile?: {
    firstName?: string;
    lastName?: string;
    handle?: string;
  } | null;
  moderation?: ModerationState | null;
};

type ReportFilter = "all" | "open" | "reviewed" | "dismissed";

const STOREFRONT_DEMO_ENABLED_KEY = "storefront:demoListingsEnabled";
const STOREFRONT_DEMO_COUNT_KEY = "storefront:demoListingsCount";
const STOREFRONT_DASHBOARD_MOCK_ENABLED_KEY = "storefront:sellerDashboardMockEnabled";
const STOREFRONT_DASHBOARD_MOCK_DATA_KEY = "storefront:sellerDashboardMockData";
const STOREFRONT_DEMO_MAX = 120;
const DEFAULT_STOREFRONT_DEMO_ENABLED = import.meta.env.DEV;
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

const statusLabel = (moderation?: ModerationState | null) => {
  if (!moderation) return "Active";
  if (Number(moderation.strikeLevel) >= 3) return "Banned";
  if (moderation.blockedUntil) {
    const formatted = formatDateTime(moderation.blockedUntil);
    return formatted ? `Blocked until ${formatted}` : "Blocked";
  }
  return "Active";
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
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const pageSize = 10;
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
        setNewsroomEnabled(res.data?.data?.newsroomEnabled !== false);
        setStorefrontEnabled(res.data?.data?.storefrontEnabled !== false);
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
    try {
      const res = await api.post(`/moderation/users/${targetId}/restrict`, { action });
      const updated = res.data?.data;
      setUserResults((prev) =>
        prev.map((entry) =>
          entry.id === targetId
            ? {
                ...entry,
                moderation: {
                  warningCount: updated.warningCount,
                  strikeLevel: updated.strikeLevel,
                  blockedUntil: updated.blockedUntil,
                  lastWarningAt: updated.lastWarningAt,
                },
              }
            : entry
        )
      );
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

  return (
    <div className="dashboard-shell">
      <Sidebar active="moderation" />
      <div className="main-content moderation-content">
        <section className="panel moderation-hero">
          <div>
            <p className="eyebrow">Moderation</p>
            <h2 className="moderation-title">Reports and account controls</h2>
            <p className="panel-sub">
              Review user reports and apply account restrictions when needed.
            </p>
          </div>
        </section>

        <div className="panel-grid moderation-grid">
          <section className="panel moderation-panel">
            <div className="moderation-panel-header">
              <div>
                <h3 className="moderation-panel-title">Reports</h3>
                <p className="panel-sub">All reports submitted by community members.</p>
              </div>
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
            </div>

            {reportsLoading && <div className="status">Loading reports...</div>}
            {reportError && <div className="status status-error">{reportError}</div>}
            {!reportsLoading && filteredReports.length === 0 && (
              <div className="status">No reports in this view.</div>
            )}
            <div className="moderation-report-list">
              {filteredReports.map((report) => (
                <div key={report.id} className="moderation-report-card">
                  <div className="moderation-report-header">
                    <div>
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
                  <div className="moderation-report-meta">
                    Reported by: {report.reporter?.label || "Unknown"}
                    {report.reporter?.email ? ` (${report.reporter.email})` : ""}
                  </div>
                  {report.details && <p className="moderation-report-details">{report.details}</p>}
                  <div className="moderation-report-footer">
                    <span className="moderation-report-meta">
                      {formatDateTime(report.createdAt)}
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
                </div>
              ))}
            </div>
          </section>

          <section className="panel moderation-panel">
            <div className="moderation-panel-header">
              <div>
                <h3 className="moderation-panel-title">User restrictions</h3>
                <p className="panel-sub">
                  Search by name, handle, email, or user ID.
                </p>
              </div>
            </div>

            <form className="moderation-search" onSubmit={handleUserSearch}>
              <input
                className="auth-input"
                placeholder="Search users..."
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
              />
              <button className="btn primary" type="submit" disabled={userLoading}>
                {userLoading ? "Searching..." : "Search"}
              </button>
            </form>

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
              <div className="moderation-action-row">
                <button
                  className="btn ghost"
                  type="button"
                  disabled={page <= 1 || userLoading}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </button>
                <span className="moderation-report-meta">
                  Page {pageCount ? page : 0} of {pageCount || 0}
                </span>
                <button
                  className="btn ghost"
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
                <div key={entry.id} className="moderation-user-card">
                  <div>
                    <strong>{entry.displayName}</strong>
                    <div className="moderation-report-meta">
                      {entry.email || entry.profile?.handle || "No email on file"}
                    </div>
                    <div className="moderation-report-meta">
                      Role: {entry.appRole || "user"} - {statusLabel(entry.moderation)}
                    </div>
                  </div>
                  <div className="moderation-action-row">
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => handleRestrictUser(entry.id, "block-7")}
                    >
                      Block 7 days
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => handleRestrictUser(entry.id, "block-30")}
                    >
                      Block 30 days
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => handleRestrictUser(entry.id, "ban")}
                    >
                      Ban
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={userAction[entry.id]}
                      onClick={() => handleRestrictUser(entry.id, "unblock")}
                    >
                      Unblock
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel moderation-panel moderation-demo-panel">
            <div className="moderation-panel-header">
              <div>
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

          <section className="panel moderation-panel moderation-demo-panel">
            <div className="moderation-panel-header">
              <div>
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

          <section className="panel moderation-panel moderation-demo-panel">
            <div className="moderation-panel-header">
              <div>
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
              className="auth-input"
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

          <section className="panel moderation-panel moderation-settings-panel">
            <div className="moderation-panel-header">
              <div>
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
  );
}
