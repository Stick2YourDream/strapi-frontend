import {
  type CSSProperties,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../css/dashboard.css";
import "../css/storefront-seller.css";
import Sidebar from "../components/Sidebar";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { MARKETPLACE_POLICY_VERSION } from "../content/marketplace-policy";
import { MARKETPLACE_FEE_VERSION } from "../content/marketplace-fee-disclosure";
import { usePageMeta } from "../hooks/usePageMeta";
import { pickMediaUrls } from "../utils/media";

const USE_DEMO_LISTINGS = import.meta.env.DEV;
const SELLER_DASHBOARD_MOCK_ENABLED_KEY = "storefront:sellerDashboardMockEnabled";
const SELLER_DASHBOARD_MOCK_DATA_KEY = "storefront:sellerDashboardMockData";
const DASHBOARD_SYNC_INTERVAL = 15000;
const SELLER_DASHBOARD_THEME_KEY = "storefront:sellerDashboardTheme:v1";

const buildSellerDashboardMockEnabledKey = (userId?: number | null) =>
  userId ? `${SELLER_DASHBOARD_MOCK_ENABLED_KEY}:${userId}` : null;

const buildSellerDashboardMockDataKey = (userId?: number | null) =>
  userId ? `${SELLER_DASHBOARD_MOCK_DATA_KEY}:${userId}` : null;
const buildSellerDashboardThemeKey = (userId?: number | null, viewId?: number | null) =>
  userId && viewId ? `${SELLER_DASHBOARD_THEME_KEY}:${userId}:${viewId}` : null;
type StorefrontSeller = {
  id: string;
  userId?: number;
  name: string;
  handle?: string;
  avatarUrl?: string;
  rating: number;
  responseTime: string;
  verifiedLevel: "verified" | "pending" | "unverified";
  badges: string[];
};

type StorefrontProduct = {
  id: string;
  documentId?: string;
  rawId?: number;
  title: string;
  price: number;
  category: string;
  condition: string;
  location: string;
  description: string;
  images: string[];
  imageIds?: number[];
  seller: StorefrontSeller;
  stock: number;
  visibility?: "public" | "friends";
  shipping: string;
  shippingEnabled?: boolean;
  shippingCarriers?: string[];
  shippingInternational?: boolean;
  localPickup?: boolean;
  cashAccepted?: boolean;
  noShippingRequired?: boolean;
  shippingNotes?: string;
  shippingPolicyAccepted?: boolean;
  feePolicyAccepted?: boolean;
  isDemo?: boolean;
};

type OfferStatus = "pending" | "accepted" | "declined" | "withdrawn";

type StorefrontOffer = {
  id: string;
  listingId: number;
  buyerId?: number;
  sellerId?: number;
  buyerName: string;
  offeredPrice: number;
  currency: string;
  status: OfferStatus;
  createdAt: string;
};

type MarketplaceOrder = {
  id: number;
  listingId?: number | null;
  listingTitle: string;
  buyerId?: number | null;
  buyerName: string;
  sellerId?: number | null;
  sellerName: string;
  amount: number;
  net: number;
  fee: number;
  currency: string;
  status: string;
  shippingStatus?: string;
  payoutStatus?: string;
  createdAt: string;
};

type MarketplaceDispute = {
  id: number;
  status: string;
  reason?: string;
  createdAt: string;
  buyerName: string;
  sellerName: string;
  listingTitle: string;
};

type MarketplaceMessage = {
  id: number;
  body: string;
  createdAt: string;
  listingTitle?: string;
  senderName: string;
  recipientName: string;
};

type SellerDashboardMockData = {
  listings?: StorefrontProduct[];
  offers?: StorefrontOffer[];
  orders?: MarketplaceOrder[];
  messages?: MarketplaceMessage[];
  disputes?: MarketplaceDispute[];
  verification?: VerificationStatus | null;
};

type DraftImage = {
  id: string;
  url: string;
  file?: File;
  mediaId?: number;
};

type BulkListingDraft = DraftProduct & {
  id: string;
  images: DraftImage[];
  error?: string | null;
};

type DraftProduct = {
  title: string;
  price: string;
  category: string;
  condition: string;
  location: string;
  locationCity: string;
  locationState: string;
  locationStateCode: string;
  description: string;
  visibility: "public" | "friends";
  shipping: string;
  shippingEnabled: boolean;
  shippingCarriers: string[];
  shippingInternational: boolean;
  localPickup: boolean;
  cashAccepted: boolean;
  noShippingRequired: boolean;
  shippingNotes: string;
  shippingPolicyAccepted: boolean;
  policyAccepted: boolean;
  feePolicyAccepted: boolean;
};


type VerificationItem = {
  label: string;
  status: "verified" | "pending" | "optional";
  detail: string;
};

type VerificationStatus = {
  sellerIdStatus?: "verified" | "pending" | "required" | "optional";
  sellerPayoutStatus?: "verified" | "pending" | "required" | "optional";
  buyerPaymentStatus?: "verified" | "pending" | "required" | "optional";
  buyerAddressStatus?: "verified" | "pending" | "required" | "optional";
  stripeIdentityStatus?: string;
  stripeIdentitySessionId?: string;
  payoutProvider?: string;
  payoutEmail?: string;
  paypalMerchantIdInPayPal?: string;
  paypalPartnerReferralId?: string;
  paypalConsentStatus?: boolean;
  paypalPermissionsGranted?: boolean;
  paypalAccountStatus?: string;
  paypalEmailConfirmed?: boolean;
  paypalReturnMessage?: string;
  paypalRiskStatus?: string;
  paypalOnboardedAt?: string;
};

type DashboardTheme = {
  pageBg: string;
  pageOpacity: number;
  cardBg: string;
  cardOpacity: number;
  accent: string;
};

type DashboardWidgetStyle = {
  color?: string;
  opacity?: number;
};

type DashboardWidgetConfig = {
  hidden?: string[];
  styles?: Record<string, DashboardWidgetStyle>;
};

type Layout = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
};

type Layouts = Record<string, Layout[]>;

type DashboardView = {
  id: number;
  documentId?: string;
  name: string;
  isDefault?: boolean;
  layout?: Layouts;
  widgets?: DashboardWidgetConfig;
  theme?: DashboardTheme;
  updatedAt?: string;
};

type StoredDashboardTheme = {
  theme: DashboardTheme;
  savedAt: number;
};

type SetupChecklistItem = {
  id: "listing" | "identity" | "payout";
  label: string;
  status: "done" | "pending" | "required";
};

type LocationOption = {
  name: string;
  code?: string;
};

const matchByName = (options: LocationOption[], value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return options.find((option) => {
    const name = String(option.name || "").trim().toLowerCase();
    const code = String(option.code || "").trim().toLowerCase();
    return name === normalized || code === normalized;
  });
};

const formatLocationLabel = (city: string, state: string) => {
  const parts = [city.trim(), state.trim()].filter(Boolean);
  return parts.join(", ");
};

const readSellerDashboardMockEnabled = (userId?: number | null) => {
  if (typeof window === "undefined") return false;
  const scopedKey = buildSellerDashboardMockEnabledKey(userId);
  if (!scopedKey) return false;
  const raw = window.localStorage.getItem(scopedKey);
  if (raw !== null) return raw === "true";
  const legacy = window.localStorage.getItem(SELLER_DASHBOARD_MOCK_ENABLED_KEY);
  if (legacy !== null) {
    window.localStorage.setItem(scopedKey, legacy);
    window.localStorage.removeItem(SELLER_DASHBOARD_MOCK_ENABLED_KEY);
    return legacy === "true";
  }
  return false;
};

const readStoredDashboardTheme = (
  userId?: number | null,
  viewId?: number | null
): StoredDashboardTheme | null => {
  if (typeof window === "undefined") return null;
  const key = buildSellerDashboardThemeKey(userId, viewId);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDashboardTheme | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.theme || typeof parsed.theme !== "object") return null;
    return {
      theme: { ...DEFAULT_DASHBOARD_THEME, ...(parsed.theme as DashboardTheme) },
      savedAt: Number(parsed.savedAt || 0),
    };
  } catch {
    return null;
  }
};

const writeStoredDashboardTheme = (
  userId: number,
  viewId: number,
  theme: DashboardTheme
) => {
  if (typeof window === "undefined") return;
  const key = buildSellerDashboardThemeKey(userId, viewId);
  if (!key) return;
  try {
    const payload: StoredDashboardTheme = { theme, savedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
};

const areThemesEqual = (left: DashboardTheme, right: DashboardTheme) =>
  left.pageBg === right.pageBg &&
  left.pageOpacity === right.pageOpacity &&
  left.cardBg === right.cardBg &&
  left.cardOpacity === right.cardOpacity &&
  left.accent === right.accent;

const readSellerDashboardMockData = (userId?: number | null): SellerDashboardMockData | null => {
  if (typeof window === "undefined") return null;
  const scopedKey = buildSellerDashboardMockDataKey(userId);
  if (!scopedKey) return null;
  const raw = window.localStorage.getItem(scopedKey);
  if (raw) {
    try {
      return JSON.parse(raw) as SellerDashboardMockData;
    } catch {
      return null;
    }
  }
  const legacy = window.localStorage.getItem(SELLER_DASHBOARD_MOCK_DATA_KEY);
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as SellerDashboardMockData;
      window.localStorage.setItem(scopedKey, legacy);
      window.localStorage.removeItem(SELLER_DASHBOARD_MOCK_DATA_KEY);
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
};

const CATEGORY_OPTIONS = [
  "All",
  "$0.00",
  "Cars & Vehicles",
  "Real Estate",
  "Electronics",
  "Home & Garden",
  "Furniture",
  "Appliances",
  "Fashion",
  "Shoes",
  "Accessories",
  "Beauty",
  "Health",
  "Baby & Kids",
  "Toys & Games",
  "Sports & Outdoors",
  "Fitness",
  "Books",
  "Music & Instruments",
  "Art & Collectibles",
  "Jewelry",
  "Pets",
  "Services",
  "Tickets",
  "Business & Industrial",
  "Jobs",
  "Other",
];

const CONDITION_OPTIONS = ["Any", "New", "Like new", "Good", "Fair"];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const formatPrice = (value: number) => currency.format(value <= 0 ? 0 : value);

const formatCurrency = (value: number, currencyCode?: string) => {
  if (!currencyCode || currencyCode.toUpperCase() === "USD") {
    return formatPrice(value);
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode.toUpperCase(),
    }).format(value);
  } catch {
    return `${currencyCode.toUpperCase()} ${value.toFixed(2)}`;
  }
};

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};

const getEntityId = (value: any) => {
  if (!value) return null;
  if (typeof value === "number") return value;
  const data = value?.data ?? value;
  const id = data?.id ?? data?.attributes?.id;
  const numeric = Number(id);
  return Number.isFinite(numeric) ? numeric : null;
};

const extractMediaIds = (mediaField: any): number[] => {
  if (!mediaField) return [];
  const data = mediaField?.data ?? mediaField;
  const items = Array.isArray(data) ? data : Array.isArray(mediaField) ? mediaField : [];
  if (!Array.isArray(items)) return [];
  return items
    .map((entry) => Number(entry?.id ?? entry?.attributes?.id))
    .filter((id) => Number.isFinite(id));
};

const parseLocationParts = (location: string) => {
  const normalized = String(location || "").trim();
  if (!normalized) return { city: "", state: "" };
  const [cityRaw, stateRaw] = normalized.split(",");
  return {
    city: String(cityRaw || "").trim(),
    state: String(stateRaw || "").trim(),
  };
};

const normalizeStatus = (value?: string | null): VerificationItem["status"] => {
  if (value === "verified" || value === "pending" || value === "optional") {
    return value;
  }
  return "optional";
};

const getStatusTone = (value?: string | null) => {
  const normalized = String(value || "").toLowerCase();
  if (
    ["paid", "approved", "completed", "delivered", "verified", "success"].includes(
      normalized
    )
  ) {
    return "is-success";
  }
  if (
    ["pending", "processing", "open", "in progress", "review"].includes(normalized)
  ) {
    return "is-warning";
  }
  if (
    ["failed", "declined", "canceled", "cancelled", "rejected", "disputed"].includes(
      normalized
    )
  ) {
    return "is-danger";
  }
  return "is-neutral";
};

const SETUP_ACTION_LABELS: Record<SetupChecklistItem["id"], string> = {
  listing: "List a product",
  identity: "Verify now",
  payout: "Add payout method",
};

const buildSellerVerification = (status?: VerificationStatus | null): VerificationItem[] => [
  {
    label: "Government ID",
    status: normalizeStatus(status?.sellerIdStatus),
    detail: "Optional identity verification",
  },
  {
    label: "Payout method",
    status: normalizeStatus(status?.sellerPayoutStatus),
    detail: "Optional payout verification",
  },
  {
    label: "Activity history",
    status: "pending",
    detail: "Building seller trust",
  },
];

const DASHBOARD_COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };
const DEFAULT_DASHBOARD_THEME: DashboardTheme = {
  pageBg: "#070b14",
  pageOpacity: 1,
  cardBg: "#0f172a",
  cardOpacity: 1,
  accent: "#4da3ff",
};

const DEFAULT_WIDGET_CONFIG: DashboardWidgetConfig = {
  hidden: ["buyerDisputes"],
  styles: {},
};

const DASHBOARD_WIDGETS = [
  { id: "totalEarnings", title: "Total earnings", helper: "Net revenue" },
  { id: "buyerPayments", title: "Buyer payments", helper: "Recent captures" },
  { id: "payouts", title: "Payouts", helper: "Next payouts" },
  { id: "orders", title: "Orders", helper: "Latest transactions" },
  { id: "activeListings", title: "Active listings", helper: "Inventory snapshot" },
  { id: "offers", title: "Offers", helper: "Open bargains" },
  { id: "messages", title: "Messages", helper: "Marketplace chats" },
  { id: "verification", title: "Verification", helper: "Trust & safety" },
  { id: "topProducts", title: "Top products", helper: "Best sellers" },
  { id: "buyerDisputes", title: "Buyer disputes", helper: "Open cases" },
];
const DASHBOARD_WIDGET_IDS = DASHBOARD_WIDGETS.map((widget) => widget.id);

const BASE_LAYOUT: Layout[] = [
  { i: "totalEarnings", x: 0, y: 0, w: 4, h: 2 },
  { i: "buyerPayments", x: 4, y: 0, w: 4, h: 2 },
  { i: "payouts", x: 8, y: 0, w: 4, h: 2 },
  { i: "offers", x: 0, y: 2, w: 6, h: 2 },
  { i: "orders", x: 6, y: 2, w: 6, h: 2 },
  { i: "activeListings", x: 0, y: 4, w: 8, h: 3 },
  { i: "messages", x: 8, y: 4, w: 4, h: 3 },
  { i: "verification", x: 0, y: 7, w: 6, h: 2 },
  { i: "topProducts", x: 6, y: 7, w: 6, h: 2 },
  { i: "buyerDisputes", x: 0, y: 9, w: 6, h: 2 },
];

const buildLayoutsForCols = (cols: number) =>
  BASE_LAYOUT.map((item) => ({
    ...item,
    w: Math.min(item.w, cols),
    x: item.x % cols,
  }));

const buildDefaultLayouts = (): Layouts => ({
  lg: BASE_LAYOUT,
  md: buildLayoutsForCols(DASHBOARD_COLS.md),
  sm: buildLayoutsForCols(DASHBOARD_COLS.sm),
  xs: buildLayoutsForCols(DASHBOARD_COLS.xs),
  xxs: buildLayoutsForCols(DASHBOARD_COLS.xxs),
});

const ensureLayouts = (value?: Layouts | null): Layouts => {
  const fallback = buildDefaultLayouts();
  if (!value) return fallback;
  const merged: Layouts = { ...fallback, ...value };
  (Object.keys(DASHBOARD_COLS) as Array<keyof typeof DASHBOARD_COLS>).forEach((key) => {
    const items = Array.isArray(merged[key]) ? merged[key] : [];
    const ids = new Set(items.map((item) => item.i));
    const missing = fallback[key]?.filter((item) => !ids.has(item.i)) ?? [];
    merged[key] = [...items, ...missing];
  });
  return merged;
};

const clampNumber = (value: number, min = 0, max = 1) =>
  Math.min(Math.max(value, min), max);

const toRgba = (hex: string, opacity: number) => {
  const cleaned = hex.replace("#", "").trim();
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((char) => char + char)
          .join("")
      : cleaned;
  if (expanded.length !== 6) return `rgba(15, 23, 42, ${clampNumber(opacity)})`;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clampNumber(opacity)})`;
};

const normalizeViewEntry = (entry: any): DashboardView => {
  const attrs = normalize(entry);
  const id = Number(entry?.id ?? attrs.id ?? 0);
  const documentId = String(entry?.documentId ?? attrs.documentId ?? "").trim();
  const theme = { ...DEFAULT_DASHBOARD_THEME, ...(attrs.theme || {}) };
  return {
    id,
    documentId: documentId || undefined,
    name: String(attrs.name || "My dashboard"),
    isDefault: Boolean(attrs.isDefault),
    layout: ensureLayouts(attrs.layout),
    widgets: {
      hidden: Array.isArray(attrs.widgets?.hidden) ? attrs.widgets.hidden : [],
      styles: attrs.widgets?.styles || {},
    },
    theme,
    updatedAt: String(attrs.updatedAt || entry?.updatedAt || ""),
  };
};

const createTempId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createEmptyDraft = (): DraftProduct => ({
  title: "",
  price: "",
  category: "Electronics",
  condition: "New",
  location: "",
  locationCity: "",
  locationState: "",
  locationStateCode: "",
  description: "",
  visibility: "public",
  shipping: "",
  shippingEnabled: false,
  shippingCarriers: [],
  shippingInternational: false,
  localPickup: true,
  cashAccepted: false,
  noShippingRequired: true,
  shippingNotes: "",
  shippingPolicyAccepted: false,
  policyAccepted: false,
  feePolicyAccepted: false,
});

const createBulkDraft = (): BulkListingDraft => ({
  id: createTempId(),
  images: [],
  ...createEmptyDraft(),
  error: null,
});

export default function StorefrontSeller(): JSX.Element {
  const { profile, user, appSettings } = useAuth();
  const storefrontEnabled = appSettings?.storefrontEnabled !== false;
  const { getBackgroundStyle } = useUserPreferences();
  const navigate = useNavigate();
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [offers, setOffers] = useState<StorefrontOffer[]>([]);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [selfVerification, setSelfVerification] = useState<VerificationStatus | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [payoutEmail, setPayoutEmail] = useState("");
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [disputes, setDisputes] = useState<MarketplaceDispute[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(false);
  const [disputesError, setDisputesError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MarketplaceMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [sellerDashboardMockEnabled, setSellerDashboardMockEnabled] = useState(false);
  const [sellerDashboardMockData, setSellerDashboardMockData] =
    useState<SellerDashboardMockData | null>(null);
  const [dashboardViews, setDashboardViews] = useState<DashboardView[]>([]);
  const [dashboardLayouts, setDashboardLayouts] = useState<Layouts>(buildDefaultLayouts());
  const [dashboardTheme, setDashboardTheme] =
    useState<DashboardTheme>(DEFAULT_DASHBOARD_THEME);
  const [widgetConfig, setWidgetConfig] =
    useState<DashboardWidgetConfig>(DEFAULT_WIDGET_CONFIG);
  const [revenueRange, setRevenueRange] = useState<7 | 30 | 90>(30);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [dashboardSaveState, setDashboardSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const dashboardReadyRef = useRef(false);
  const dashboardSaveBlockedRef = useRef(false);
  const dashboardSyncRef = useRef(false);
  const activeViewUpdatedAtRef = useRef(0);
  const payoutsRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [stateOptions, setStateOptions] = useState<LocationOption[]>([]);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftProduct>(() => createEmptyDraft());
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [creatingListing, setCreatingListing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [editingListingTitle, setEditingListingTitle] = useState<string | null>(null);
  const isEditingListing = editingListingId !== null;
  const [listingMode, setListingMode] = useState<"single" | "bulk">("single");
  const [bulkListings, setBulkListings] = useState<BulkListingDraft[]>(() => [
    createBulkDraft(),
  ]);
  const [cityOptionsByState, setCityOptionsByState] = useState<
    Record<string, LocationOption[]>
  >({});
  const [bulkShippingAccepted, setBulkShippingAccepted] = useState(false);
  const [bulkFeeAccepted, setBulkFeeAccepted] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [creatingBulk, setCreatingBulk] = useState(false);
  const [previewMode, setPreviewMode] = useState<"single" | "bulk" | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
  const [isPhotoDragActive, setIsPhotoDragActive] = useState(false);
  const [listingDeleteTarget, setListingDeleteTarget] =
    useState<StorefrontProduct | null>(null);
  const [listingDeleteSaving, setListingDeleteSaving] = useState(false);
  const [listingDeleteError, setListingDeleteError] = useState<string | null>(null);
  const [bulkPhotoDragActive, setBulkPhotoDragActive] = useState<Record<string, boolean>>(
    {}
  );
  const draftImagesRef = useRef<DraftImage[]>([]);
  const singlePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const photoDragDepthRef = useRef(0);
  const bulkPhotoDragDepthRef = useRef<Record<string, number>>({});
  const bulkListingsRef = useRef<BulkListingDraft[]>([]);
  const bulkPhotoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const layoutSaveRef = useRef<number | null>(null);
  const location = useLocation();
  const isListingView = location.hash === "#list";
  useEffect(() => {
    if (isListingView) {
      setFormError(null);
    }
  }, [isListingView]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!accountMenuRef.current) return;
      if (accountMenuRef.current.contains(event.target as Node)) return;
      setAccountMenuOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!isListingView) return;
    let active = true;
    const loadStates = async () => {
      try {
        const res = await api.get("/locations/states", {
          params: { country: "US" },
        });
        const list = (res.data?.data ?? []).map((state: any) => ({
          name: state.name,
          code: state.code || state.isoCode || "",
        }));
        if (active) {
          setStateOptions(list);
          setLocationError(null);
        }
      } catch {
        if (active) setLocationError("Unable to load states.");
      }
    };
    loadStates();
    return () => {
      active = false;
    };
  }, [isListingView]);

  useEffect(() => {
    if (!isListingView) return;
    const stateCode = draft.locationStateCode;
    if (!stateCode) {
      setCityOptions([]);
      return;
    }
    let active = true;
    const loadCities = async () => {
      if (cityOptionsByState[stateCode]) {
        if (active) {
          setCityOptions(cityOptionsByState[stateCode]);
          setLocationError(null);
        }
        return;
      }
      try {
        const res = await api.get("/locations/cities", {
          params: { country: "US", state: stateCode },
        });
        const list = (res.data?.data ?? []).map((city: any) => ({
          name: city.name,
          code: city.name,
        }));
        if (active) {
          setCityOptions(list);
          setLocationError(null);
          setCityOptionsByState((prev) => ({ ...prev, [stateCode]: list }));
        }
      } catch {
        if (active) setLocationError("Unable to load cities.");
      }
    };
    void loadCities();
    return () => {
      active = false;
    };
  }, [cityOptionsByState, draft.locationStateCode, isListingView]);

  useEffect(() => {
    if (!draft.location && (draft.locationCity || draft.locationState)) {
      setDraft((prev) => ({
        ...prev,
        location: formatLocationLabel(prev.locationCity, prev.locationState),
      }));
    }
  }, [draft.location, draft.locationCity, draft.locationState]);

  useEffect(() => {
    if (!isEditingListing) return;
    if (!draft.locationState || stateOptions.length === 0) return;
    const match = matchByName(stateOptions, draft.locationState);
    if (!match) return;
    const nextCode = match.code || match.name;
    if (draft.locationStateCode === nextCode) return;
    updateDraft({ locationState: match.name, locationStateCode: nextCode });
  }, [
    draft.locationState,
    draft.locationStateCode,
    isEditingListing,
    stateOptions,
  ]);

  usePageMeta({
    title: "My Dashboard | Your Social Place",
    description: "Manage your StoreFront listings, offers, and verification status.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const loadListings = useCallback(async () => {
    setLoadingListings(true);
    setListingError(null);
    try {
      const params = new URLSearchParams();
      params.set("populate[0]", "images");
      params.set("populate[1]", "owner");
      params.set("sort", "createdAt:desc");
      if (user?.id) {
        params.set("filters[owner][id][$eq]", String(user.id));
      }
      const res = await api.get(`/marketplace-listings?${params.toString()}`);
      const entries = Array.isArray(res.data?.data) ? res.data.data : [];
      const mapped = entries.map((entry: any) => {
        const attrs = normalize(entry);
        const ownerData = attrs.owner?.data ?? attrs.owner;
        const owner = normalize(ownerData);
        const sellerId = getEntityId(ownerData) ?? 0;
        const sellerName =
          `${String(owner.firstName || "").trim()} ${String(owner.lastName || "").trim()}`.trim() ||
          String(owner.username || "").trim() ||
          String(owner.email || "").split("@")[0] ||
          "Seller";
        const images = pickMediaUrls(attrs.images, { kind: "post" });
        const imageIds = extractMediaIds(attrs.images);
        const shippingSummary = attrs.localPickup
          ? "Local pickup available"
          : "Delivery arranged privately";
        const documentId = String(
          attrs.documentId ?? entry?.documentId ?? entry?.id ?? attrs.id ?? Date.now()
        );
        const numericIdCandidate = Number(entry?.id ?? attrs.id ?? attrs.documentId);
        return {
          id: documentId,
          documentId,
          rawId: Number.isFinite(numericIdCandidate) ? numericIdCandidate : undefined,
          title: String(attrs.title || "Untitled listing"),
          price: Number(attrs.price || 0),
          category: String(attrs.category || "General"),
          condition: String(attrs.condition || "Good"),
          location: String(attrs.location || "Flexible pickup"),
          description: String(attrs.description || ""),
          visibility:
            attrs.visibility === "friends" || attrs.visibility === "public"
              ? attrs.visibility
              : "public",
          images,
          imageIds,
          seller: {
            id: String(sellerId || "seller"),
            userId: sellerId || undefined,
            name: sellerName,
            handle: String(owner.handle || "").trim() || undefined,
            avatarUrl: String(owner.avatarUrl || "").trim() || undefined,
            rating: Number(owner.rating || 4.7),
            responseTime: "Typically replies within a few hours",
            verifiedLevel: "unverified",
            badges: ["Marketplace seller"],
          },
          stock: Number(attrs.stock ?? 1) || 1,
          shipping: shippingSummary,
          shippingEnabled: false,
          shippingCarriers: [],
          shippingInternational: false,
          localPickup: typeof attrs.localPickup === "boolean" ? attrs.localPickup : false,
          cashAccepted: Boolean(attrs.cashAccepted),
          noShippingRequired: true,
          shippingNotes: "",
          shippingPolicyAccepted: Boolean(attrs.shippingPolicyAccepted),
          feePolicyAccepted: Boolean(attrs.feePolicyAccepted),
        } satisfies StorefrontProduct;
      });
      setProducts(mapped);
    } catch (err) {
      setListingError("Unable to load listings right now.");
      setProducts(USE_DEMO_LISTINGS ? [] : []);
    } finally {
      setLoadingListings(false);
    }
  }, [user?.id]);

  const loadOffers = useCallback(async () => {
    if (!user?.id) {
      setOffers([]);
      return;
    }
    setOfferLoading(true);
    setOfferError(null);
    try {
      const res = await api.get("/marketplace-offers/me");
      const mapped = (res.data?.data ?? []).map((entry: any) => {
        const attrs = normalize(entry);
        const buyerData = attrs.buyer?.data ?? attrs.buyer;
        const buyer = normalize(buyerData);
        const listingData = attrs.listing?.data ?? attrs.listing;
        return {
          id: String(entry.id ?? attrs.documentId ?? `${attrs.createdAt}`),
          listingId: getEntityId(listingData) ?? 0,
          buyerId: getEntityId(buyerData) ?? undefined,
          sellerId: getEntityId(attrs.seller) ?? undefined,
          buyerName:
            `${String(buyer.firstName || "").trim()} ${String(buyer.lastName || "").trim()}`.trim() ||
            String(buyer.username || "").trim() ||
            String(buyer.email || "").split("@")[0] ||
            "Buyer",
          offeredPrice: Number(attrs.offeredPrice || 0),
          currency: String(attrs.currency || "USD").toUpperCase(),
          status: (String(attrs.status || "pending") as OfferStatus) || "pending",
          createdAt: attrs.createdAt ? new Date(attrs.createdAt).toLocaleString() : "",
        } satisfies StorefrontOffer;
      });
      setOffers(mapped);
    } catch {
      setOfferError("Unable to load offers.");
    } finally {
      setOfferLoading(false);
    }
  }, [user?.id]);

  const loadSelfVerification = useCallback(async () => {
    try {
      const res = await api.get("/marketplace-verifications/me");
      const entry = res.data?.data;
      setSelfVerification(entry ? (normalize(entry) as VerificationStatus) : null);
    } catch {
      setSelfVerification(null);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    if (!user?.id) {
      setOrders([]);
      return;
    }
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const res = await api.get("/marketplace-orders/me");
      const mapped = (res.data?.data ?? []).map((entry: any) => {
        const attrs = normalize(entry);
        const listingData = attrs.listing?.data ?? attrs.listing;
        const listing = normalize(listingData);
        const buyerData = attrs.buyer?.data ?? attrs.buyer;
        const buyer = normalize(buyerData);
        const sellerData = attrs.seller?.data ?? attrs.seller;
        const seller = normalize(sellerData);
        return {
          id: Number(entry?.id ?? attrs.id ?? 0),
          listingId: getEntityId(listingData),
          listingTitle: String(listing.title || "Listing"),
          buyerId: getEntityId(buyerData),
          buyerName:
            `${String(buyer.firstName || "").trim()} ${String(buyer.lastName || "").trim()}`.trim() ||
            String(buyer.username || "").trim() ||
            String(buyer.email || "").split("@")[0] ||
            "Buyer",
          sellerId: getEntityId(sellerData),
          sellerName:
            `${String(seller.firstName || "").trim()} ${String(seller.lastName || "").trim()}`.trim() ||
            String(seller.username || "").trim() ||
            String(seller.email || "").split("@")[0] ||
            "Seller",
          amount: Number(attrs.amount || 0),
          net: Number(attrs.net || 0),
          fee: Number(attrs.fee || 0),
          currency: String(attrs.currency || "USD").toUpperCase(),
          status: String(attrs.status || "pending"),
          shippingStatus: String(attrs.shippingStatus || "pending"),
          payoutStatus: String(attrs.payoutStatus || "pending"),
          createdAt: attrs.createdAt ? new Date(attrs.createdAt).toLocaleString() : "",
        } satisfies MarketplaceOrder;
      });
      setOrders(mapped);
    } catch {
      setOrdersError("Unable to load orders.");
    } finally {
      setOrdersLoading(false);
    }
  }, [user?.id]);

  const loadDisputes = useCallback(async () => {
    if (!user?.id) {
      setDisputes([]);
      return;
    }
    setDisputesLoading(true);
    setDisputesError(null);
    try {
      const res = await api.get("/marketplace-disputes/me");
      const mapped = (res.data?.data ?? []).map((entry: any) => {
        const attrs = normalize(entry);
        const listingData = attrs.listing?.data ?? attrs.listing;
        const listing = normalize(listingData);
        const buyerData = attrs.buyer?.data ?? attrs.buyer;
        const buyer = normalize(buyerData);
        const sellerData = attrs.seller?.data ?? attrs.seller;
        const seller = normalize(sellerData);
        return {
          id: Number(entry?.id ?? attrs.id ?? 0),
          status: String(attrs.status || "open"),
          reason: attrs.reason ? String(attrs.reason) : undefined,
          createdAt: attrs.createdAt ? new Date(attrs.createdAt).toLocaleString() : "",
          buyerName:
            `${String(buyer.firstName || "").trim()} ${String(buyer.lastName || "").trim()}`.trim() ||
            String(buyer.username || "").trim() ||
            String(buyer.email || "").split("@")[0] ||
            "Buyer",
          sellerName:
            `${String(seller.firstName || "").trim()} ${String(seller.lastName || "").trim()}`.trim() ||
            String(seller.username || "").trim() ||
            String(seller.email || "").split("@")[0] ||
            "Seller",
          listingTitle: String(listing.title || "Listing"),
        } satisfies MarketplaceDispute;
      });
      setDisputes(mapped);
    } catch {
      setDisputesError("Unable to load disputes.");
    } finally {
      setDisputesLoading(false);
    }
  }, [user?.id]);

  const loadMessages = useCallback(async () => {
    if (!user?.id) {
      setMessages([]);
      return;
    }
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const res = await api.get(
        "/messages?filters[$or][0][sender][id][$eq]=" +
          user.id +
          "&filters[$or][1][recipient][id][$eq]=" +
          user.id +
          "&filters[listing][id][$notNull]=true&populate[0]=sender&populate[1]=recipient&populate[2]=listing&sort=createdAt:desc&pagination[pageSize]=8"
      );
      const mapped = (res.data?.data ?? []).map((entry: any) => {
        const attrs = normalize(entry);
        const listingData = attrs.listing?.data ?? attrs.listing;
        const listing = normalize(listingData);
        const senderData = attrs.sender?.data ?? attrs.sender;
        const sender = normalize(senderData);
        const recipientData = attrs.recipient?.data ?? attrs.recipient;
        const recipient = normalize(recipientData);
        return {
          id: Number(entry?.id ?? attrs.id ?? 0),
          body: String(attrs.body || ""),
          createdAt: attrs.createdAt ? new Date(attrs.createdAt).toLocaleString() : "",
          listingTitle: listing.title ? String(listing.title) : undefined,
          senderName:
            `${String(sender.firstName || "").trim()} ${String(sender.lastName || "").trim()}`.trim() ||
            String(sender.username || "").trim() ||
            String(sender.email || "").split("@")[0] ||
            "User",
          recipientName:
            `${String(recipient.firstName || "").trim()} ${String(recipient.lastName || "").trim()}`.trim() ||
            String(recipient.username || "").trim() ||
            String(recipient.email || "").split("@")[0] ||
            "User",
        } satisfies MarketplaceMessage;
      });
      setMessages(mapped);
    } catch {
      setMessagesError("Unable to load messages.");
    } finally {
      setMessagesLoading(false);
    }
  }, [user?.id]);

  const loadDashboardViews = useCallback(async () => {
    if (!user?.id) {
      setDashboardViews([]);
      setActiveViewId(null);
      dashboardReadyRef.current = false;
      dashboardSaveBlockedRef.current = false;
      return;
    }
    setDashboardLoading(true);
    setDashboardError(null);
    dashboardReadyRef.current = false;
    try {
      const res = await api.get("/marketplace-dashboard-views/me");
      const entries = Array.isArray(res.data?.data)
        ? (res.data.data as unknown[])
        : [];
      if (!entries.length) {
        const created = await api.post("/marketplace-dashboard-views", {
          data: {
            name: "My dashboard",
            isDefault: true,
            layout: buildDefaultLayouts(),
            widgets: DEFAULT_WIDGET_CONFIG,
            theme: DEFAULT_DASHBOARD_THEME,
          },
        });
        const createdEntry = normalizeViewEntry(created.data?.data);
        setDashboardViews([createdEntry]);
        setActiveViewId(createdEntry.id);
        const storedTheme = readStoredDashboardTheme(user?.id ?? null, createdEntry.id);
        const createdTheme = createdEntry.theme || DEFAULT_DASHBOARD_THEME;
        const createdUpdatedAt = Number(
          createdEntry.updatedAt ? new Date(createdEntry.updatedAt).getTime() : 0
        );
        const useStoredTheme =
          storedTheme &&
          storedTheme.savedAt > createdUpdatedAt &&
          !areThemesEqual(storedTheme.theme, createdTheme);
        setDashboardLayouts(createdEntry.layout || buildDefaultLayouts());
        setDashboardTheme(useStoredTheme ? storedTheme!.theme : createdTheme);
        setWidgetConfig(createdEntry.widgets || DEFAULT_WIDGET_CONFIG);
        setDashboardDirty(false);
        setDashboardSaveState("idle");
        dashboardReadyRef.current = true;
        dashboardSaveBlockedRef.current = false;
        return;
      }
      const views = entries.map(normalizeViewEntry);
      setDashboardViews(views);
      const defaultView = views.find((view) => view.isDefault) ?? views[0];
      const storedTheme = readStoredDashboardTheme(user?.id ?? null, defaultView?.id ?? null);
      const defaultTheme = defaultView?.theme || DEFAULT_DASHBOARD_THEME;
      const defaultUpdatedAt = Number(
        defaultView?.updatedAt ? new Date(defaultView.updatedAt).getTime() : 0
      );
      const useStoredTheme =
        storedTheme &&
        storedTheme.savedAt > defaultUpdatedAt &&
        !areThemesEqual(storedTheme.theme, defaultTheme);
      setActiveViewId(defaultView?.id ?? null);
      setDashboardLayouts(defaultView?.layout || buildDefaultLayouts());
      setDashboardTheme(useStoredTheme ? storedTheme!.theme : defaultTheme);
      setWidgetConfig(defaultView?.widgets || DEFAULT_WIDGET_CONFIG);
      setDashboardDirty(false);
      setDashboardSaveState("idle");
      dashboardReadyRef.current = true;
      dashboardSaveBlockedRef.current = false;
    } catch {
      setDashboardError("Unable to load dashboard settings.");
      dashboardReadyRef.current = false;
    } finally {
      setDashboardLoading(false);
    }
  }, [user?.id]);

  const applyViewState = useCallback(
    (view: DashboardView | null) => {
      if (!view) return;
      const storedTheme = readStoredDashboardTheme(user?.id ?? null, view.id);
      const viewTheme = view.theme || DEFAULT_DASHBOARD_THEME;
      const viewUpdatedAt = Number(
        view.updatedAt ? new Date(view.updatedAt).getTime() : 0
      );
      const useStoredTheme =
        storedTheme &&
        storedTheme.savedAt > viewUpdatedAt &&
        !areThemesEqual(storedTheme.theme, viewTheme);
      setActiveViewId(view.id);
      setDashboardLayouts(ensureLayouts(view.layout));
      setDashboardTheme(useStoredTheme ? storedTheme!.theme : viewTheme);
      setWidgetConfig(view.widgets || DEFAULT_WIDGET_CONFIG);
      setDashboardDirty(false);
      setDashboardSaveState("idle");
    },
    [user?.id]
  );

  const refreshDashboardViews = useCallback(
    async (options?: { applyActive?: boolean; force?: boolean }) => {
      if (!user?.id) return null;
      if (dashboardSyncRef.current && !options?.force) return null;
      dashboardSyncRef.current = true;
      try {
        const res = await api.get("/marketplace-dashboard-views/me");
        const entries = Array.isArray(res.data?.data)
          ? (res.data.data as unknown[])
          : [];
        if (!entries.length) {
          await loadDashboardViews();
          return null;
        }
        const views = entries.map(normalizeViewEntry);
        setDashboardViews(views);
        const activeId = activeViewId;
        const activeRemote = views.find((view) => view.id === activeId);
        const fallbackView = views.find((view) => view.isDefault) ?? views[0] ?? null;
        if (!activeRemote) {
          applyViewState(fallbackView);
          return views;
        }
        if (options?.applyActive && !dashboardDirty) {
          const remoteUpdatedAt = Number(
            activeRemote.updatedAt ? new Date(activeRemote.updatedAt).getTime() : 0
          );
          if (remoteUpdatedAt > activeViewUpdatedAtRef.current) {
            applyViewState(activeRemote);
          }
        }
        return views;
      } catch {
        // Silent retry on the next interval.
        return null;
      } finally {
        dashboardSyncRef.current = false;
      }
    },
    [activeViewId, applyViewState, dashboardDirty, loadDashboardViews, user?.id]
  );

  const persistDashboardView = useCallback(async (view: DashboardView) => {
    const viewKey = view.documentId || view.id;
    await api.put(`/marketplace-dashboard-views/${viewKey}`, {
      data: {
        name: view.name,
        isDefault: Boolean(view.isDefault),
        layout: view.layout,
        widgets: view.widgets,
        theme: view.theme,
      },
    });
  }, []);

  const updateDashboardView = useCallback(
    async (viewId: number, payload: Partial<DashboardView>) => {
      if (dashboardSaveBlockedRef.current) return false;
    const existing = dashboardViews.find((view) => view.id === viewId);
    if (!existing) {
      return false;
    }
    const nextView: DashboardView = {
      ...existing,
        ...payload,
        layout: payload.layout ? ensureLayouts(payload.layout) : existing.layout,
        widgets: payload.widgets ?? existing.widgets,
        theme: payload.theme ?? existing.theme,
      };
    try {
      setDashboardViews((prev) =>
        prev.map((view) => (view.id === viewId ? nextView : view))
      );
      await persistDashboardView(nextView);
      return true;
      } catch (err) {
        if (err && typeof err === "object" && "response" in err) {
          const anyErr = err as { response?: { status?: number } };
          if (anyErr.response?.status === 404) {
            dashboardSaveBlockedRef.current = true;
            await loadDashboardViews();
            setDashboardError("Dashboard view not found. Reloaded settings.");
            return false;
          }
        }
        setDashboardError("Unable to save dashboard settings.");
        return false;
      }
    },
    [dashboardViews, loadDashboardViews, persistDashboardView]
  );

  const handleCreateView = useCallback(async () => {
    const name = window.prompt("Name your dashboard view", "New dashboard");
    if (!name) return;
    try {
      const res = await api.post("/marketplace-dashboard-views", {
        data: {
          name: name.trim(),
          isDefault: dashboardViews.length === 0,
          layout: buildDefaultLayouts(),
          widgets: DEFAULT_WIDGET_CONFIG,
          theme: DEFAULT_DASHBOARD_THEME,
        },
      });
      const created = normalizeViewEntry(res.data?.data);
      setDashboardViews((prev) => [created, ...prev]);
      applyViewState(created);
    } catch {
      setDashboardError("Unable to create dashboard view.");
    }
  }, [applyViewState, dashboardViews.length]);

  const handleRenameView = useCallback(() => {
    const view = dashboardViews.find((item) => item.id === activeViewId);
    if (!view) return;
    setRenameValue(view.name);
    setRenameError(null);
    setRenameModalOpen(true);
  }, [activeViewId, dashboardViews]);

  const handleRenameCancel = useCallback(() => {
    if (renameSaving) return;
    setRenameModalOpen(false);
    setRenameError(null);
  }, [renameSaving]);

  const handleRenameSubmit = useCallback(async () => {
    const view = dashboardViews.find((item) => item.id === activeViewId);
    if (!view) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Name is required.");
      return;
    }
    if (trimmed === view.name) {
      setRenameModalOpen(false);
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    const saved = await updateDashboardView(view.id, { name: trimmed });
    setRenameSaving(false);
    if (!saved) {
      setRenameError("Unable to rename this view right now.");
      return;
    }
    const views = await refreshDashboardViews({ applyActive: true, force: true });
    if (views) {
      const updated = views.find((item) => item.id === view.id);
      if (!updated || updated.name !== trimmed) {
        setRenameError("Rename did not persist. Please try again.");
        return;
      }
    }
    setRenameModalOpen(false);
  }, [
    activeViewId,
    dashboardViews,
    refreshDashboardViews,
    renameValue,
    updateDashboardView,
  ]);

  const handleSaveDashboardChanges = useCallback(async () => {
    if (!activeViewId) return;
    const view = dashboardViews.find((item) => item.id === activeViewId);
    if (!view) return;
    const nextView: DashboardView = {
      ...view,
      layout: dashboardLayouts,
      widgets: widgetConfig,
      theme: dashboardTheme,
    };
    setDashboardSaveState("saving");
    setDashboardViews((prev) =>
      prev.map((item) => (item.id === activeViewId ? nextView : item))
    );
    try {
      await persistDashboardView(nextView);
      setDashboardSaveState("saved");
      setDashboardDirty(false);
      if (user?.id) {
        writeStoredDashboardTheme(user.id, activeViewId, dashboardTheme);
      }
      await refreshDashboardViews({ applyActive: true });
    } catch {
      setDashboardSaveState("error");
      setDashboardError("Unable to save dashboard settings.");
    }
  }, [
    activeViewId,
    dashboardLayouts,
    dashboardTheme,
    dashboardViews,
    persistDashboardView,
    refreshDashboardViews,
    user?.id,
    widgetConfig,
  ]);

  const openDeleteView = useCallback(() => {
    const view = dashboardViews.find((item) => item.id === activeViewId);
    if (!view) return;
    if (dashboardViews.length <= 1) {
      setDashboardError("You need at least one dashboard view.");
      return;
    }
    setDeleteError(null);
    setDeleteModalOpen(true);
  }, [activeViewId, dashboardViews]);

  const handleDeleteCancel = useCallback(() => {
    if (deleteSaving) return;
    setDeleteModalOpen(false);
    setDeleteError(null);
  }, [deleteSaving]);

  const handleDeleteConfirm = useCallback(async () => {
    const view = dashboardViews.find((item) => item.id === activeViewId);
    if (!view) return;
    if (dashboardViews.length <= 1) {
      setDeleteError("You need at least one dashboard view.");
      return;
    }
    const remainingViews = dashboardViews.filter((item) => item.id !== view.id);
    const fallbackView =
      remainingViews.find((item) => item.isDefault) ?? remainingViews[0] ?? null;
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      const viewKey = view.documentId || view.id;
      await api.delete(`/marketplace-dashboard-views/${viewKey}`);
      if (view.isDefault && fallbackView) {
        await persistDashboardView({
          ...fallbackView,
          isDefault: true,
          layout: ensureLayouts(fallbackView.layout),
          widgets: fallbackView.widgets ?? DEFAULT_WIDGET_CONFIG,
          theme: fallbackView.theme ?? DEFAULT_DASHBOARD_THEME,
        });
      }
      setDashboardViews(remainingViews);
      if (fallbackView) {
        applyViewState(fallbackView);
      }
      setDashboardDirty(false);
      const views = await refreshDashboardViews({ applyActive: true, force: true });
      if (views && views.some((item) => item.id === view.id)) {
        if (view.documentId) {
          await api.delete(`/marketplace-dashboard-views/${view.documentId}`);
        }
        const retryViews = await refreshDashboardViews({
          applyActive: true,
          force: true,
        });
        if (retryViews && retryViews.some((item) => item.id === view.id)) {
          setDeleteError("Delete did not persist. Please try again.");
          return;
        }
      }
      if (views && view.isDefault && fallbackView) {
        const persistedDefault = views.find((item) => item.isDefault);
        if (!persistedDefault || persistedDefault.id !== fallbackView.id) {
          setDeleteError("Default view update did not persist. Please try again.");
          return;
        }
      }
      setDeleteModalOpen(false);
    } catch {
      setDeleteError("Unable to delete dashboard view.");
    } finally {
      setDeleteSaving(false);
    }
  }, [
    activeViewId,
    applyViewState,
    dashboardViews,
    persistDashboardView,
    refreshDashboardViews,
  ]);

  const handleSetDefaultView = useCallback(async () => {
    const view = dashboardViews.find((item) => item.id === activeViewId);
    if (!view) return;
    if (view.isDefault) return;
    try {
      const saved = await updateDashboardView(view.id, { isDefault: true });
      if (!saved) {
        setDashboardError("Unable to set default dashboard view.");
        return;
      }
      const views = await refreshDashboardViews({ applyActive: true, force: true });
      if (views) {
        const updated = views.find((item) => item.id === view.id);
        if (!updated?.isDefault) {
          setDashboardError("Default view did not persist. Please try again.");
        }
      }
    } catch {
      setDashboardError("Unable to set default dashboard view.");
    }
  }, [activeViewId, dashboardViews, refreshDashboardViews, updateDashboardView]);

  const handleSelectView = useCallback(
    (viewId: number) => {
      const view = dashboardViews.find((item) => item.id === viewId);
      if (view) {
        applyViewState(view);
      }
    },
    [applyViewState, dashboardViews]
  );

  const handleRequestVerification = async () => {
    if (verificationLoading) return;
    setVerificationNotice(null);
    setVerificationError(null);

    setVerificationLoading(true);
    try {
      if (selfVerification?.sellerIdStatus === "verified") {
        setVerificationNotice("Your government ID is already verified.");
        return;
      }
      const res = await api.post("/marketplace-verifications/identity/start");
      const url = res.data?.data?.url as string | undefined;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        setVerificationNotice("Verification opened in a new tab.");
      } else {
        setVerificationNotice("Verification session created.");
      }
      await loadSelfVerification();
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        "Unable to start identity verification.";
      setVerificationError(message);
    } finally {
      setVerificationLoading(false);
    }
  };

  const refreshIdentityStatus = useCallback(async () => {
    try {
      await api.get("/marketplace-verifications/identity/status");
      await loadSelfVerification();
    } catch {
      // Ignore refresh errors; user can retry.
    }
  }, [loadSelfVerification]);

  const updateDraft = (patch: Partial<DraftProduct>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleListingModeChange = (mode: "single" | "bulk") => {
    if (isEditingListing && mode === "bulk") return;
    setListingMode(mode);
    setFormError(null);
    setBulkError(null);
  };

  const updateBulkListing = (id: string, patch: Partial<BulkListingDraft>) => {
    setBulkListings((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, ...patch, error: null } : item
      )
    );
  };

  const handleAddBulkListing = () => {
    setBulkListings((prev) => [...prev, createBulkDraft()]);
  };

  const handleRemoveBulkListing = (id: string) => {
    setBulkListings((prev) => {
      if (prev.length <= 1) return prev;
      const removed = prev.find((item) => item.id === id);
      if (removed) {
        removed.images.forEach((image) => {
          if (image.url.startsWith("blob:")) {
            URL.revokeObjectURL(image.url);
          }
        });
      }
      return prev.filter((item) => item.id !== id);
    });
    setBulkPhotoDragActive((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete bulkPhotoDragDepthRef.current[id];
    if (bulkPhotoInputRefs.current[id]) {
      delete bulkPhotoInputRefs.current[id];
    }
  };

  const handleLocationStateChange = (value: string) => {
    const match = matchByName(stateOptions, value);
    const stateName = match?.name || value;
    const stateCode = match?.code || "";
    updateDraft({
      locationState: stateName,
      locationStateCode: stateCode,
      locationCity: "",
      location: formatLocationLabel("", stateName),
    });
    setCityOptions([]);
  };

  const handleLocationCityChange = (value: string) => {
    updateDraft({
      locationCity: value,
      location: formatLocationLabel(value, draft.locationState),
    });
  };

  const handleBulkStateChange = (id: string, value: string) => {
    const match = matchByName(stateOptions, value);
    const stateName = match?.name || value;
    const stateCode = match?.code || "";
    updateBulkListing(id, {
      locationState: stateName,
      locationStateCode: stateCode,
      locationCity: "",
      location: formatLocationLabel("", stateName),
    });
    if (stateCode && !cityOptionsByState[stateCode]) {
      api
        .get("/locations/cities", { params: { country: "US", state: stateCode } })
        .then((res) => {
          const list = (res.data?.data ?? []).map((city: any) => ({
            name: city.name,
            code: city.name,
          }));
          setCityOptionsByState((prev) => ({ ...prev, [stateCode]: list }));
        })
        .catch(() => null);
    }
  };

  const handleBulkCityChange = (id: string, value: string) => {
    setBulkListings((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              locationCity: value,
              location: formatLocationLabel(value, item.locationState),
            }
          : item
      )
    );
  };

  const handleExitListing = () => {
    setFormError(null);
    if (editingListingId !== null) {
      setEditingListingId(null);
      setEditingListingTitle(null);
      resetListingDraft();
    }
    navigate({ pathname: location.pathname, search: location.search, hash: "" });
  };

  const resetListingDraft = () => {
    draftImagesRef.current.forEach((image) => {
      if (image.url.startsWith("blob:")) {
        URL.revokeObjectURL(image.url);
      }
    });
    setDraft(createEmptyDraft());
    setDraftImages([]);
    setFormError(null);
    setPreviewError(null);
  };

  const handleCancelEditListing = () => {
    if (creatingListing) return;
    setEditingListingId(null);
    setEditingListingTitle(null);
    resetListingDraft();
  };

  const handleEditListing = (listing: StorefrontProduct) => {
    const listingId =
      listing.documentId ?? listing.id ?? listing.rawId ?? null;
    if (listingId === null || listingId === undefined || listingId === "") return;
    const listingKey = String(listingId);
    const locationParts = parseLocationParts(listing.location);
    const matchedState = matchByName(stateOptions, locationParts.state);
    const locationState = matchedState?.name || locationParts.state;
    const locationStateCode = matchedState?.code || matchedState?.name || locationParts.state;
    const existingImages = listing.images.map((url, index) => ({
      id: `existing-${listingKey}-${index}`,
      url,
      mediaId: listing.imageIds?.[index],
    }));

    setListingMode("single");
    setEditingListingId(listingKey);
    setEditingListingTitle(listing.title);
    setDraft({
      ...createEmptyDraft(),
      title: listing.title,
      price: String(listing.price ?? ""),
      category: listing.category || "Electronics",
      condition: listing.condition || "New",
      location: listing.location || "",
      locationCity: locationParts.city,
      locationState,
      locationStateCode,
      description: listing.description || "",
      visibility: listing.visibility === "friends" ? "friends" : "public",
      localPickup: Boolean(listing.localPickup),
      cashAccepted: Boolean(listing.cashAccepted),
      shippingPolicyAccepted:
        typeof listing.shippingPolicyAccepted === "boolean"
          ? listing.shippingPolicyAccepted
          : true,
      feePolicyAccepted:
        typeof listing.feePolicyAccepted === "boolean"
          ? listing.feePolicyAccepted
          : true,
    });
    setDraftImages(existingImages);
    setFormError(null);
    setPreviewError(null);
    if (location.hash !== "#list") {
      navigate({ pathname: location.pathname, hash: "#list" });
    }
  };

  const buildShippingSummary = (value: DraftProduct) => {
    const parts: string[] = [];
    if (value.localPickup) {
      parts.push("Local pickup available");
      if (value.cashAccepted) {
        parts.push("Cash accepted on pickup");
      }
    }
    parts.push("Delivery arranged privately");
    return parts.join(" • ");
  };

  const buildListingPayload = (
    value: DraftProduct,
    options: { feeAccepted: boolean; shippingAccepted: boolean }
  ) => ({
    title: value.title,
    price: Number(value.price),
    category: value.category,
    condition: value.condition,
    location: formatLocationLabel(value.locationCity, value.locationState),
    description: value.description,
    visibility: value.visibility,
    shipping: buildShippingSummary(value),
    shippingEnabled: false,
    shippingCarriers: [],
    shippingInternational: false,
    localPickup: value.localPickup,
    cashAccepted: value.cashAccepted,
    noShippingRequired: true,
    shippingNotes: "",
    shippingPolicyAccepted: options.shippingAccepted,
    shippingPolicyVersion: MARKETPLACE_POLICY_VERSION,
    feePolicyAccepted: options.feeAccepted,
    feePolicyVersion: MARKETPLACE_FEE_VERSION,
    owner: user?.id,
  });

  const validateListing = (
    value: DraftProduct,
    options: {
      requirePhotos?: boolean;
      photos?: DraftImage[];
      feeAccepted?: boolean;
      shippingAccepted?: boolean;
    } = {}
  ) => {
    const priceValue = Number(value.price);
    if (!value.title.trim()) {
      return "Please add a product title.";
    }
    if (value.price === "" || !Number.isFinite(priceValue) || priceValue < 0) {
      return "Please add a valid price.";
    }
    if (!value.category.trim()) {
      return "Please choose a category.";
    }
    if (!value.locationCity.trim() || !value.locationState.trim()) {
      return "Please select a city and state.";
    }
    const shippingAccepted =
      options.shippingAccepted ?? value.shippingPolicyAccepted ?? false;
    if (!shippingAccepted) {
      return "You must accept the delivery & pickup guidance before listing.";
    }
    if (options.feeAccepted === false) {
      return "You must accept the platform fee disclosure before listing.";
    }
    if (value.cashAccepted && !value.localPickup) {
      return "Cash payment requires local pickup.";
    }
    if (value.description.trim().length < 10) {
      return "Add a longer description so buyers understand the listing.";
    }
    if (options.requirePhotos && (!options.photos || options.photos.length === 0)) {
      return "Add at least one photo to publish the listing.";
    }
    return null;
  };

  const uploadListingImages = async (images: DraftImage[]) => {
    const files = images
      .map((image) => image.file)
      .filter((file): file is File => file instanceof File);
    if (!files.length) return [];
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    const uploadRes = await api.post("/upload", formData);
    const uploaded = Array.isArray(uploadRes.data) ? uploadRes.data : [];
    return uploaded
      .map((item: any) => Number(item?.id))
      .filter((id: number) => Number.isFinite(id));
  };

  const addPhotos = (files: FileList | File[]) => {
    const incoming = Array.from(files).map((file) => ({
      id: `${file.name}-${Date.now()}`,
      url: URL.createObjectURL(file),
      file,
    }));
    if (!incoming.length) return;
    setDraftImages((prev) => [...prev, ...incoming]);
  };

  const handleAddPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    addPhotos(event.target.files);
    event.target.value = "";
  };

  const handleRemovePhoto = (id: string) => {
    setDraftImages((prev) => {
      const removed = prev.find((image) => image.id === id);
      if (removed?.url.startsWith("blob:")) {
        URL.revokeObjectURL(removed.url);
      }
      return prev.filter((image) => image.id !== id);
    });
  };

  const addBulkPhotos = (listingId: string, files: FileList | File[]) => {
    const incoming = Array.from(files).map((file) => ({
      id: `${file.name}-${Date.now()}`,
      url: URL.createObjectURL(file),
      file,
    }));
    if (!incoming.length) return;
    setBulkListings((prev) =>
      prev.map((item) =>
        item.id === listingId
          ? { ...item, images: [...item.images, ...incoming], error: null }
          : item
      )
    );
  };

  const handleAddBulkPhotos = (
    listingId: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!event.target.files?.length) return;
    addBulkPhotos(listingId, event.target.files);
    event.target.value = "";
  };

  const handleRemoveBulkPhoto = (listingId: string, photoId: string) => {
    setBulkListings((prev) =>
      prev.map((item) => {
        if (item.id !== listingId) return item;
        const nextImages = item.images.filter((image) => image.id !== photoId);
        const removed = item.images.find((image) => image.id === photoId);
        if (removed?.url.startsWith("blob:")) {
          URL.revokeObjectURL(removed.url);
        }
        return { ...item, images: nextImages };
      })
    );
  };

  const handlePhotoDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    photoDragDepthRef.current += 1;
    setIsPhotoDragActive(true);
  };

  const handlePhotoDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePhotoDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    photoDragDepthRef.current = Math.max(0, photoDragDepthRef.current - 1);
    if (photoDragDepthRef.current === 0) {
      setIsPhotoDragActive(false);
    }
  };

  const handlePhotoDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    photoDragDepthRef.current = 0;
    setIsPhotoDragActive(false);
    if (event.dataTransfer?.files?.length) {
      addPhotos(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  };

  const handleBulkPhotoDragEnter = (
    listingId: string,
    event: DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const currentDepth = bulkPhotoDragDepthRef.current[listingId] ?? 0;
    bulkPhotoDragDepthRef.current[listingId] = currentDepth + 1;
    setBulkPhotoDragActive((prev) => ({ ...prev, [listingId]: true }));
  };

  const handleBulkPhotoDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleBulkPhotoDragLeave = (
    listingId: string,
    event: DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const currentDepth = bulkPhotoDragDepthRef.current[listingId] ?? 0;
    const nextDepth = Math.max(0, currentDepth - 1);
    bulkPhotoDragDepthRef.current[listingId] = nextDepth;
    if (nextDepth === 0) {
      setBulkPhotoDragActive((prev) => {
        if (!prev[listingId]) return prev;
        const next = { ...prev, [listingId]: false };
        return next;
      });
    }
  };

  const handleBulkPhotoDrop = (
    listingId: string,
    event: DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    bulkPhotoDragDepthRef.current[listingId] = 0;
    setBulkPhotoDragActive((prev) => ({ ...prev, [listingId]: false }));
    if (event.dataTransfer?.files?.length) {
      addBulkPhotos(listingId, event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  };

  const handleOpenSinglePreview = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) return;
    setFormError(null);
    const validationError = validateListing(draft, {
      requirePhotos: true,
      photos: draftImagesRef.current,
      feeAccepted: draft.feePolicyAccepted,
      shippingAccepted: draft.shippingPolicyAccepted,
    });
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setPreviewError(null);
    setPreviewMode("single");
  };

  const publishSingleListing = async () => {
    if (!user?.id) return;
    setFormError(null);
    setPreviewError(null);
    const validationError = validateListing(draft, {
      requirePhotos: true,
      photos: draftImagesRef.current,
      feeAccepted: draft.feePolicyAccepted,
      shippingAccepted: draft.shippingPolicyAccepted,
    });
    if (validationError) {
      setFormError(validationError);
      setPreviewError(validationError);
      return;
    }
    setCreatingListing(true);
    try {
      const existingImageIds = draftImagesRef.current
        .map((image) => image.mediaId)
        .filter((id): id is number => Number.isFinite(id));
      const uploadedImageIds = await uploadListingImages(draftImagesRef.current);
      const imageIds = Array.from(
        new Set([...existingImageIds, ...uploadedImageIds])
      ).filter((id) => Number.isFinite(id));
      if (!imageIds.length) {
        throw new Error("Unable to upload listing photos.");
      }
      const payload = buildListingPayload(draft, {
        feeAccepted: draft.feePolicyAccepted,
        shippingAccepted: draft.shippingPolicyAccepted,
      });
      if (isEditingListing && editingListingId !== null) {
        delete (payload as { owner?: number | null }).owner;
        await api.put(`/marketplace-listings/${editingListingId}`, {
          data: { ...payload, images: imageIds },
        });
      } else {
        await api.post("/marketplace-listings", {
          data: { ...payload, images: imageIds },
        });
      }
      draftImagesRef.current.forEach((image) => {
        if (image.url.startsWith("blob:")) {
          URL.revokeObjectURL(image.url);
        }
      });
      setDraft(createEmptyDraft());
      setDraftImages([]);
      setPreviewMode(null);
      setEditingListingId(null);
      setEditingListingTitle(null);
      setPublishSuccess(
        isEditingListing
          ? "Successfully Updated Your Listing"
          : "Successfully Published Your Listing"
      );
      await loadListings();
    } catch (err) {
      setPreviewError(
        isEditingListing
          ? "Unable to update listing. Try again."
          : "Unable to publish listing. Try again."
      );
    } finally {
      setCreatingListing(false);
    }
  };

  const handleOpenBulkPreview = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) return;
    if (!bulkShippingAccepted) {
      setBulkError("You must accept the delivery & pickup guidance before listing.");
      return;
    }
    if (!bulkFeeAccepted) {
      setBulkError("You must accept the platform fee disclosure before listing.");
      return;
    }
    let hasError = false;
    const nextListings = bulkListings.map((item) => {
      const error = validateListing(item, {
        requirePhotos: true,
        photos: item.images,
        feeAccepted: bulkFeeAccepted,
        shippingAccepted: bulkShippingAccepted,
      });
      if (error) {
        hasError = true;
      }
      return { ...item, error };
    });
    setBulkListings(nextListings);
    if (hasError) {
      setBulkError("Fix the highlighted listings before publishing.");
      return;
    }
    setBulkError(null);
    setPreviewError(null);
    setPreviewMode("bulk");
  };

  const publishBulkListings = async () => {
    if (!user?.id) return;
    if (!bulkShippingAccepted) {
      const message = "You must accept the delivery & pickup guidance before listing.";
      setBulkError(message);
      setPreviewError(message);
      return;
    }
    if (!bulkFeeAccepted) {
      const message = "You must accept the platform fee disclosure before listing.";
      setBulkError(message);
      setPreviewError(message);
      return;
    }
    let hasError = false;
    const nextListings = bulkListingsRef.current.map((item) => {
      const error = validateListing(item, {
        requirePhotos: true,
        photos: item.images,
        feeAccepted: bulkFeeAccepted,
        shippingAccepted: bulkShippingAccepted,
      });
      if (error) {
        hasError = true;
      }
      return { ...item, error };
    });
    setBulkListings(nextListings);
    if (hasError) {
      const message = "Fix the highlighted listings before publishing.";
      setBulkError(message);
      setPreviewError(message);
      return;
    }
    setBulkError(null);
    setPreviewError(null);
    setCreatingBulk(true);
    try {
      for (const item of nextListings) {
        const uploadedImageIds = await uploadListingImages(item.images);
        if (!uploadedImageIds.length) {
          throw new Error("Unable to upload listing photos.");
        }
        await api.post("/marketplace-listings", {
          data: {
            ...buildListingPayload(item, {
              feeAccepted: bulkFeeAccepted,
              shippingAccepted: bulkShippingAccepted,
            }),
            images: uploadedImageIds,
          },
        });
      }
      nextListings.forEach((item) => {
        item.images.forEach((image) => {
          if (image.url.startsWith("blob:")) {
            URL.revokeObjectURL(image.url);
          }
        });
      });
      setBulkListings([createBulkDraft()]);
      setBulkPhotoDragActive({});
      bulkPhotoDragDepthRef.current = {};
      setBulkShippingAccepted(false);
      setBulkFeeAccepted(false);
      setPreviewMode(null);
      setPublishSuccess(
        `Successfully Published Your Listing${nextListings.length === 1 ? "" : "s"}`
      );
      await loadListings();
    } catch (err) {
      const message = "Unable to publish listings. Try again.";
      setBulkError(message);
      setPreviewError(message);
    } finally {
      setCreatingBulk(false);
    }
  };

  const closePreviewModal = () => {
    if (creatingListing || creatingBulk) return;
    setPreviewMode(null);
    setPreviewError(null);
  };

  const handlePreviewEdit = () => {
    closePreviewModal();
  };

  const handlePreviewDeleteSingle = () => {
    if (isEditingListing && editingListing) {
      openListingDeleteModal(editingListing);
      setPreviewMode(null);
      setPreviewError(null);
      return;
    }
    draftImagesRef.current.forEach((image) => {
      if (image.url.startsWith("blob:")) {
        URL.revokeObjectURL(image.url);
      }
    });
    setDraft(createEmptyDraft());
    setDraftImages([]);
    setFormError(null);
    closePreviewModal();
  };

  const handlePreviewDeleteBulk = (id: string) => {
    handleRemoveBulkListing(id);
  };

  const handlePreviewChangeSinglePhotos = () => {
    singlePhotoInputRef.current?.click();
  };

  const handlePreviewChangeBulkPhotos = (id: string) => {
    bulkPhotoInputRefs.current[id]?.click();
  };

  const openListingDeleteModal = (listing: StorefrontProduct) => {
    setListingDeleteTarget(listing);
    setListingDeleteError(null);
  };

  const closeListingDeleteModal = () => {
    if (listingDeleteSaving) return;
    setListingDeleteTarget(null);
    setListingDeleteError(null);
  };

  const confirmDeleteListing = async () => {
    if (!listingDeleteTarget) return;
    const listingId =
      listingDeleteTarget.documentId ??
      listingDeleteTarget.id ??
      listingDeleteTarget.rawId;
    if (listingId === null || listingId === undefined || listingId === "") {
      console.warn("Delete listing aborted: missing listing id", {
        listingId,
        listing: listingDeleteTarget,
      });
      return;
    }
    setListingDeleteSaving(true);
    setListingDeleteError(null);
    try {
      await api.delete(`/marketplace-listings/${listingId}`);
      if (editingListingId !== null && String(editingListingId) === String(listingId)) {
        setEditingListingId(null);
        setEditingListingTitle(null);
        resetListingDraft();
      }
      setListingDeleteTarget(null);
      await loadListings();
    } catch (err) {
      console.error("Delete listing failed", {
        listingId,
        listing: listingDeleteTarget,
        status: (err as any)?.response?.status,
        data: (err as any)?.response?.data,
        message: (err as Error)?.message,
      });
      setListingDeleteError("Unable to delete listing. Please try again.");
    } finally {
      setListingDeleteSaving(false);
    }
  };

  const handleClosePublishSuccess = () => {
    setPublishSuccess(null);
  };

  useEffect(() => {
    draftImagesRef.current = draftImages;
  }, [draftImages]);

  useEffect(() => {
    bulkListingsRef.current = bulkListings;
  }, [bulkListings]);

  useEffect(() => {
    return () => {
      draftImagesRef.current.forEach((image) => {
        if (image.url.startsWith("blob:")) {
          URL.revokeObjectURL(image.url);
        }
      });
      bulkListingsRef.current.forEach((item) => {
        item.images.forEach((image) => {
          if (image.url.startsWith("blob:")) {
            URL.revokeObjectURL(image.url);
          }
        });
      });
    };
  }, []);

  useEffect(() => {
    void loadListings();
    void loadOffers();
    void loadSelfVerification();
    void loadOrders();
    void loadDisputes();
    void loadMessages();
    void loadDashboardViews();
  }, [
    loadListings,
    loadOffers,
    loadSelfVerification,
    loadOrders,
    loadDisputes,
    loadMessages,
    loadDashboardViews,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user?.id || isListingView) return;
    const syncIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshDashboardViews({ applyActive: !customizeOpen && !dashboardDirty });
    };
    const intervalId = window.setInterval(syncIfVisible, DASHBOARD_SYNC_INTERVAL);
    window.addEventListener("visibilitychange", syncIfVisible);
    window.addEventListener("focus", syncIfVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("visibilitychange", syncIfVisible);
      window.removeEventListener("focus", syncIfVisible);
    };
  }, [customizeOpen, dashboardDirty, isListingView, refreshDashboardViews, user?.id]);

  useEffect(() => {
    setSellerDashboardMockEnabled(readSellerDashboardMockEnabled(user?.id ?? null));
    setSellerDashboardMockData(readSellerDashboardMockData(user?.id ?? null));
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      setSellerDashboardMockEnabled(readSellerDashboardMockEnabled(user?.id ?? null));
      setSellerDashboardMockData(readSellerDashboardMockData(user?.id ?? null));
    };
    const enabledKey = buildSellerDashboardMockEnabledKey(user?.id ?? null);
    const dataKey = buildSellerDashboardMockDataKey(user?.id ?? null);
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === enabledKey ||
        event.key === dataKey ||
        event.key === SELLER_DASHBOARD_MOCK_ENABLED_KEY ||
        event.key === SELLER_DASHBOARD_MOCK_DATA_KEY
      ) {
        sync();
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("storefront:seller-dashboard-mock-updated", sync as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "storefront:seller-dashboard-mock-updated",
        sync as EventListener
      );
    };
  }, [user?.id]);

  useEffect(() => {
    if (!selfVerification) return;
    setPayoutEmail(selfVerification.payoutEmail || "");
  }, [selfVerification]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("identity") !== "return") return;
    void refreshIdentityStatus();
    params.delete("identity");
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : "",
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate, refreshIdentityStatus]);

  useEffect(() => {
    if (layoutSaveRef.current) {
      window.clearTimeout(layoutSaveRef.current);
      layoutSaveRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!dashboardReadyRef.current) return;
    if (!activeViewId) return;
    if (dashboardDirty) {
      setDashboardSaveState("idle");
    }
  }, [activeViewId, dashboardDirty]);

  const isMockMode = Boolean(
    customizeOpen && sellerDashboardMockEnabled && sellerDashboardMockData
  );

  const dashboardProducts = useMemo(
    () =>
      isMockMode && sellerDashboardMockData?.listings?.length
        ? sellerDashboardMockData.listings
        : products,
    [isMockMode, products, sellerDashboardMockData?.listings]
  );

  const dashboardOffers = useMemo(
    () =>
      isMockMode && sellerDashboardMockData?.offers?.length
        ? sellerDashboardMockData.offers
        : offers,
    [isMockMode, offers, sellerDashboardMockData?.offers]
  );

  const dashboardOrders = useMemo(
    () =>
      isMockMode && sellerDashboardMockData?.orders?.length
        ? sellerDashboardMockData.orders
        : orders,
    [isMockMode, orders, sellerDashboardMockData?.orders]
  );

  const dashboardMessages = useMemo(
    () =>
      isMockMode && sellerDashboardMockData?.messages?.length
        ? sellerDashboardMockData.messages
        : messages,
    [isMockMode, messages, sellerDashboardMockData?.messages]
  );

  const dashboardDisputes = useMemo(
    () =>
      isMockMode && sellerDashboardMockData?.disputes?.length
        ? sellerDashboardMockData.disputes
        : disputes,
    [isMockMode, disputes, sellerDashboardMockData?.disputes]
  );

  const sellerVerificationItems = useMemo(
    () =>
      buildSellerVerification(
        isMockMode ? sellerDashboardMockData?.verification ?? null : selfVerification
      ),
    [isMockMode, sellerDashboardMockData?.verification, selfVerification]
  );


  const sellerListings = useMemo(
    () => dashboardProducts.filter((product) => product.seller.userId === user?.id),
    [dashboardProducts, user?.id]
  );

  const verificationSource = isMockMode
    ? sellerDashboardMockData?.verification ?? null
    : selfVerification;

  const setupChecklist = useMemo<SetupChecklistItem[]>(() => {
    const idStatus = normalizeStatus(verificationSource?.sellerIdStatus);
    const payoutStatus = normalizeStatus(verificationSource?.sellerPayoutStatus);
    const payoutHasMethod = Boolean(
      verificationSource?.paypalMerchantIdInPayPal ||
        verificationSource?.payoutEmail ||
        payoutEmail.trim()
    );
    const identityState = idStatus === "verified" ? "done" : "pending";
    const payoutState =
      payoutStatus === "verified"
        ? "done"
        : payoutHasMethod
        ? "pending"
        : "required";
    return [
      {
        id: "listing",
        label: "Publish your first listing",
        status: sellerListings.length > 0 ? "done" : "required",
      },
      {
        id: "identity",
        label: "Optional verification (earn badge)",
        status: identityState,
      },
      {
        id: "payout",
        label: "Add payout method",
        status: payoutState,
      },
    ];
  }, [
    payoutEmail,
    sellerListings.length,
    verificationSource?.payoutEmail,
    verificationSource?.sellerIdStatus,
    verificationSource?.sellerPayoutStatus,
  ]);

  const sellerListingIds = useMemo(
    () =>
      new Set(
        sellerListings
          .map((listing) => Number(listing.rawId ?? listing.id))
          .filter((id) => Number.isFinite(id))
      ),
    [sellerListings]
  );

  const offersForSeller = useMemo(
    () =>
      dashboardOffers.filter((offer) => sellerListingIds.has(Number(offer.listingId || 0))),
    [dashboardOffers, sellerListingIds]
  );

  const activeView = useMemo(
    () => dashboardViews.find((view) => view.id === activeViewId) ?? null,
    [activeViewId, dashboardViews]
  );

  useEffect(() => {
    activeViewUpdatedAtRef.current = Number(
      activeView?.updatedAt ? new Date(activeView.updatedAt).getTime() : 0
    );
  }, [activeView?.updatedAt]);

  useEffect(() => {
    if (dashboardSaveState !== "saved") return;
    if (typeof window === "undefined") return;
    const timeoutId = window.setTimeout(() => {
      setDashboardSaveState("idle");
    }, 2000);
    return () => window.clearTimeout(timeoutId);
  }, [dashboardSaveState]);

  useEffect(() => {
    setDashboardSaveState("idle");
  }, [activeViewId]);

  const hiddenWidgets = widgetConfig.hidden ?? [];
  const widgetStyles = widgetConfig.styles ?? {};

  const sellerOrders = useMemo(
    () => dashboardOrders.filter((order) => Number(order.sellerId) === Number(user?.id || 0)),
    [dashboardOrders, user?.id]
  );

  const buyerPayments = useMemo(
    () => sellerOrders.filter((order) => ["paid", "approved"].includes(order.status)),
    [sellerOrders]
  );

  const totalEarningsValue = useMemo(
    () =>
      sellerOrders.reduce((sum, order) => sum + (order.net || order.amount || 0), 0),
    [sellerOrders]
  );

  const earningsSeries = useMemo(() => {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const rangeDays = revenueRange;
    const start = new Date(now.getTime() - rangeDays * dayMs);
    start.setHours(0, 0, 0, 0);
    const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const buckets: Array<{ key: string; label: string; total: number }> = [];
    let cursor = new Date(startMonth);
    while (cursor <= endMonth) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      buckets.push({
        key,
        label: cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        total: 0,
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    const totals = new Map<string, number>();
    sellerOrders.forEach((order) => {
      const date = new Date(order.createdAt);
      if (Number.isNaN(date.getTime()) || date < start) return;
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      totals.set(key, (totals.get(key) || 0) + (order.net || order.amount || 0));
    });

    return buckets.map((bucket) => ({
      label: bucket.label,
      total: totals.get(bucket.key) || 0,
    }));
  }, [revenueRange, sellerOrders]);

  const earningsSparkMax = useMemo(
    () => Math.max(...earningsSeries.map((point) => point.total), 1),
    [earningsSeries]
  );

  const payoutPending = useMemo(
    () =>
      sellerOrders.filter((order) => order.payoutStatus === "pending"),
    [sellerOrders]
  );

  const pendingPayoutAmount = useMemo(
    () =>
      payoutPending.reduce((sum, order) => sum + (order.net || order.amount || 0), 0),
    [payoutPending]
  );

  const availableBalance = Math.max(0, totalEarningsValue - pendingPayoutAmount);

  const openOrders = useMemo(
    () =>
      sellerOrders.filter((order) =>
        ["completed", "delivered", "cancelled", "refunded"].every(
          (status) => status !== String(order.status || "").toLowerCase()
        )
      ),
    [sellerOrders]
  );

  const conversionRate = useMemo(() => {
    const base = sellerListings.length;
    if (!base) return 0;
    return (sellerOrders.length / base) * 100;
  }, [sellerListings.length, sellerOrders.length]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { title: string; total: number; count: number }>();
    sellerOrders.forEach((order) => {
      const key = order.listingTitle || "Listing";
      const current = map.get(key) || { title: key, total: 0, count: 0 };
      current.total += order.net || order.amount || 0;
      current.count += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [sellerOrders]);

  const openDisputes = useMemo(
    () =>
      dashboardDisputes.filter((dispute) =>
        ["open", "under_review"].includes(dispute.status)
      ),
    [dashboardDisputes]
  );

  const displayListingsLoading = !isMockMode && loadingListings;
  const displayListingError = !isMockMode ? listingError : null;
  const displayOfferLoading = !isMockMode && offerLoading;
  const displayOfferError = !isMockMode ? offerError : null;
  const displayOrdersLoading = !isMockMode && ordersLoading;
  const displayOrdersError = !isMockMode ? ordersError : null;
  const displayMessagesLoading = !isMockMode && messagesLoading;
  const displayMessagesError = !isMockMode ? messagesError : null;
  const displayDisputesLoading = !isMockMode && disputesLoading;
  const displayDisputesError = !isMockMode ? disputesError : null;

  const dashboardStyle = useMemo(() => {
    return {
      background: toRgba(dashboardTheme.pageBg, dashboardTheme.pageOpacity),
      "--dashboard-card-bg": toRgba(dashboardTheme.cardBg, dashboardTheme.cardOpacity),
      "--seller-card-bg": toRgba(dashboardTheme.cardBg, dashboardTheme.cardOpacity),
      "--dashboard-accent": dashboardTheme.accent,
    } as CSSProperties;
  }, [dashboardTheme]);

  const sellerDisplayName = useMemo(() => {
    const name = `${String(profile?.firstName || "").trim()} ${String(
      profile?.lastName || ""
    ).trim()}`.trim();
    if (name) return name;
    if (profile?.handle) return profile.handle;
    if (user?.username) return user.username;
    if (user?.email) return user.email.split("@")[0];
    return "Seller";
  }, [profile?.firstName, profile?.handle, profile?.lastName, user?.email, user?.username]);

  const nextChecklistItem =
    setupChecklist.find((item) => item.status !== "done") ?? null;
  const allWidgetsSelected = DASHBOARD_WIDGET_IDS.every(
    (id) => !hiddenWidgets.includes(id)
  );
  const noWidgetsSelected = DASHBOARD_WIDGET_IDS.every((id) =>
    hiddenWidgets.includes(id)
  );

  const handleSetupAction = (id: SetupChecklistItem["id"]) => {
    if (id === "listing") {
      navigate("/storefront/seller#list");
      return;
    }
    if (id === "identity") {
      void handleRequestVerification();
      return;
    }
    if (id === "payout") {
      navigate("/storefront/payment-methods");
    }
  };

  const baseCardBg = useMemo(
    () => toRgba(dashboardTheme.cardBg, dashboardTheme.cardOpacity),
    [dashboardTheme]
  );

  const markDashboardDirty = useCallback(() => {
    setDashboardDirty(true);
    setDashboardSaveState("idle");
  }, []);

  const updateDashboardTheme = useCallback(
    (patch: Partial<DashboardTheme>) => {
      markDashboardDirty();
      setDashboardTheme((prev) => ({ ...prev, ...patch }));
    },
    [markDashboardDirty]
  );

  const handleResetDashboardTheme = useCallback(() => {
    markDashboardDirty();
    setDashboardTheme(DEFAULT_DASHBOARD_THEME);
  }, [markDashboardDirty]);

  const handleToggleWidget = useCallback((id: string) => {
    markDashboardDirty();
    setWidgetConfig((prev) => {
      const hidden = new Set(prev.hidden ?? []);
      if (hidden.has(id)) hidden.delete(id);
      else hidden.add(id);
      return { ...prev, hidden: Array.from(hidden) };
    });
  }, [markDashboardDirty]);

  const handleSelectAllWidgets = useCallback(() => {
    markDashboardDirty();
    setWidgetConfig((prev) => ({ ...prev, hidden: [] }));
  }, [markDashboardDirty]);

  const handleSelectNoneWidgets = useCallback(() => {
    markDashboardDirty();
    setWidgetConfig((prev) => ({ ...prev, hidden: [...DASHBOARD_WIDGET_IDS] }));
  }, [markDashboardDirty]);

  const handleWidgetStyleChange = useCallback(
    (id: string, patch: DashboardWidgetStyle) => {
      markDashboardDirty();
      setWidgetConfig((prev) => ({
        ...prev,
        styles: {
          ...(prev.styles || {}),
          [id]: { ...(prev.styles?.[id] || {}), ...patch },
        },
      }));
    },
    [markDashboardDirty]
  );

  const getWidgetBackground = useCallback(
    (id: string) => {
      const style = widgetStyles[id];
      if (!style?.color) return baseCardBg;
      return toRgba(style.color, style.opacity ?? dashboardTheme.cardOpacity);
    },
    [baseCardBg, dashboardTheme.cardOpacity, widgetStyles]
  );

  const buildCardStyle = useCallback(
    (id?: string) => {
      const background = id ? getWidgetBackground(id) : baseCardBg;
      return {
        "--seller-card-bg": background,
        backgroundColor: background,
      } as CSSProperties;
    },
    [baseCardBg, getWidgetBackground]
  );

  const renderWidgetContent = (widgetId: string) => {
    switch (widgetId) {
      case "totalEarnings": {
        const maxEarnings = Math.max(...earningsSeries.map((point) => point.total), 1);
        const pointCount = earningsSeries.length || 1;
        const linePoints = earningsSeries.map((point, index) => {
          const x = pointCount === 1 ? 50 : (index / (pointCount - 1)) * 100;
          const y = 100 - (point.total / maxEarnings) * 100;
          return { x, y, label: point.label, total: point.total };
        });
        const linePath = linePoints
          .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
          .join(" ");
        const areaPath =
          linePoints.length > 0
            ? `${linePath} L ${linePoints[linePoints.length - 1].x} 100 L ${
                linePoints[0].x
              } 100 Z`
            : "";
        const yTicks = [maxEarnings, maxEarnings * 0.5, 0];
        const hasSales = sellerOrders.length > 0;
        return (
          <div className="storefront-widget-metric storefront-widget-metric--revenue">
            <h2>{formatCurrency(totalEarningsValue, "USD")}</h2>
            <p>{sellerOrders.length} orders to date</p>
            <div
              className="storefront-earnings-line"
              role="img"
              aria-label={`Revenue trend over the last ${revenueRange} days`}
            >
              <div className="storefront-earnings-y">
                {yTicks.map((value, index) => (
                  <span key={`y-${index}`}>{formatCurrency(value, "USD")}</span>
                ))}
                <span className="storefront-earnings-y-label">Total revenue</span>
              </div>
              <div className="storefront-earnings-canvas">
                <svg
                  className="storefront-earnings-svg"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <g className="storefront-earnings-grid">
                    {[0, 25, 50, 75, 100].map((y) => (
                      <line key={`grid-${y}`} x1="0" x2="100" y1={y} y2={y} />
                    ))}
                  </g>
                  {areaPath && <path className="storefront-earnings-area" d={areaPath} />}
                  {linePath && <path className="storefront-earnings-line-path" d={linePath} />}
                  {linePoints.map((point, index) => (
                    <circle
                      key={`pt-${index}`}
                      className="storefront-earnings-dot"
                      cx={point.x}
                      cy={point.y}
                      r="1.6"
                    />
                  ))}
                </svg>
                <div
                  className="storefront-earnings-x"
                  style={{ gridTemplateColumns: `repeat(${pointCount}, minmax(0, 1fr))` }}
                >
                  {earningsSeries.map((point, index) => (
                    <span key={`x-${index}`}>{point.label}</span>
                  ))}
                </div>
              </div>
              {!hasSales && (
                <div className="storefront-earnings-empty">
                  <strong>No sales data yet.</strong>
                  <p>Once you make sales, you'll see your revenue here.</p>
                  <button
                    className="btn primary small"
                    type="button"
                    onClick={() => navigate("/storefront/seller#list")}
                  >
                    Create your first listing
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      }
      case "buyerPayments":
        {
          const isEmpty =
            !displayOrdersLoading && !displayOrdersError && buyerPayments.length === 0;
          return (
            <div className="storefront-widget-list">
              {displayOrdersLoading && <p>Loading payments…</p>}
              {displayOrdersError && <p>{displayOrdersError}</p>}
              {isEmpty && (
                <div className="seller-empty">
                  <p>No payments yet.</p>
                  <button
                    className="btn primary small"
                    type="button"
                    onClick={() => navigate("/storefront/seller#list")}
                  >
                    Create your first listing
                  </button>
                </div>
              )}
              {!isEmpty &&
                buyerPayments.slice(0, 4).map((order) => (
                  <div key={order.id} className="storefront-widget-row">
                    <span>{order.listingTitle}</span>
                    <strong>{formatCurrency(order.amount, order.currency)}</strong>
                  </div>
                ))}
            </div>
          );
        }
      case "payouts":
        {
          const isEmpty = payoutPending.length === 0;
          return (
            <div className="storefront-widget-list">
              {!isEmpty && <p>{payoutPending.length} pending payouts</p>}
              {isEmpty && (
                <div className="seller-empty">
                  <p>No pending payouts.</p>
                  <button
                    className="btn secondary small"
                    type="button"
                    onClick={() => handleSetupAction("payout")}
                  >
                    Add payout method
                  </button>
                </div>
              )}
              {!isEmpty &&
                payoutPending.slice(0, 4).map((order) => (
                  <div key={order.id} className="storefront-widget-row">
                    <span>{order.listingTitle}</span>
                    <strong>{formatCurrency(order.net, order.currency)}</strong>
                  </div>
                ))}
            </div>
          );
        }
      case "orders":
        {
          const isEmpty =
            !displayOrdersLoading && !displayOrdersError && sellerOrders.length === 0;
          return (
            <div className="storefront-widget-list">
              {displayOrdersLoading && <p>Loading orders…</p>}
              {displayOrdersError && <p>{displayOrdersError}</p>}
              {isEmpty && (
                <div className="seller-empty">
                  <p>No orders yet.</p>
                  <button
                    className="btn primary small"
                    type="button"
                    onClick={() => navigate("/storefront/seller#list")}
                  >
                    Create your first listing
                  </button>
                </div>
              )}
              {!isEmpty &&
                sellerOrders.slice(0, 4).map((order) => (
                  <div key={order.id} className="storefront-widget-row">
                    <span>{order.listingTitle}</span>
                    <div className="seller-row-meta">
                      <strong>{formatCurrency(order.amount, order.currency)}</strong>
                      <span className={`seller-status-chip ${getStatusTone(order.status)}`}>
                        {order.status}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          );
        }
      case "activeListings":
        {
          const isEmpty =
            !displayListingsLoading &&
            !displayListingError &&
            sellerListings.length === 0;
          return (
            <div className="storefront-widget-list">
              {displayListingsLoading && <p>Loading listings…</p>}
              {displayListingError && <p>{displayListingError}</p>}
              {isEmpty && (
                <div className="seller-empty">
                  <p>No active listings.</p>
                  <button
                    className="btn primary small"
                    type="button"
                    onClick={() => navigate("/storefront/seller#list")}
                  >
                    Create listing
                  </button>
                </div>
              )}
              {!isEmpty &&
                sellerListings.slice(0, 4).map((listing) => (
                  <div
                    key={listing.id}
                    className="storefront-widget-row storefront-widget-row--listing"
                  >
                    <div className="seller-row-main">
                      <span>{listing.title}</span>
                      <span className="seller-row-sub">
                        {listing.location || "Location not set"}
                      </span>
                    </div>
                    <div className="seller-row-actions">
                      <strong>{formatPrice(listing.price)}</strong>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleEditListing(listing)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn danger small"
                        type="button"
                        onClick={() => openListingDeleteModal(listing)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          );
        }
      case "offers":
        {
          const isEmpty =
            !displayOfferLoading && !displayOfferError && offersForSeller.length === 0;
          return (
            <div className="storefront-widget-list">
              {displayOfferLoading && <p>Loading offers…</p>}
              {displayOfferError && <p>{displayOfferError}</p>}
              {isEmpty && (
                <div className="seller-empty">
                  <p>No offers yet.</p>
                  <button
                    className="btn secondary small"
                    type="button"
                    disabled={!storefrontEnabled}
                    aria-disabled={!storefrontEnabled}
                    onClick={() => {
                      if (!storefrontEnabled) return;
                      navigate("/storefront");
                    }}
                  >
                    {storefrontEnabled ? "Share your StoreFront" : "StoreFront disabled"}
                  </button>
                </div>
              )}
              {!isEmpty &&
                offersForSeller.slice(0, 4).map((offer) => (
                  <div key={offer.id} className="storefront-widget-row">
                    <span>{offer.buyerName}</span>
                    <div className="seller-row-meta">
                      <strong>{formatCurrency(offer.offeredPrice, offer.currency)}</strong>
                      <span className={`seller-status-chip ${getStatusTone(offer.status)}`}>
                        {offer.status}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          );
        }
      case "messages":
        return (
          <div className="storefront-message-stack">
            <div className="storefront-message-summary">
              <div>
                <h4>
                  {displayMessagesLoading
                    ? "Loading messages…"
                    : displayMessagesError
                    ? "Messages unavailable"
                    : dashboardMessages.length === 0
                    ? "No messages"
                    : "Recent messages"}
                </h4>
                <p>
                  {displayMessagesError
                    ? displayMessagesError
                    : "Once chats start, you will see buyer conversations here."}
                </p>
              </div>
              <span className="storefront-message-badge">
                {dashboardMessages.length} total
              </span>
            </div>
            {dashboardMessages.length > 0 && (
              <div className="storefront-message-list">
                {dashboardMessages.slice(0, 3).map((message) => (
                  <div key={message.id} className="storefront-widget-row">
                    <span>{message.listingTitle || "Listing chat"}</span>
                    <strong>{message.senderName}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="storefront-message-actions">
              <button
                className="btn secondary small"
                type="button"
                onClick={() => navigate("/storefront/seller#list")}
              >
                Create a listing
              </button>
            </div>
          </div>
        );
      case "verification":
        return (() => {
          const idItem = sellerVerificationItems.find(
            (item) => item.label.toLowerCase() === "government id"
          );
          const payoutItem = sellerVerificationItems.find(
            (item) => item.label.toLowerCase() === "payout method"
          );
          const activityItem = sellerVerificationItems.find(
            (item) => item.label.toLowerCase() === "activity history"
          );
          const idStatus = idItem?.status || "required";
          const isIdVerified = idStatus === "verified";
          const stripeStatus = selfVerification?.stripeIdentityStatus;
            const idTitle =
              idStatus === "verified"
                ? "Government ID verified"
                : idStatus === "pending"
                ? "Government ID pending"
                : "Government ID optional";
            const pendingCopy =
              stripeStatus === "requires_input"
                ? "Finish the secure Stripe verification to earn your verified badge."
                : stripeStatus === "processing"
                ? "Your documents are being reviewed."
                : "Verification is in progress.";
            const idCopy =
              idStatus === "verified"
                ? "Your identity is verified."
                : idStatus === "pending"
                ? pendingCopy
                : "Verify your government-issued ID to earn a verified seller badge on your listings.";
          const actionLabel =
            idStatus === "pending" && stripeStatus === "requires_input"
              ? "Continue verification"
              : "Verify now";
          return (
            <div className="storefront-verification">
              <div
                className={`storefront-verification-alert ${
                  isIdVerified ? "is-verified" : "is-unverified"
                }`}
              >
                <div>
                  <span
                    className={`storefront-verification-pill ${
                      isIdVerified ? "is-verified" : "is-unverified"
                    }`}
                  >
                    {idTitle}
                  </span>
                  <p>{idCopy}</p>
                  {verificationNotice && (
                    <p className="storefront-verification-note">{verificationNotice}</p>
                  )}
                  {verificationError && (
                    <p className="storefront-verification-error">{verificationError}</p>
                  )}
                  {!isIdVerified && (
                    <button
                      className="btn danger small"
                      type="button"
                      onClick={handleRequestVerification}
                      disabled={verificationLoading}
                    >
                      {verificationLoading ? "Starting..." : actionLabel}
                    </button>
                  )}
                </div>
                <div className="storefront-verification-art" aria-hidden="true">
                  <div
                    className={`storefront-verification-icon ${
                      isIdVerified ? "is-verified" : "is-unverified"
                    }`}
                  >
                    {isIdVerified ? "✓" : "✕"}
                  </div>
                </div>
              </div>
              <div className="storefront-verification-list">
                  {[payoutItem, activityItem].filter(Boolean).map((item) => {
                    const statusLabel = item?.status || "optional";
                    return (
                      <div key={item?.label} className="storefront-widget-row">
                        <span>{item?.label}</span>
                        <strong>{statusLabel}</strong>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })();
      case "topProducts":
        return (
          <div className="storefront-widget-list">
            {topProducts.length === 0 && <p>No sales data yet.</p>}
            {topProducts.map((product) => (
              <div key={product.title} className="storefront-widget-row">
                <span>{product.title}</span>
                <strong>{formatCurrency(product.total, "USD")}</strong>
              </div>
            ))}
          </div>
        );
      case "buyerDisputes":
        {
          const isEmpty =
            !displayDisputesLoading && !displayDisputesError && openDisputes.length === 0;
          return (
            <div className="storefront-widget-list">
              {displayDisputesLoading && <p>Loading disputes…</p>}
              {displayDisputesError && <p>{displayDisputesError}</p>}
              {isEmpty && (
                <div className="seller-empty">
                  <p>No open cases.</p>
                  <button
                    className="btn secondary small"
                    type="button"
                    disabled={!storefrontEnabled}
                    aria-disabled={!storefrontEnabled}
                    onClick={() => {
                      if (!storefrontEnabled) return;
                      navigate("/storefront");
                    }}
                  >
                    {storefrontEnabled ? "View StoreFront" : "StoreFront disabled"}
                  </button>
                </div>
              )}
              {!isEmpty &&
                openDisputes.slice(0, 4).map((dispute) => (
                  <div key={dispute.id} className="storefront-widget-row">
                    <span>{dispute.listingTitle}</span>
                    <span className={`seller-status-chip ${getStatusTone(dispute.status)}`}>
                      {dispute.status}
                    </span>
                  </div>
                ))}
            </div>
          );
        }
      default:
        return null;
    }
  };

  const listingPanel = (
    <div
      id="list"
      className={`storefront-panel storefront-form-panel${isListingView ? " is-primary" : ""}`}
    >
      <div className="storefront-panel-header">
        <div>
          <p className="storefront-panel-eyebrow">Listing tools</p>
          <h3>List a product</h3>
        </div>
        <span className="storefront-fee-note">3% platform fee</span>
      </div>
      <div className="storefront-listing-mode" role="tablist" aria-label="Listing mode">
        <button
          type="button"
          className={listingMode === "single" ? "is-active" : ""}
          onClick={() => handleListingModeChange("single")}
          aria-pressed={listingMode === "single"}
        >
          Single listing
        </button>
        <button
          type="button"
          className={listingMode === "bulk" ? "is-active" : ""}
          onClick={() => handleListingModeChange("bulk")}
          aria-pressed={listingMode === "bulk"}
          disabled={isEditingListing}
        >
          Bulk listing
        </button>
      </div>
      {isEditingListing && (
        <div className="storefront-edit-banner">
          <div>
            <span className="storefront-edit-label">Editing listing</span>
            <strong>{editingListingTitle || "Listing"}</strong>
          </div>
          <button
            className="btn ghost small"
            type="button"
            onClick={handleCancelEditListing}
            disabled={creatingListing}
          >
            Cancel edit
          </button>
        </div>
      )}
      {listingMode === "single" ? (
        <form
          className="storefront-form storefront-form--bulk"
          onSubmit={handleOpenSinglePreview}
        >
          <div className="storefront-bulk-list">
            <div className="storefront-bulk-card">
              <div className="storefront-bulk-header">
                <div>
                  <p className="storefront-panel-eyebrow">Listing 1</p>
                  <h4>Details</h4>
                </div>
              </div>
              <div className="storefront-bulk-grid">
                <div className="storefront-field">
                  <label>Title</label>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(event) => updateDraft({ title: event.target.value })}
                    placeholder="e.g. Vintage camera kit"
                  />
                </div>
                <div className="storefront-field">
                  <label>Price</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.price}
                    onChange={(event) => updateDraft({ price: event.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="storefront-field">
                  <label>Category</label>
                  <select
                    value={draft.category}
                    onChange={(event) => updateDraft({ category: event.target.value })}
                  >
                    {CATEGORY_OPTIONS.filter((option) => option !== "All").map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="storefront-field">
                  <label>Condition</label>
                  <select
                    value={draft.condition}
                    onChange={(event) => updateDraft({ condition: event.target.value })}
                  >
                    {CONDITION_OPTIONS.filter((option) => option !== "Any").map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="storefront-field">
                  <label>Visibility</label>
                  <select
                    value={draft.visibility}
                    onChange={(event) =>
                      updateDraft({
                        visibility: event.target.value as DraftProduct["visibility"],
                      })
                    }
                  >
                    <option value="public">Public</option>
                    <option value="friends">Friends only</option>
                  </select>
                </div>
                <div className="storefront-field">
                  <label>State</label>
                  <select
                    value={draft.locationStateCode || draft.locationState || ""}
                    onChange={(event) => handleLocationStateChange(event.target.value)}
                    disabled={stateOptions.length === 0}
                  >
                    <option value="">Select state</option>
                    {stateOptions.map((state) => (
                      <option key={state.code || state.name} value={state.code || state.name}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="storefront-field">
                  <label>City</label>
                  <select
                    value={draft.locationCity}
                    onChange={(event) => handleLocationCityChange(event.target.value)}
                    disabled={!draft.locationStateCode || cityOptions.length === 0}
                  >
                    <option value="">Select city</option>
                    {cityOptions.map((city) => (
                      <option key={city.name} value={city.name}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </div>  
                <div className="storefront-field storefront-field--wide">
                  <label>Description</label>
                  <textarea
                    rows={3}
                    value={draft.description}
                    onChange={(event) => updateDraft({ description: event.target.value })}
                    placeholder="Share what is included and key details."
                  />
                </div>
              </div>
              {locationError && <p className="storefront-field-hint">{locationError}</p>}
              <div className="storefront-field storefront-field--delivery">
                <label>Delivery & pickup</label>
                <p className="storefront-field-hint">
                  Your Social Place does not provide shipping. Arrange delivery privately or
                  offer local pickup.
                </p>
                <div className="storefront-switch-grid">
                  <label className="storefront-switch">
                    <input
                      type="checkbox"
                      checked={draft.localPickup}
                      onChange={(event) =>
                        updateDraft({
                          localPickup: event.target.checked,
                          cashAccepted: event.target.checked ? draft.cashAccepted : false,
                        })
                      }
                    />
                    <span className="storefront-switch-track" aria-hidden="true" />
                    <span className="storefront-switch-label">Local pickup available</span>
                  </label>
                  <label className="storefront-switch">
                    <input
                      type="checkbox"
                      checked={draft.cashAccepted}
                      disabled={!draft.localPickup}
                      onChange={(event) =>
                        updateDraft({ cashAccepted: event.target.checked })
                      }
                    />
                    <span className="storefront-switch-track" aria-hidden="true" />
                    <span className="storefront-switch-label">Cash on pickup</span>
                  </label>
                </div>
              </div>
              <div className="storefront-field storefront-field--photos">
                <span>Photos</span>
                <div
                  className={`storefront-file-dropzone${
                    isPhotoDragActive ? " is-active" : ""
                  }`}
                  onDragEnter={handlePhotoDragEnter}
                  onDragOver={handlePhotoDragOver}
                  onDragLeave={handlePhotoDragLeave}
                  onDrop={handlePhotoDrop}
                >
                  <label className="storefront-file storefront-file--drop">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      ref={singlePhotoInputRef}
                      onChange={handleAddPhotos}
                    />
                    <span>Drag & drop photos here or click to upload</span>
                  </label>
                  <span className="storefront-file-helper">Add multiple images at once.</span>
                </div>
                {draftImages.length > 0 && (
                  <div className="storefront-upload-grid">
                    {draftImages.map((image) => (
                      <div key={image.id} className="storefront-upload-item">
                        <img src={image.url} alt="Listing preview" />
                        <button type="button" onClick={() => handleRemovePhoto(image.id)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="storefront-field-hint">
            Delivery and pickup are arranged privately. Review the{" "}
            <a href="/marketplace-policy" target="_blank" rel="noreferrer">
              Delivery & Pickup Guidance
            </a>
            .
          </p>
          <label className="storefront-switch storefront-switch--wide storefront-bulk-policy">
            <input
              type="checkbox"
              checked={draft.shippingPolicyAccepted}
              onChange={(event) =>
                updateDraft({ shippingPolicyAccepted: event.target.checked })
              }
            />
            <span className="storefront-switch-track" aria-hidden="true" />
            <span className="storefront-switch-label">
              I accept the{" "}
              <a href="/marketplace-policy" target="_blank" rel="noreferrer">
                Delivery & Pickup Guidance
              </a>
            </span>
          </label>
          <label className="storefront-switch storefront-switch--wide storefront-bulk-policy">
            <input
              type="checkbox"
              checked={draft.feePolicyAccepted}
              onChange={(event) =>
                updateDraft({ feePolicyAccepted: event.target.checked })
              }
            />
            <span className="storefront-switch-track" aria-hidden="true" />
            <span className="storefront-switch-label">
              I accept the{" "}
              <a href="/marketplace-fee-disclosure" target="_blank" rel="noreferrer">
                Platform Fee Disclosure
              </a>
            </span>
          </label>
          {formError && <p className="storefront-form-error">{formError}</p>}
          <div className="storefront-step-actions">
            <button className="btn ghost" type="button" onClick={handleExitListing}>
              Back
            </button>
            <button className="btn primary" type="submit" disabled={creatingListing}>
              {creatingListing
                ? isEditingListing
                  ? "Saving..."
                  : "Publishing..."
                : isEditingListing
                ? "Save changes"
                : "Publish listing"}
            </button>
          </div>
        </form>
      ) : (
        <form
          className="storefront-form storefront-form--bulk"
          onSubmit={handleOpenBulkPreview}
        >
          <div className="storefront-bulk-list">
            {bulkListings.map((item, index) => (
              <div key={item.id} className="storefront-bulk-card">
                <div className="storefront-bulk-header">
                  <div>
                    <p className="storefront-panel-eyebrow">Listing {index + 1}</p>
                    <h4>Details</h4>
                  </div>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => handleRemoveBulkListing(item.id)}
                    disabled={bulkListings.length === 1}
                  >
                    Remove
                  </button>
                </div>
                <div className="storefront-bulk-grid">
                  <div className="storefront-field">
                    <label>Title</label>
                    <input
                      type="text"
                      value={item.title}
                      onChange={(event) =>
                        updateBulkListing(item.id, { title: event.target.value })
                      }
                      placeholder="e.g. Vintage camera kit"
                    />
                  </div>
                  <div className="storefront-field">
                    <label>Price</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.price}
                      onChange={(event) =>
                        updateBulkListing(item.id, { price: event.target.value })
                      }
                      placeholder="0.00"
                    />
                  </div>
                  <div className="storefront-field">
                    <label>Category</label>
                    <select
                      value={item.category}
                      onChange={(event) =>
                        updateBulkListing(item.id, { category: event.target.value })
                      }
                    >
                      {CATEGORY_OPTIONS.filter((option) => option !== "All").map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="storefront-field">
                    <label>Condition</label>
                    <select
                      value={item.condition}
                      onChange={(event) =>
                        updateBulkListing(item.id, { condition: event.target.value })
                      }
                    >
                      {CONDITION_OPTIONS.filter((option) => option !== "Any").map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="storefront-field">
                    <label>Visibility</label>
                    <select
                      value={item.visibility}
                      onChange={(event) =>
                        updateBulkListing(item.id, {
                          visibility: event.target.value as DraftProduct["visibility"],
                        })
                      }
                    >
                      <option value="public">Public</option>
                      <option value="friends">Friends only</option>
                    </select>
                  </div>
                  <div className="storefront-field">
                    <label>State</label>
                    <select
                    value={item.locationStateCode || item.locationState || ""}
                    onChange={(event) => handleBulkStateChange(item.id, event.target.value)}
                    disabled={stateOptions.length === 0}
                    >
                    <option value="">Select state</option>
                    {stateOptions.map((state) => (
                    <option key={state.code || state.name} value={state.code || state.name}>
                    {state.name}
                    </option>
                    ))}
                    </select>
                  </div>
                  <div className="storefront-field">
                    <label>City</label>
                    <select
                      value={item.locationCity}
                      onChange={(event) => handleBulkCityChange(item.id, event.target.value)}
                      disabled={
                        !item.locationStateCode ||
                        (cityOptionsByState[item.locationStateCode] ?? []).length === 0
                      }
                    >
                      <option value="">Select city</option>
                      {(cityOptionsByState[item.locationStateCode] ?? []).map((city) => (
                        <option key={city.name} value={city.name}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="storefront-field storefront-field--wide">
                    <label>Description</label>
                    <textarea
                      rows={3}
                      value={item.description}
                      onChange={(event) =>
                        updateBulkListing(item.id, { description: event.target.value })
                      }
                      placeholder="Share what is included and key details."
                    />
                  </div>
                </div>
                <div className="storefront-field storefront-field--photos">
                  <span>Photos</span>
                  <div
                    className={`storefront-file-dropzone${
                      bulkPhotoDragActive[item.id] ? " is-active" : ""
                    }`}
                    onDragEnter={(event) => handleBulkPhotoDragEnter(item.id, event)}
                    onDragOver={handleBulkPhotoDragOver}
                    onDragLeave={(event) => handleBulkPhotoDragLeave(item.id, event)}
                    onDrop={(event) => handleBulkPhotoDrop(item.id, event)}
                  >
                    <label className="storefront-file storefront-file--drop">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        ref={(node) => {
                          bulkPhotoInputRefs.current[item.id] = node;
                        }}
                        onChange={(event) => handleAddBulkPhotos(item.id, event)}
                      />
                      <span>Drag & drop photos here or click to upload</span>
                    </label>
                    <span className="storefront-file-helper">
                      Add multiple images at once.
                    </span>
                  </div>
                  {item.images.length > 0 && (
                    <div className="storefront-upload-grid">
                      {item.images.map((image) => (
                        <div key={image.id} className="storefront-upload-item">
                          <img src={image.url} alt="Listing preview" />
                          <button
                            type="button"
                            onClick={() => handleRemoveBulkPhoto(item.id, image.id)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {item.error && <p className="storefront-form-error">{item.error}</p>}
              </div>
            ))}
          </div>
          <label className="storefront-switch storefront-switch--wide storefront-bulk-policy">
            <input
              type="checkbox"
              checked={bulkShippingAccepted}
              onChange={(event) => setBulkShippingAccepted(event.target.checked)}
            />
            <span className="storefront-switch-track" aria-hidden="true" />
            <span className="storefront-switch-label">
              I accept the{" "}
              <a href="/marketplace-policy" target="_blank" rel="noreferrer">
                Delivery & Pickup Guidance
              </a>
            </span>
          </label>
          <label className="storefront-switch storefront-switch--wide storefront-bulk-policy">
            <input
              type="checkbox"
              checked={bulkFeeAccepted}
              onChange={(event) => setBulkFeeAccepted(event.target.checked)}
            />
            <span className="storefront-switch-track" aria-hidden="true" />
            <span className="storefront-switch-label">
              I accept the{" "}
              <a href="/marketplace-fee-disclosure" target="_blank" rel="noreferrer">
                Platform Fee Disclosure
              </a>
            </span>
          </label>
          {bulkError && <p className="storefront-form-error">{bulkError}</p>}
          <div className="storefront-step-actions">
            <button className="btn ghost" type="button" onClick={handleAddBulkListing}>
              Add another listing
            </button>
            <button className="btn primary" type="submit" disabled={creatingBulk}>
              {creatingBulk
                ? "Publishing..."
                : `Publish ${bulkListings.length} listing${
                    bulkListings.length === 1 ? "" : "s"
                  }`}
            </button>
          </div>
        </form>
      )}
    </div>
  );

  const pageBackground = getBackgroundStyle("storefront") || getBackgroundStyle("dashboard");
  const handlePreviewStore = useCallback(() => {
    if (!storefrontEnabled) return;
    navigate("/storefront?preview=mine");
  }, [navigate, storefrontEnabled]);

  const handleOpenPaymentMethods = useCallback(() => {
    setAccountMenuOpen(false);
    navigate("/storefront/payment-methods");
  }, [navigate]);

  const handleOpenListing = useCallback(() => {
    if (location.hash === "#list") return;
    navigate({ pathname: location.pathname, hash: "#list" });
  }, [location.hash, location.pathname, navigate]);
  const editingListing = useMemo(() => {
    if (editingListingId === null) return null;
    return (
      sellerListings.find(
        (listing) =>
          String(listing.documentId ?? listing.id ?? listing.rawId ?? "") ===
          String(editingListingId)
      ) ?? null
    );
  }, [editingListingId, sellerListings]);

  const previewItems: BulkListingDraft[] =
    previewMode === "bulk"
      ? bulkListings
      : previewMode === "single"
        ? [{ ...draft, id: "single-preview", images: draftImages, error: null }]
        : [];
  const previewTitle =
    previewMode === "bulk"
      ? "Preview your listings"
      : isEditingListing
      ? "Preview listing updates"
      : "Preview your listing";
  const previewSubtitle =
    previewMode === "bulk"
      ? "Confirm each listing before it goes live on StoreFront."
      : isEditingListing
      ? "Review your changes before saving your listing."
      : "Review your listing before it goes live on StoreFront.";
  const previewPublishLabel =
    previewMode === "bulk"
      ? `Publish ${previewItems.length} listing${previewItems.length === 1 ? "" : "s"}`
      : isEditingListing
      ? "Save changes"
      : "Publish listing";
  const isPublishing = creatingListing || creatingBulk;
  const previewTitleId = "storefront-preview-title";

  return (
    <div className="dashboard-shell storefront-shell" style={pageBackground}>
      <Sidebar active="storefront" />
      <div className="main-content storefront-page">
        {isListingView ? (
          <section className="storefront-layout is-single storefront-layout--listing">
            <div className="storefront-left">{listingPanel}</div>
          </section>
      ) : (
        <section
          className="storefront-dashboard seller-dashboard seller-dashboard--flow"
          style={dashboardStyle}
          >
            <div className="seller-dashboard-grid">
              <div className="seller-dashboard-topbar">
                <header className="seller-dashboard-header">
                  <div className="seller-dashboard-title">
                    <div className="seller-dashboard-icon" aria-hidden="true">
                      <span>🛍️</span>
                    </div>
                    <div>
                      <span className="seller-dashboard-kicker">Seller Workspace</span>
                      <h2>Storefront Control Center</h2>
                      <p>Track revenue, orders, payouts, and account health.</p>
                    </div>
                  </div>
                  <div className="seller-dashboard-actions">
                    <button
                      className="seller-dashboard-btn seller-dashboard-btn--ghost"
                      type="button"
                      onClick={handlePreviewStore}
                      disabled={!storefrontEnabled}
                      aria-disabled={!storefrontEnabled}
                    >
                      {storefrontEnabled ? "Preview my listings" : "StoreFront disabled"}
                    </button>
                    <button
                      className="seller-dashboard-btn seller-dashboard-btn--primary"
                      type="button"
                      onClick={handleOpenListing}
                    >
                      Add Product
                    </button>
                    <button
                      className="seller-dashboard-btn seller-dashboard-btn--ghost is-compact"
                      type="button"
                      onClick={() => setCustomizeOpen((prev) => !prev)}
                    >
                      {customizeOpen ? "Close" : "Customize"}
                    </button>
                    <select
                      className="seller-dashboard-range"
                      defaultValue="30"
                      aria-label="Dashboard range"
                    >
                      <option value="7">Last 7 Days</option>
                      <option value="30">Last 30 Days</option>
                      <option value="90">Last 90 Days</option>
                    </select>
                    <div
                      className="seller-dashboard-account"
                      ref={accountMenuRef}
                    >
                      <button
                        className="seller-dashboard-account-trigger"
                        type="button"
                        onClick={() => setAccountMenuOpen((prev) => !prev)}
                        aria-haspopup="menu"
                        aria-expanded={accountMenuOpen}
                      >
                        <span>Account Settings</span>
                        <span className="seller-dashboard-account-caret" aria-hidden="true" />
                      </button>
                      {accountMenuOpen && (
                        <div className="seller-dashboard-account-menu" role="menu">
                          <div className="seller-dashboard-account-meta">
                            <div className="seller-dashboard-avatar">
                              {sellerDisplayName.slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <span>Signed in as</span>
                              <strong>{sellerDisplayName}</strong>
                            </div>
                          </div>
                          <button
                            className="seller-dashboard-account-link"
                            type="button"
                            role="menuitem"
                            onClick={handleOpenPaymentMethods}
                          >
                            Payment Methods
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </header>

                {customizeOpen && (
                  <div className="storefront-panel seller-dashboard-customize-panel">
                    <div className="storefront-panel-header">
                      <div>
                        <p className="storefront-panel-eyebrow">Seller workspace</p>
                        <h3>Dashboard views & customization</h3>
                      </div>
                      <div className="storefront-dashboard-actions">
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={handleCreateView}
                        >
                          New view
                        </button>
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={handleRenameView}
                        >
                          Rename
                        </button>
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={handleSetDefaultView}
                        >
                          Set default
                        </button>
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={openDeleteView}
                          disabled={dashboardViews.length <= 1}
                        >
                          Delete
                        </button>
                        <button
                          className="btn primary small"
                          type="button"
                          onClick={handleSaveDashboardChanges}
                          disabled={
                            !activeViewId ||
                            !dashboardDirty ||
                            dashboardSaveState === "saving"
                          }
                        >
                          {dashboardSaveState === "saving" ? "Saving..." : "Save changes"}
                        </button>
                        {dashboardSaveState === "saved" && (
                          <span
                            className="storefront-dashboard-save-status"
                            role="status"
                          >
                            Saved
                          </span>
                        )}
                        {dashboardSaveState === "error" && (
                          <span
                            className="storefront-dashboard-save-status is-error"
                            role="status"
                          >
                            Save failed
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="storefront-dashboard-row">
                      <div className="storefront-field">
                        <label htmlFor="dashboard-view">Active view</label>
                        <select
                          id="dashboard-view"
                          value={activeViewId ?? ""}
                          onChange={(event) => handleSelectView(Number(event.target.value))}
                        >
                          {dashboardViews.map((view) => (
                            <option key={view.id} value={view.id}>
                              {view.name}
                              {view.isDefault ? " (default)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="storefront-dashboard-status">
                        {dashboardLoading && <span>Loading dashboard…</span>}
                        {!dashboardLoading && activeView?.updatedAt && (
                          <span>
                            Last updated {new Date(activeView.updatedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {dashboardError && <p className="storefront-form-error">{dashboardError}</p>}
                    <div className="storefront-dashboard-customize">
                      <div className="storefront-dashboard-theme">
                        <div className="storefront-dashboard-theme-header">
                          <h4>Theme & background</h4>
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={handleResetDashboardTheme}
                          >
                            Set to default
                          </button>
                        </div>
                        <div className="storefront-dashboard-theme-grid">
                          <label className="storefront-field">
                            <span>Page background</span>
                            <input
                              type="color"
                              value={dashboardTheme.pageBg}
                              onChange={(event) =>
                                updateDashboardTheme({ pageBg: event.target.value })
                              }
                            />
                          </label>
                          <label className="storefront-field">
                            <span>Page opacity</span>
                            <input
                              type="range"
                              min={0.2}
                              max={1}
                              step={0.05}
                              value={dashboardTheme.pageOpacity}
                              onChange={(event) =>
                                updateDashboardTheme({
                                  pageOpacity: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label className="storefront-field">
                            <span>Card background</span>
                            <input
                              type="color"
                              value={dashboardTheme.cardBg}
                              onChange={(event) =>
                                updateDashboardTheme({ cardBg: event.target.value })
                              }
                            />
                          </label>
                          <label className="storefront-field">
                            <span>Card opacity</span>
                            <input
                              type="range"
                              min={0.4}
                              max={1}
                              step={0.05}
                              value={dashboardTheme.cardOpacity}
                              onChange={(event) =>
                                updateDashboardTheme({
                                  cardOpacity: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label className="storefront-field">
                            <span>Accent color</span>
                            <input
                              type="color"
                              value={dashboardTheme.accent}
                              onChange={(event) =>
                                updateDashboardTheme({ accent: event.target.value })
                              }
                            />
                          </label>
                        </div>
                      </div>
                      <div className="storefront-dashboard-widgets">
                        <h4>Widgets</h4>
                        <div className="storefront-dashboard-widget-actions">
                          <label className="storefront-switch storefront-switch--compact">
                            <input
                              type="checkbox"
                              checked={allWidgetsSelected}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  handleSelectAllWidgets();
                                }
                              }}
                            />
                            <span className="storefront-switch-track" aria-hidden="true" />
                            <span className="storefront-switch-label">Select all</span>
                          </label>
                          <label className="storefront-switch storefront-switch--compact">
                            <input
                              type="checkbox"
                              checked={noWidgetsSelected}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  handleSelectNoneWidgets();
                                }
                              }}
                            />
                            <span className="storefront-switch-track" aria-hidden="true" />
                            <span className="storefront-switch-label">Select none</span>
                          </label>
                        </div>
                        <div className="storefront-dashboard-widget-grid">
                          {DASHBOARD_WIDGETS.map((widget) => (
                            <div key={widget.id} className="storefront-dashboard-widget-row">
                              <label className="storefront-switch storefront-switch--compact">
                                <input
                                  type="checkbox"
                                  checked={!hiddenWidgets.includes(widget.id)}
                                  onChange={() => handleToggleWidget(widget.id)}
                                />
                                <span className="storefront-switch-track" aria-hidden="true" />
                                <span className="storefront-switch-label">
                                  <span className="storefront-widget-title">{widget.title}</span>
                                  <span className="storefront-widget-helper">
                                    {widget.helper}
                                  </span>
                                </span>
                              </label>
                              <input
                                type="color"
                                value={widgetStyles[widget.id]?.color || dashboardTheme.cardBg}
                                onChange={(event) =>
                                  handleWidgetStyleChange(widget.id, {
                                    color: event.target.value,
                                  })
                                }
                              />
                              <input
                                type="range"
                                min={0.4}
                                max={1}
                                step={0.05}
                                value={
                                  widgetStyles[widget.id]?.opacity ?? dashboardTheme.cardOpacity
                                }
                                onChange={(event) =>
                                  handleWidgetStyleChange(widget.id, {
                                    opacity: Number(event.target.value),
                                  })
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {!hiddenWidgets.includes("totalEarnings") && (
                <div className="seller-kpi-card seller-kpi-card--k1" style={buildCardStyle("totalEarnings")}>
                  <div className="seller-kpi-header">
                    <span className="seller-kpi-label">Total Sales</span>
                    <span className="seller-kpi-icon" aria-hidden="true">
                      💰
                    </span>
                  </div>
                  <div className="seller-kpi-value">
                    {formatCurrency(totalEarningsValue, "USD")}
                  </div>
                  <div className="seller-kpi-meta">
                    {sellerOrders.length ? `${sellerOrders.length} orders` : "No orders yet"}
                  </div>
                  <div className="seller-kpi-sparkline" aria-hidden="true">
                    {earningsSeries.map((point, index) => (
                      <span
                        key={`net-${index}`}
                        style={{
                          height: `${Math.max(
                            6,
                            (point.total / earningsSparkMax) * 100
                          )}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {!hiddenWidgets.includes("payouts") && (
                <div className="seller-kpi-card seller-kpi-card--k2" style={buildCardStyle("payouts")}>
                  <div className="seller-kpi-header">
                    <span className="seller-kpi-label">Payout Balance</span>
                    <span className="seller-kpi-icon" aria-hidden="true">
                      💳
                    </span>
                  </div>
                  <div className="seller-kpi-value">
                    {formatCurrency(availableBalance, "USD")}
                  </div>
                  <div className="seller-kpi-meta">
                    Next payout:{" "}
                    {pendingPayoutAmount
                      ? formatCurrency(pendingPayoutAmount, "USD")
                      : "—"}
                  </div>
                  <div className="seller-kpi-sparkline" aria-hidden="true">
                    {earningsSeries.map((point, index) => (
                      <span
                        key={`balance-${index}`}
                        style={{
                          height: `${Math.max(
                            6,
                            (point.total / earningsSparkMax) * 100
                          )}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {!hiddenWidgets.includes("orders") && (
                <div className="seller-kpi-card seller-kpi-card--k3" style={buildCardStyle("orders")}>
                  <div className="seller-kpi-header">
                    <span className="seller-kpi-label">Orders</span>
                    <span className="seller-kpi-icon" aria-hidden="true">
                      📦
                    </span>
                  </div>
                  <div className="seller-kpi-value">{openOrders.length}</div>
                  <div className="seller-kpi-meta">
                    {openOrders.length
                      ? `${openOrders.length} pending`
                      : "No pending orders"}
                  </div>
                  <div className="seller-kpi-sparkline" aria-hidden="true">
                    {earningsSeries.map((point, index) => (
                      <span
                        key={`orders-${index}`}
                        style={{
                          height: `${Math.max(
                            6,
                            (point.total / earningsSparkMax) * 100
                          )}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="seller-kpi-card seller-kpi-card--k4" style={buildCardStyle()}>
                <div className="seller-kpi-header">
                  <span className="seller-kpi-label">Conversion</span>
                  <span className="seller-kpi-icon" aria-hidden="true">
                    📈
                  </span>
                </div>
                <div className="seller-kpi-value">{conversionRate.toFixed(1)}%</div>
                <div className="seller-kpi-meta">From StoreFront listings</div>
                <div className="seller-kpi-sparkline" aria-hidden="true">
                  {earningsSeries.map((point, index) => (
                    <span
                      key={`conversion-${index}`}
                      style={{
                        height: `${Math.max(6, (point.total / earningsSparkMax) * 100)}%`,
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="seller-dashboard-masonry">
                {!hiddenWidgets.includes("totalEarnings") && (
                  <div
                    className="seller-panel seller-panel--revenue seller-panel--area-rev"
                    style={buildCardStyle("totalEarnings")}
                  >
                    <div className="seller-panel-header">
                      <div>
                        <span className="seller-panel-eyebrow">Revenue</span>
                        <h3>Revenue</h3>
                      </div>
                      <div
                        className="seller-panel-tabs"
                        role="group"
                        aria-label="Revenue range"
                      >
                        <button
                          type="button"
                          className={revenueRange === 7 ? "is-active" : "is-muted"}
                          onClick={() => setRevenueRange(7)}
                          aria-pressed={revenueRange === 7}
                        >
                          7 Days
                        </button>
                        <button
                          type="button"
                          className={revenueRange === 30 ? "is-active" : "is-muted"}
                          onClick={() => setRevenueRange(30)}
                          aria-pressed={revenueRange === 30}
                        >
                          30 Days
                        </button>
                        <button
                          type="button"
                          className={revenueRange === 90 ? "is-active" : "is-muted"}
                          onClick={() => setRevenueRange(90)}
                          aria-pressed={revenueRange === 90}
                        >
                          90 Days
                        </button>
                      </div>
                    </div>
                    <div className="seller-panel-body">
                      {renderWidgetContent("totalEarnings")}
                    </div>
                  </div>
                )}

                {!hiddenWidgets.includes("orders") && (
                  <div
                    className="seller-panel seller-panel--orders seller-panel--area-ord"
                    style={buildCardStyle("orders")}
                  >
                    <div className="seller-panel-header">
                      <div>
                        <span className="seller-panel-eyebrow">Recent orders</span>
                        <h3>Recent Orders</h3>
                      </div>
                      <button className="seller-panel-action" type="button">
                        View all
                      </button>
                    </div>
                    <div className="seller-panel-body">{renderWidgetContent("orders")}</div>
                    {!hiddenWidgets.includes("offers") && (
                      <div className="seller-panel-subsection">
                        <div className="seller-panel-subheader">
                          <span className="seller-panel-eyebrow">Offers</span>
                          <h4>Offers</h4>
                        </div>
                        <div className="seller-panel-body">
                          {renderWidgetContent("offers")}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!hiddenWidgets.includes("payouts") && (
                  <div
                    ref={payoutsRef}
                    className="seller-panel seller-panel--payouts"
                    style={buildCardStyle("payouts")}
                  >
                    <div className="seller-panel-header">
                      <div>
                        <span className="seller-panel-eyebrow">Payouts</span>
                        <h3>Payouts</h3>
                      </div>
                    </div>
                    <div className="seller-panel-body">{renderWidgetContent("payouts")}</div>
                    <p className="seller-panel-note">
                      Sales payouts appear here within 2 business days after completion.
                    </p>
                  </div>
                )}
                {!hiddenWidgets.includes("verification") && (
                  <div
                    className="seller-panel seller-panel--verification"
                    style={buildCardStyle("verification")}
                  >
                    <div className="seller-panel-header">
                      <div>
                        <span className="seller-panel-eyebrow">Verification</span>
                        <h3>Verification</h3>
                      </div>
                    </div>
                    <div className="seller-panel-body">
                      {renderWidgetContent("verification")}
                    </div>
                  </div>
                )}
                <div
                  className="seller-panel seller-panel--setup"
                  style={buildCardStyle()}
                >
                  <div className="seller-panel-header">
                    <div>
                      <span className="seller-panel-eyebrow">Setup checklist</span>
                      <h3>Setup checklist</h3>
                    </div>
                  </div>
                  <div className="seller-panel-body">
                    <ul className="seller-setup-list">
                      {setupChecklist.map((item) => {
                        const statusLabel =
                          item.status === "done"
                            ? "Done"
                            : item.status === "pending"
                            ? "Pending"
                            : "Action required";
                        const statusClass =
                          item.status === "done"
                            ? "is-success"
                            : item.status === "pending"
                            ? "is-warning"
                            : "is-danger";
                        return (
                          <li key={item.id} className={`seller-setup-item ${item.status}`}>
                            <span className="seller-setup-name">{item.label}</span>
                            <span className={`seller-status-chip ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {nextChecklistItem ? (
                      <button
                        className="btn primary small"
                        type="button"
                        onClick={() => handleSetupAction(nextChecklistItem.id)}
                      >
                        {SETUP_ACTION_LABELS[nextChecklistItem.id]}
                      </button>
                    ) : (
                      <p className="seller-setup-complete">All set for selling.</p>
                    )}
                  </div>
                </div>
                {!hiddenWidgets.includes("activeListings") && (
                  <div
                    className="seller-panel seller-panel--active"
                    style={buildCardStyle("activeListings")}
                  >
                    <div className="seller-panel-header">
                      <div>
                        <span className="seller-panel-eyebrow">Active listings</span>
                        <h3>Active Listings</h3>
                      </div>
                    </div>
                    <div className="seller-panel-body">
                      {renderWidgetContent("activeListings")}
                    </div>
                  </div>
                )}
                {!hiddenWidgets.includes("messages") && (
                  <div
                    className="seller-panel seller-panel--messages"
                    style={buildCardStyle("messages")}
                  >
                    <div className="seller-panel-header">
                      <div>
                        <span className="seller-panel-eyebrow">Messages</span>
                        <h3>Messages</h3>
                      </div>
                    </div>
                    <div className="seller-panel-body">
                      {renderWidgetContent("messages")}
                    </div>
                  </div>
                )}
                {!hiddenWidgets.includes("buyerDisputes") && (
                  <div
                    className="seller-panel seller-panel--disputes"
                    style={buildCardStyle("buyerDisputes")}
                  >
                    <div className="seller-panel-header">
                      <div>
                        <span className="seller-panel-eyebrow">Buyer disputes</span>
                        <h3>Buyer Disputes</h3>
                      </div>
                    </div>
                    <div className="seller-panel-body">
                      {renderWidgetContent("buyerDisputes")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      {renameModalOpen && (
        <div
          className="storefront-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-dashboard-title"
          onClick={handleRenameCancel}
        >
          <div
            className="storefront-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="storefront-modal-header">
              <p className="storefront-modal-eyebrow">Dashboard view</p>
              <h3 id="rename-dashboard-title">Rename view</h3>
              <p className="storefront-modal-sub">
                Give this view a short, memorable name.
              </p>
            </div>
            <form
              className="storefront-modal-body"
              onSubmit={(event) => {
                event.preventDefault();
                void handleRenameSubmit();
              }}
            >
              <label className="storefront-modal-field">
                <span>View name</span>
                <input
                  className="storefront-modal-input"
                  type="text"
                  value={renameValue}
                  maxLength={48}
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                    if (renameError) setRenameError(null);
                  }}
                  placeholder="e.g. My dashboard"
                />
              </label>
              {renameError && <p className="storefront-modal-error">{renameError}</p>}
              <div className="storefront-modal-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={handleRenameCancel}
                  disabled={renameSaving}
                >
                  Cancel
                </button>
                <button className="btn primary" type="submit" disabled={renameSaving}>
                  {renameSaving ? "Saving..." : "Save name"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {deleteModalOpen && (
        <div
          className="storefront-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dashboard-title"
          onClick={handleDeleteCancel}
        >
          <div
            className="storefront-modal storefront-modal--danger"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="storefront-modal-header">
              <p className="storefront-modal-eyebrow">Dashboard view</p>
              <h3 id="delete-dashboard-title">Delete view?</h3>
              <p className="storefront-modal-sub">
                Delete "{activeView?.name || "this view"}"? This removes the view and all of
                its custom layout and styling.
              </p>
            </div>
            <div className="storefront-modal-body">
              {deleteError && <p className="storefront-modal-error">{deleteError}</p>}
              <div className="storefront-modal-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={handleDeleteCancel}
                  disabled={deleteSaving}
                >
                  Cancel
                </button>
                <button
                  className="btn danger"
                  type="button"
                  onClick={handleDeleteConfirm}
                  disabled={deleteSaving}
                >
                  {deleteSaving ? "Deleting..." : "Delete view"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {listingDeleteTarget && (
        <div
          className="storefront-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-listing-title"
          onClick={closeListingDeleteModal}
        >
          <div
            className="storefront-modal storefront-modal--danger"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="storefront-modal-header">
              <p className="storefront-modal-eyebrow">Listing</p>
              <h3 id="delete-listing-title">Delete listing?</h3>
              <p className="storefront-modal-sub">
                Delete "{listingDeleteTarget.title || "this listing"}"? This action
                cannot be undone.
              </p>
            </div>
            {listingDeleteError && (
              <p className="storefront-modal-error">{listingDeleteError}</p>
            )}
            <div className="storefront-modal-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={closeListingDeleteModal}
                disabled={listingDeleteSaving}
              >
                Cancel
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={confirmDeleteListing}
                disabled={listingDeleteSaving}
              >
                {listingDeleteSaving ? "Deleting..." : "Delete listing"}
              </button>
            </div>
          </div>
        </div>
      )}
      {previewMode && (
        <div
          className="storefront-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={previewTitleId}
          onClick={closePreviewModal}
        >
          <div
            className="storefront-preview-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="storefront-preview-header">
              <div>
                <p className="storefront-preview-eyebrow">Listing preview</p>
                <h3 id={previewTitleId}>{previewTitle}</h3>
                <p className="storefront-preview-sub">{previewSubtitle}</p>
              </div>
              <button
                className="btn ghost"
                type="button"
                onClick={closePreviewModal}
                disabled={isPublishing}
              >
                Close
              </button>
            </div>
            <div className="storefront-preview-body">
              {previewError && (
                <p className="storefront-preview-alert">{previewError}</p>
              )}
              <div className="storefront-preview-grid">
                {previewItems.map((item, index) => {
                  const priceValue = Number(item.price);
                  const priceNumber = Number.isFinite(priceValue) ? priceValue : 0;
                  const locationLabel =
                    item.location || formatLocationLabel(item.locationCity, item.locationState);
                  const primaryImage = item.images[0]?.url;
                  const isBulkPreview = previewMode === "bulk";
                  return (
                    <div key={item.id} className="storefront-preview-item">
                      <div className="storefront-preview-meta">
                        <span className="storefront-preview-label">
                          Listing {index + 1}
                        </span>
                      </div>
                      <div className="storefront-card storefront-preview-card">
                        <div className="storefront-card-image">
                          {primaryImage ? (
                            <img src={primaryImage} alt={item.title || "Listing"} />
                          ) : (
                            <div className="storefront-card-fallback" />
                          )}
                          <span className="storefront-card-condition">
                            {item.condition || "Condition"}
                          </span>
                          <span className="storefront-card-price-pill">
                            {formatPrice(priceNumber)}
                          </span>
                        </div>
                        <div className="storefront-card-body">
                          <h3>{item.title || "Untitled listing"}</h3>
                          <p className="storefront-card-location">
                            {locationLabel || "Location"}
                          </p>
                          <div className="storefront-card-row">
                            <span className="storefront-card-price">
                              {formatPrice(priceNumber)}
                            </span>
                            <span className="storefront-card-stock">1 in stock</span>
                          </div>
                          <div className="storefront-card-tags">
                            <span>{item.category || "Category"}</span>
                            {item.visibility === "friends" && (
                              <span className="is-friends">Friends only</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="storefront-preview-actions">
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={handlePreviewEdit}
                          disabled={isPublishing}
                        >
                          Edit listing
                        </button>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() =>
                            isBulkPreview
                              ? handlePreviewDeleteBulk(item.id)
                              : handlePreviewDeleteSingle()
                          }
                          disabled={isPublishing}
                        >
                          Delete listing
                        </button>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() =>
                            isBulkPreview
                              ? handlePreviewChangeBulkPhotos(item.id)
                              : handlePreviewChangeSinglePhotos()
                          }
                          disabled={isPublishing}
                        >
                          Change photos
                        </button>
                      </div>
                      {item.images.length > 0 && (
                        <div className="storefront-upload-grid storefront-preview-upload">
                          {item.images.map((image) => (
                            <div key={image.id} className="storefront-upload-item">
                              <img
                                src={image.url}
                                alt={`${item.title || "Listing"} preview`}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  isBulkPreview
                                    ? handleRemoveBulkPhoto(item.id, image.id)
                                    : handleRemovePhoto(image.id)
                                }
                                disabled={isPublishing}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="storefront-preview-footer">
              <button
                className="btn ghost"
                type="button"
                onClick={handlePreviewEdit}
                disabled={isPublishing}
              >
                {previewMode === "bulk" ? "Edit listings" : "Edit listing"}
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={previewMode === "bulk" ? publishBulkListings : publishSingleListing}
                disabled={isPublishing}
              >
                {isPublishing ? "Publishing..." : previewPublishLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {publishSuccess && (
        <div
          className="storefront-success-overlay"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          onClick={handleClosePublishSuccess}
        >
          <div
            className="storefront-success-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{publishSuccess}</h3>
            <p>
              {publishSuccess.toLowerCase().includes("updated")
                ? "Your listing updates are now live on the StoreFront."
                : "Your listing is now live on the StoreFront."}
            </p>
            <button className="btn primary" type="button" onClick={handleClosePublishSuccess}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
