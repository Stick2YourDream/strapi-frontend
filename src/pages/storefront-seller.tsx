import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
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
import PopupModal from "../components/PopupModal";
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

const buildSellerDashboardMockEnabledKey = (userId?: number | null) =>
  userId ? `${SELLER_DASHBOARD_MOCK_ENABLED_KEY}:${userId}` : null;

const buildSellerDashboardMockDataKey = (userId?: number | null) =>
  userId ? `${SELLER_DASHBOARD_MOCK_DATA_KEY}:${userId}` : null;
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
  status?: string;
  auctionEnabled?: boolean;
  auctionEndAt?: string;
  startingBid?: number;
  highestBid?: number;
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

type OfferStatus = "pending" | "countered" | "accepted" | "declined" | "withdrawn";
type BidStatus = "pending" | "accepted" | "declined" | "withdrawn";

type StorefrontOffer = {
  id: string;
  listingId: number;
  listingTitle?: string;
  buyerId?: number;
  sellerId?: number;
  buyerName: string;
  offeredPrice: number;
  currency: string;
  status: OfferStatus;
  createdAt: string;
  note?: string;
  lastActionBy?: "buyer" | "seller";
};

type MarketplaceBid = {
  id: string;
  listingId: number;
  listingTitle?: string;
  bidderId?: number;
  sellerId?: number;
  bidderName: string;
  amount: number;
  currency: string;
  status: BidStatus;
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
  createdAtTs?: number;
  listingId?: number;
  listingTitle?: string;
  senderId?: number;
  senderName: string;
  recipientId?: number;
  recipientName: string;
};

type MarketplaceMessageThread = {
  key: string;
  listingId?: number;
  listingTitle?: string;
  counterpartId?: number;
  counterpartName: string;
  lastMessageAt: number;
  lastMessageLabel: string;
  lastMessageBody: string;
  messages: MarketplaceMessage[];
};

type ListingFilterOption = {
  id: string;
  label: string;
};

const buildListingFilterOptions = (
  items: Array<{ listingId?: number; listingTitle?: string }>
): ListingFilterOption[] => {
  const options = new Map<string, string>();
  items.forEach((item) => {
    const key = String(item.listingId ?? "unknown");
    if (options.has(key)) return;
    const title = String(item.listingTitle || "").trim();
    if (title) {
      options.set(key, title);
      return;
    }
    options.set(key, key === "unknown" ? "Listing" : `Listing #${key}`);
  });
  return Array.from(options.entries()).map(([id, label]) => ({ id, label }));
};

type SellerDashboardMockData = {
  listings?: StorefrontProduct[];
  offers?: StorefrontOffer[];
  bids?: MarketplaceBid[];
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
  hasExif?: boolean;
};

type BulkListingDraft = DraftProduct & {
  id: string;
  images: DraftImage[];
  error?: string | null;
};

type DraftProduct = {
  title: string;
  price: string;
  auctionEnabled: boolean;
  auctionEndAt: string;
  startingBid: string;
  category: string;
  condition: string;
  status: "active" | "pending" | "archived" | "sold";
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

type SetupChecklistItem = {
  id: "listing" | "payout";
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

const toLocalDateTimeInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
  "Free",
  "Cars & Vehicles",
  "Motorcycles",
  "RVs & Campers",
  "Auto Parts & Accessories",
  "Real Estate",
  "Apartments & Rentals",
  "Electronics",
  "Computers",
  "Phones & Tablets",
  "Cameras & Drones",
  "Gaming",
  "Home & Garden",
  "Furniture",
  "Appliances",
  "Tools",
  "Building Materials",
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
  "Pets & Supplies",
  "Office & Business",
  "Industrial & Commercial",
  "Tickets",
  "Other",
];

const CONDITION_OPTIONS = ["Any", "New", "Good", "Fair", "Poor"];
const MAX_LISTING_PHOTOS = 10;
const BLOCKED_CATEGORIES = new Set(["services", "jobs"]);
const BLOCKED_KEYWORDS = [
  "adult toy",
  "sex toy",
  "dildo",
  "sex doll",
  "escort",
  "prostitution",
  "hooker",
  "stripper",
  "porn",
  "explicit",
  "nudity",
  "onlyfans",
  "cam show",
  "sexual service",
  "pay for sex",
];
const hasBlockedKeyword = (value: string) =>
  BLOCKED_KEYWORDS.some((keyword) => value.includes(keyword));

const hasExifMetadata = async (file: File) => {
  if (!file || !file.type.toLowerCase().includes("jpeg")) return false;
  const slice = file.slice(0, 128 * 1024);
  const buffer = await slice.arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return false;
  let offset = 2;
  while (offset < view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xffe1) {
      const size = view.getUint16(offset, false);
      const exifHeader = view.getUint32(offset + 2, false);
      return exifHeader === 0x45786966 && size > 8;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    const size = view.getUint16(offset, false);
    if (!size) break;
    offset += size;
  }
  return false;
};

const buildDraftImages = async (files: FileList | File[]) => {
  const list = Array.from(files);
  const enriched = await Promise.all(
    list.map(async (file) => ({
      id: `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      url: URL.createObjectURL(file),
      file,
      hasExif: await hasExifMetadata(file),
    }))
  );
  return enriched;
};

const countUnverifiedPhotos = (images: DraftImage[]) =>
  images.filter((image) => image.file && image.hasExif === false).length;

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

const formatRelativeTime = (value: string) => {
  if (!value) return "-";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "-";
  const diffMs = Date.now() - ts;
  if (!Number.isFinite(diffMs)) return "-";
  if (diffMs < 30_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
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
    ["pending", "processing", "open", "in progress", "review", "countered"].includes(
      normalized
    )
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
  payout: "Add payout method",
};

const buildSellerVerification = (
  status?: VerificationStatus | null,
  ageVerified?: boolean
): VerificationItem[] => [
  {
    label: "Age verification",
    status: ageVerified ? "verified" : "pending",
    detail: ageVerified
      ? "Age verified for marketplace access."
      : "Verify your age to keep your seller account active.",
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
  { id: "bids", title: "Bids", helper: "Auction activity" },
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
  { i: "bids", x: 0, y: 4, w: 6, h: 2 },
  { i: "activeListings", x: 6, y: 4, w: 6, h: 3 },
  { i: "verification", x: 4, y: 7, w: 4, h: 2 },
  { i: "topProducts", x: 8, y: 7, w: 4, h: 2 },
  { i: "buyerDisputes", x: 0, y: 10, w: 6, h: 2 },
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
  auctionEnabled: false,
  auctionEndAt: "",
  startingBid: "",
  category: "Electronics",
  condition: "New",
  status: "active",
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
  const [offerActionError, setOfferActionError] = useState<string | null>(null);
  const [offerActionNotice, setOfferActionNotice] = useState<string | null>(null);
  const [offerActionLoading, setOfferActionLoading] = useState<Record<string, boolean>>(
    {}
  );
  const [offerCounterDrafts, setOfferCounterDrafts] = useState<Record<string, string>>({});
  const [offerCounterNotes, setOfferCounterNotes] = useState<Record<string, string>>({});
  const [offerListingFilter, setOfferListingFilter] = useState<string>("");
  const [bids, setBids] = useState<MarketplaceBid[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [bidsError, setBidsError] = useState<string | null>(null);
  const [bidActionError, setBidActionError] = useState<string | null>(null);
  const [bidActionNotice, setBidActionNotice] = useState<string | null>(null);
  const [bidActionLoading, setBidActionLoading] = useState<Record<string, boolean>>({});
  const [bidListingFilter, setBidListingFilter] = useState<string>("");
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
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [messageReplyOpen, setMessageReplyOpen] = useState<Record<string, boolean>>({});
  const [messageSending, setMessageSending] = useState<Record<string, boolean>>({});
  const [messageActionError, setMessageActionError] = useState<string | null>(null);
  const [messageActionNotice, setMessageActionNotice] = useState<string | null>(null);
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
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [activeDashboardModule, setActiveDashboardModule] = useState<string | null>(null);
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [dashboardSaveState, setDashboardSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const dashboardReadyRef = useRef(false);
  const dashboardSaveBlockedRef = useRef(false);
  const dashboardSyncRef = useRef(false);
  const activeViewUpdatedAtRef = useRef(0);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [stateOptions, setStateOptions] = useState<LocationOption[]>([]);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftProduct>(() => createEmptyDraft());
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const unverifiedPhotoCount = useMemo(
    () => countUnverifiedPhotos(draftImages),
    [draftImages]
  );
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
    const handleClick = (event: Event) => {
      if (!accountMenuRef.current) return;
      if (accountMenuRef.current.contains(event.target as Node)) return;
      setAccountMenuOpen(false);
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
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
          status: String(attrs.status || "active"),
          auctionEnabled: Boolean(attrs.auctionEnabled),
          auctionEndAt: attrs.auctionEndAt ? String(attrs.auctionEndAt) : undefined,
          startingBid: Number(attrs.startingBid ?? 0) || undefined,
          highestBid: Number(attrs.highestBid ?? 0) || undefined,
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
    setOfferActionError(null);
    setOfferActionNotice(null);
    try {
      const res = await api.get("/marketplace-offers/me");
      const mapped = (res.data?.data ?? []).map((entry: any) => {
        const attrs = normalize(entry);
        const buyerData = attrs.buyer?.data ?? attrs.buyer;
        const buyer = normalize(buyerData);
        const listingData = attrs.listing?.data ?? attrs.listing;
        const listing = normalize(listingData);
        return {
          id: String(entry.id ?? attrs.documentId ?? `${attrs.createdAt}`),
          listingId: getEntityId(listingData) ?? 0,
          listingTitle: String(listing.title || "Listing"),
          buyerId: getEntityId(buyerData) ?? undefined,
          sellerId: getEntityId(attrs.seller) ?? undefined,
          buyerName:
            `${String(buyer.firstName || "").trim()} ${String(buyer.lastName || "").trim()}`.trim() ||
            String(buyer.username || "").trim() ||
            String(buyer.email || "").split("@")[0] ||
            "Buyer",
          offeredPrice: Number(attrs.offeredPrice || 0),
          currency: String(attrs.currency || "USD").toUpperCase(),
          status:
            (String(attrs.status || "pending").toLowerCase() as OfferStatus) || "pending",
          createdAt: attrs.createdAt ? new Date(attrs.createdAt).toLocaleString() : "",
          note: attrs.note ? String(attrs.note) : undefined,
          lastActionBy:
            attrs.lastActionBy === "buyer" || attrs.lastActionBy === "seller"
              ? attrs.lastActionBy
              : "buyer",
        } satisfies StorefrontOffer;
      });
      setOffers(mapped);
    } catch {
      setOfferError("Unable to load offers.");
    } finally {
      setOfferLoading(false);
    }
  }, [user?.id]);

  const loadBids = useCallback(async () => {
    if (!user?.id) {
      setBids([]);
      return;
    }
    setBidsLoading(true);
    setBidsError(null);
    setBidActionError(null);
    setBidActionNotice(null);
    try {
      const res = await api.get("/marketplace-bids/me");
      const mapped = (res.data?.data ?? []).map((entry: any) => {
        const attrs = normalize(entry);
        const bidderData = attrs.bidder?.data ?? attrs.bidder;
        const bidder = normalize(bidderData);
        const listingData = attrs.listing?.data ?? attrs.listing;
        const listing = normalize(listingData);
        return {
          id: String(entry.id ?? attrs.documentId ?? `${attrs.createdAt}`),
          listingId: getEntityId(listingData) ?? 0,
          listingTitle: String(listing.title || "Listing"),
          bidderId: getEntityId(bidderData) ?? undefined,
          sellerId: getEntityId(attrs.seller) ?? undefined,
          bidderName:
            `${String(bidder.firstName || "").trim()} ${String(bidder.lastName || "").trim()}`.trim() ||
            String(bidder.username || "").trim() ||
            String(bidder.email || "").split("@")[0] ||
            "Bidder",
          amount: Number(attrs.amount || 0),
          currency: String(attrs.currency || "USD").toUpperCase(),
          status:
            (String(attrs.status || "pending").toLowerCase() as BidStatus) ||
            "pending",
          createdAt: attrs.createdAt ? new Date(attrs.createdAt).toLocaleString() : "",
        } satisfies MarketplaceBid;
      });
      setBids(mapped);
    } catch {
      setBidsError("Unable to load bids.");
    } finally {
      setBidsLoading(false);
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
    setMessageActionError(null);
    setMessageActionNotice(null);
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
        const createdAtTs = attrs.createdAt ? new Date(attrs.createdAt).getTime() : 0;
        return {
          id: Number(entry?.id ?? attrs.id ?? 0),
          body: String(attrs.body || ""),
          createdAt: attrs.createdAt ? new Date(attrs.createdAt).toLocaleString() : "",
          createdAtTs: Number.isFinite(createdAtTs) ? createdAtTs : 0,
          listingId: getEntityId(listingData) ?? undefined,
          listingTitle: listing.title ? String(listing.title) : undefined,
          senderId: getEntityId(senderData) ?? undefined,
          senderName:
            `${String(sender.firstName || "").trim()} ${String(sender.lastName || "").trim()}`.trim() ||
            String(sender.username || "").trim() ||
            String(sender.email || "").split("@")[0] ||
            "User",
          recipientId: getEntityId(recipientData) ?? undefined,
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
        setDashboardLayouts(createdEntry.layout || buildDefaultLayouts());
        setDashboardTheme(DEFAULT_DASHBOARD_THEME);
        setWidgetConfig(createdEntry.widgets || DEFAULT_WIDGET_CONFIG);
        setDashboardDirty(false);
        setDashboardSaveState("idle");
        dashboardReadyRef.current = true;
        dashboardSaveBlockedRef.current = false;
        return;
      }
      const views = entries.map(normalizeViewEntry);
      const defaultView = views.find((view) => view.isDefault) ?? views[0] ?? null;
      setDashboardViews(defaultView ? [defaultView] : []);
      setActiveViewId(defaultView?.id ?? null);
      setDashboardLayouts(defaultView?.layout || buildDefaultLayouts());
      setDashboardTheme(DEFAULT_DASHBOARD_THEME);
      setWidgetConfig(defaultView?.widgets || DEFAULT_WIDGET_CONFIG);
      setDashboardDirty(false);
      setDashboardSaveState("idle");
      dashboardReadyRef.current = true;
      dashboardSaveBlockedRef.current = false;
    } catch {
      setDashboardError("Unable to load dashboard settings.");
      dashboardReadyRef.current = false;
    } finally {
    }
  }, [user?.id]);

  const applyViewState = useCallback(
    (view: DashboardView | null) => {
      if (!view) return;
      setActiveViewId(view.id);
      setDashboardLayouts(ensureLayouts(view.layout));
      setDashboardTheme(DEFAULT_DASHBOARD_THEME);
      setWidgetConfig(view.widgets || DEFAULT_WIDGET_CONFIG);
      setDashboardDirty(false);
      setDashboardSaveState("idle");
    },
    []
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
        const primaryView = views.find((view) => view.isDefault) ?? views[0] ?? null;
        setDashboardViews(primaryView ? [primaryView] : []);
        if (primaryView) {
          applyViewState(primaryView);
        }
        return primaryView ? [primaryView] : [];
      } catch {
        // Silent retry on the next interval.
        return null;
      } finally {
        dashboardSyncRef.current = false;
      }
    },
    [applyViewState, loadDashboardViews, user?.id]
  );

  const persistDashboardView = useCallback(async (view: DashboardView) => {
    const viewKey = view.documentId || view.id;
    await api.put(`/marketplace-dashboard-views/${viewKey}`, {
      data: {
        name: view.name,
        isDefault: Boolean(view.isDefault),
        layout: view.layout,
        widgets: view.widgets,
        theme: DEFAULT_DASHBOARD_THEME,
      },
    });
  }, []);

  const handleSaveDashboardChanges = useCallback(async () => {
    if (!activeViewId) return;
    const view = dashboardViews.find((item) => item.id === activeViewId);
    if (!view) return;
    const nextView: DashboardView = {
      ...view,
      layout: dashboardLayouts,
      widgets: { ...widgetConfig, styles: {} },
      theme: DEFAULT_DASHBOARD_THEME,
    };
    setDashboardSaveState("saving");
    setDashboardViews((prev) =>
      prev.map((item) => (item.id === activeViewId ? nextView : item))
    );
    try {
      await persistDashboardView(nextView);
      setDashboardSaveState("saved");
      setDashboardDirty(false);
      await refreshDashboardViews({ applyActive: true });
    } catch {
      setDashboardSaveState("error");
      setDashboardError("Unable to save dashboard settings.");
    }
  }, [
    activeViewId,
    dashboardLayouts,
    dashboardViews,
    persistDashboardView,
    refreshDashboardViews,
    widgetConfig,
  ]);

  const handleRequestVerification = async () => {
    if (verificationLoading) return;
    setVerificationNotice(null);
    setVerificationError(null);
    setVerificationLoading(true);
    try {
      if (user?.ageVerified) {
        setVerificationNotice("Your age is already verified.");
        return;
      }
      const params = new URLSearchParams(location.search);
      params.set("ageVerify", "1");
      setVerificationNotice("Starting age verification...");
      navigate(
        {
          pathname: location.pathname,
          search: params.toString() ? `?${params.toString()}` : "",
          hash: location.hash,
        },
        { replace: false }
      );
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        "Unable to start age verification.";
      setVerificationError(message);
    } finally {
      setVerificationLoading(false);
    }
  };

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
      auctionEnabled: Boolean(listing.auctionEnabled),
      auctionEndAt: toLocalDateTimeInput(listing.auctionEndAt),
      startingBid: listing.startingBid ? String(listing.startingBid) : "",
      category: listing.category || "Electronics",
      condition: listing.condition || "New",
      status:
        listing.status === "pending" ||
        listing.status === "archived" ||
        listing.status === "sold"
          ? listing.status
          : "active",
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
  ) => {
    const auctionEndAtDate = value.auctionEndAt ? new Date(value.auctionEndAt) : null;
    const auctionEndAt =
      auctionEndAtDate && !Number.isNaN(auctionEndAtDate.getTime())
        ? auctionEndAtDate.toISOString()
        : null;
    return {
      title: value.title,
      price: Number(value.price),
      auctionEnabled: Boolean(value.auctionEnabled),
      auctionEndAt: auctionEndAt || undefined,
      startingBid: value.startingBid ? Number(value.startingBid) : undefined,
      category: value.category,
      condition: value.condition,
      status: value.status,
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
    };
  };

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
    if (value.auctionEnabled) {
      const startingBidValue = Number(value.startingBid);
      if (!Number.isFinite(startingBidValue) || startingBidValue <= 0) {
        return "Please add a valid starting bid.";
      }
      if (!value.auctionEndAt.trim()) {
        return "Please set an auction end time.";
      }
      const endAt = new Date(value.auctionEndAt);
      if (Number.isNaN(endAt.getTime())) {
        return "Please set a valid auction end time.";
      }
      if (endAt.getTime() <= Date.now()) {
        return "Auction end time must be in the future.";
      }
      if (startingBidValue > priceValue) {
        return "Starting bid cannot exceed the buy now price.";
      }
    }
    if (!value.category.trim()) {
      return "Please choose a category.";
    }
    if (BLOCKED_CATEGORIES.has(value.category.trim().toLowerCase())) {
      return "Service listings are not allowed on StoreFront.";
    }
    const contentCheck = `${value.title} ${value.description} ${value.category}`.toLowerCase();
    if (hasBlockedKeyword(contentCheck)) {
      return "Adult or prohibited items/services are not allowed.";
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
    if (options.photos && options.photos.some((photo) => photo.file && photo.hasExif === false)) {
      return "Please use original camera photos with metadata (no stock images).";
    }
    if (options.photos && options.photos.length > MAX_LISTING_PHOTOS) {
      return `Limit listings to ${MAX_LISTING_PHOTOS} photos.`;
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
    void buildDraftImages(files).then((incoming) => {
      if (!incoming.length) return;
      setDraftImages((prev) => {
        const remaining = Math.max(0, MAX_LISTING_PHOTOS - prev.length);
        if (remaining <= 0) {
          setPhotoNotice(`You can upload up to ${MAX_LISTING_PHOTOS} photos.`);
          return prev;
        }
        const next = [...prev, ...incoming.slice(0, remaining)];
        if (incoming.length > remaining) {
          setPhotoNotice(
            `Only ${MAX_LISTING_PHOTOS} photos are allowed. Extra photos were skipped.`
          );
        } else {
          setPhotoNotice(null);
        }
        return next;
      });
    });
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
    void buildDraftImages(files).then((incoming) => {
      if (!incoming.length) return;
      setBulkListings((prev) =>
        prev.map((item) =>
          item.id === listingId
            ? (() => {
                const remaining = Math.max(0, MAX_LISTING_PHOTOS - item.images.length);
                if (remaining <= 0) {
                  return {
                    ...item,
                    error: `You can upload up to ${MAX_LISTING_PHOTOS} photos per listing.`,
                  };
                }
                const nextImages = [...item.images, ...incoming.slice(0, remaining)];
                const error =
                  incoming.length > remaining
                    ? `Only ${MAX_LISTING_PHOTOS} photos are allowed. Extra photos were skipped.`
                    : null;
                return { ...item, images: nextImages, error };
              })()
            : item
        )
      );
    });
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
    void loadBids();
    void loadSelfVerification();
    void loadOrders();
    void loadDisputes();
    void loadMessages();
    void loadDashboardViews();
  }, [
    loadListings,
    loadOffers,
    loadBids,
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

  const dashboardBids = useMemo(
    () =>
      isMockMode && sellerDashboardMockData?.bids?.length
        ? sellerDashboardMockData.bids
        : bids,
    [bids, isMockMode, sellerDashboardMockData?.bids]
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

  const messageThreads = useMemo<MarketplaceMessageThread[]>(() => {
    const threadMap = new Map<string, MarketplaceMessageThread>();
    const source = dashboardMessages;
    source.forEach((message) => {
      const isFromMe = message.senderId === user?.id;
      const counterpartId = isFromMe ? message.recipientId : message.senderId;
      const counterpartName = isFromMe ? message.recipientName : message.senderName;
      const listingKey = message.listingId ? String(message.listingId) : "listing";
      const threadKey = `${listingKey}:${counterpartId ?? "unknown"}`;
      const timestamp = (() => {
        if (typeof message.createdAtTs === "number" && Number.isFinite(message.createdAtTs)) {
          return message.createdAtTs;
        }
        const parsed = Date.parse(message.createdAt || "");
        return Number.isFinite(parsed) ? parsed : 0;
      })();
      let thread = threadMap.get(threadKey);
      if (!thread) {
        thread = {
          key: threadKey,
          listingId: message.listingId,
          listingTitle: message.listingTitle,
          counterpartId,
          counterpartName: counterpartName || "User",
          lastMessageAt: 0,
          lastMessageLabel: "",
          lastMessageBody: "",
          messages: [],
        };
        threadMap.set(threadKey, thread);
      }
      thread.messages.push(message);
      if (timestamp >= thread.lastMessageAt) {
        thread.lastMessageAt = timestamp;
        thread.lastMessageLabel = message.createdAt || "";
        thread.lastMessageBody = message.body;
        thread.listingTitle = message.listingTitle || thread.listingTitle;
        thread.counterpartName = counterpartName || thread.counterpartName;
        thread.counterpartId = counterpartId ?? thread.counterpartId;
      }
    });
    const threads = Array.from(threadMap.values());
    threads.forEach((thread) => {
      thread.messages.sort((a, b) => {
        const aTs =
          Number.isFinite(a.createdAtTs) ? (a.createdAtTs as number) : Date.parse(a.createdAt || "");
        const bTs =
          Number.isFinite(b.createdAtTs) ? (b.createdAtTs as number) : Date.parse(b.createdAt || "");
        const safeATs = Number.isFinite(aTs) ? aTs : 0;
        const safeBTs = Number.isFinite(bTs) ? bTs : 0;
        return safeATs - safeBTs;
      });
    });
    threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return threads;
  }, [dashboardMessages, user?.id]);

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
        isMockMode ? sellerDashboardMockData?.verification ?? null : selfVerification,
        user?.ageVerified === true
      ),
    [isMockMode, sellerDashboardMockData?.verification, selfVerification, user?.ageVerified]
  );


  const sellerListings = useMemo(
    () => dashboardProducts.filter((product) => product.seller.userId === user?.id),
    [dashboardProducts, user?.id]
  );

  const verificationSource = isMockMode
    ? sellerDashboardMockData?.verification ?? null
    : selfVerification;

  const sellerIsVerified = useMemo(() => {
    const idStatus = normalizeStatus(verificationSource?.sellerIdStatus);
    const payoutStatus = normalizeStatus(verificationSource?.sellerPayoutStatus);
    return idStatus === "verified" && payoutStatus === "verified";
  }, [verificationSource]);

  const sellerFeePercent = sellerIsVerified ? 2 : 4;

  const setupChecklist = useMemo<SetupChecklistItem[]>(() => {
    const payoutStatus = normalizeStatus(verificationSource?.sellerPayoutStatus);
    const payoutHasMethod = Boolean(
      verificationSource?.paypalMerchantIdInPayPal ||
        verificationSource?.payoutEmail ||
        payoutEmail.trim()
    );
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
        id: "payout",
        label: "Add payout method",
        status: payoutState,
      },
    ];
  }, [
    payoutEmail,
    sellerListings.length,
    verificationSource?.payoutEmail,
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

  const bidsForSeller = useMemo(
    () => dashboardBids.filter((bid) => sellerListingIds.has(Number(bid.listingId || 0))),
    [dashboardBids, sellerListingIds]
  );

  const openOffers = useMemo(
    () => offersForSeller.filter((offer) => ["pending", "countered"].includes(offer.status)),
    [offersForSeller]
  );

  const openBids = useMemo(
    () => bidsForSeller.filter((bid) => bid.status === "pending"),
    [bidsForSeller]
  );

  const offerListingOptions = useMemo(
    () => buildListingFilterOptions(openOffers),
    [openOffers]
  );

  const bidListingOptions = useMemo(
    () => buildListingFilterOptions(openBids),
    [openBids]
  );

  useEffect(() => {
    if (offerListingOptions.length === 0) {
      if (offerListingFilter) {
        setOfferListingFilter("");
      }
      return;
    }
    if (!offerListingOptions.some((option) => option.id === offerListingFilter)) {
      setOfferListingFilter(offerListingOptions[0].id);
    }
  }, [offerListingFilter, offerListingOptions]);

  useEffect(() => {
    if (bidListingOptions.length === 0) {
      if (bidListingFilter) {
        setBidListingFilter("");
      }
      return;
    }
    if (!bidListingOptions.some((option) => option.id === bidListingFilter)) {
      setBidListingFilter(bidListingOptions[0].id);
    }
  }, [bidListingFilter, bidListingOptions]);

  const filteredOffers = useMemo(() => {
    if (!offerListingFilter) return openOffers;
    return openOffers.filter(
      (offer) => String(offer.listingId ?? "unknown") === offerListingFilter
    );
  }, [offerListingFilter, openOffers]);

  const filteredBids = useMemo(() => {
    if (!bidListingFilter) return openBids;
    return openBids.filter(
      (bid) => String(bid.listingId ?? "unknown") === bidListingFilter
    );
  }, [bidListingFilter, openBids]);

  const isOfferActionable = useCallback(
    (offer: StorefrontOffer) =>
      ["pending", "countered"].includes(offer.status) &&
      (offer.lastActionBy ?? "buyer") !== "seller",
    []
  );

  const handleOfferStatusUpdate = useCallback(
    async (offerId: string, status: OfferStatus, payload?: { offeredPrice?: number; note?: string }) => {
      setOfferActionError(null);
      setOfferActionNotice(null);
      setOfferActionLoading((prev) => ({ ...prev, [offerId]: true }));
      try {
        await api.put(`/marketplace-offers/${offerId}`, {
          data: {
            status,
            offeredPrice: payload?.offeredPrice,
            note: payload?.note,
          },
        });
        setOfferActionNotice(
          status === "accepted"
            ? "Offer accepted."
            : status === "declined"
            ? "Offer declined."
            : "Counter offer sent."
        );
        await loadOffers();
      } catch (err) {
        const apiMessage =
          (err as any)?.response?.data?.error?.message ||
          (err as any)?.response?.data?.message;
        setOfferActionError(apiMessage || "Unable to update offer.");
      } finally {
        setOfferActionLoading((prev) => ({ ...prev, [offerId]: false }));
      }
    },
    [loadOffers]
  );

  const handleOfferCounter = useCallback(
    async (offerId: string) => {
      const existingOffer = offersForSeller.find((offer) => offer.id === offerId);
      const draftValue = offerCounterDrafts[offerId];
      const noteValue = offerCounterNotes[offerId];
      const counterPrice = Number(draftValue ?? existingOffer?.offeredPrice);
      if (!Number.isFinite(counterPrice) || counterPrice <= 0) {
        setOfferActionError("Enter a valid counter offer.");
        return;
      }
      await handleOfferStatusUpdate(offerId, "countered", {
        offeredPrice: counterPrice,
        note: noteValue?.trim() || undefined,
      });
      setOfferCounterDrafts((prev) => {
        const next = { ...prev };
        delete next[offerId];
        return next;
      });
      setOfferCounterNotes((prev) => {
        const next = { ...prev };
        delete next[offerId];
        return next;
      });
    },
    [handleOfferStatusUpdate, offerCounterDrafts, offerCounterNotes, offersForSeller]
  );

  const handleBidStatusUpdate = useCallback(
    async (bidId: string, status: BidStatus) => {
      setBidActionError(null);
      setBidActionNotice(null);
      setBidActionLoading((prev) => ({ ...prev, [bidId]: true }));
      try {
        await api.put(`/marketplace-bids/${bidId}`, { data: { status } });
        setBidActionNotice(
          status === "accepted" ? "Bid accepted." : "Bid declined."
        );
        await loadBids();
      } catch (err) {
        const apiMessage =
          (err as any)?.response?.data?.error?.message ||
          (err as any)?.response?.data?.message;
        setBidActionError(apiMessage || "Unable to update bid.");
      } finally {
        setBidActionLoading((prev) => ({ ...prev, [bidId]: false }));
      }
    },
    [loadBids]
  );

  const handleMessageReplyToggle = useCallback((threadKey: string) => {
    setMessageReplyOpen((prev) => ({ ...prev, [threadKey]: !prev[threadKey] }));
  }, []);

  const handleSendMarketplaceReply = useCallback(
    async (thread: MarketplaceMessageThread) => {
      const key = thread.key;
      const draft = (messageDrafts[key] || "").trim();
      if (!draft) {
        setMessageActionError("Type a response before sending.");
        return;
      }
      const counterpartId = thread.counterpartId;
      if (!counterpartId || !Number.isFinite(Number(counterpartId))) {
        setMessageActionError("Missing recipient for this message.");
        return;
      }
      setMessageActionError(null);
      setMessageActionNotice(null);
      setMessageSending((prev) => ({ ...prev, [key]: true }));
      try {
        await api.post("/messages", {
          data: {
            body: draft,
            recipient: Number(counterpartId),
            listing: thread.listingId ?? undefined,
          },
        });
        setMessageDrafts((prev) => ({ ...prev, [key]: "" }));
        setMessageReplyOpen((prev) => ({ ...prev, [key]: false }));
        setMessageActionNotice("Reply sent.");
        await loadMessages();
      } catch (err) {
        const apiMessage =
          (err as any)?.response?.data?.error?.message ||
          (err as any)?.response?.data?.message;
        setMessageActionError(apiMessage || "Unable to send message.");
      } finally {
        setMessageSending((prev) => ({ ...prev, [key]: false }));
      }
    },
    [loadMessages, messageDrafts, user?.id]
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
  const showRevenuePanel = !hiddenWidgets.includes("totalEarnings");
  const showActivityPanel = !hiddenWidgets.includes("orders");
  const visibleKpiCount = [
    !hiddenWidgets.includes("totalEarnings"),
    !hiddenWidgets.includes("payouts"),
    !hiddenWidgets.includes("orders"),
    true,
  ].filter(Boolean).length;

  const sellerOrders = useMemo(
    () => dashboardOrders.filter((order) => Number(order.sellerId) === Number(user?.id || 0)),
    [dashboardOrders, user?.id]
  );

  const recentOrderSummary = useMemo(() => {
    const statusPriority: Record<string, number> = {
      paid: 3,
      approved: 3,
      completed: 2,
      delivered: 2,
      pending: 1,
    };
    const getOrderTs = (order: MarketplaceOrder) => {
      const ts = new Date(order.createdAt).getTime();
      return Number.isNaN(ts) ? 0 : ts;
    };
    const grouped = new Map<
      string,
      { count: number; latestTs: number; displayOrder: MarketplaceOrder }
    >();

    sellerOrders.forEach((order) => {
      const key = String(order.listingId ?? order.listingTitle ?? order.id);
      const ts = getOrderTs(order);
      const priority = statusPriority[String(order.status || "").toLowerCase()] ?? 0;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { count: 1, latestTs: ts, displayOrder: order });
        return;
      }
      existing.count += 1;
      if (ts > existing.latestTs) {
        existing.latestTs = ts;
      }
      const existingPriority =
        statusPriority[String(existing.displayOrder.status || "").toLowerCase()] ?? 0;
      if (priority > existingPriority || (priority === existingPriority && ts > getOrderTs(existing.displayOrder))) {
        existing.displayOrder = order;
      }
    });

    return Array.from(grouped.values())
      .sort((a, b) => b.latestTs - a.latestTs)
      .slice(0, 4);
  }, [sellerOrders]);

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

  const trendPreviewSeries = useMemo(
    () => (earningsSeries.length ? earningsSeries.slice(-8) : [{ label: "Now", total: 0 }]),
    [earningsSeries]
  );

  const featuredListingImages = useMemo(
    () =>
      sellerListings
        .flatMap((listing) => (Array.isArray(listing.images) ? listing.images.slice(0, 1) : []))
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .slice(0, 4),
    [sellerListings]
  );

  const listingImageById = useMemo(() => {
    const map = new Map<string, string>();
    sellerListings.forEach((listing) => {
      const listingKey = String(listing.rawId ?? listing.id ?? listing.documentId ?? "");
      if (!listingKey) return;
      const previewImage = listing.images.find(
        (image) => typeof image === "string" && image.trim().length > 0
      );
      if (previewImage) {
        map.set(listingKey, previewImage);
      }
    });
    return map;
  }, [sellerListings]);

  const getOrderPreviewImage = useCallback(
    (order: MarketplaceOrder) => {
      if (order.listingId !== undefined && order.listingId !== null) {
        const listingImage = listingImageById.get(String(order.listingId));
        if (listingImage) return listingImage;
      }
      return featuredListingImages[0] ?? "";
    },
    [featuredListingImages, listingImageById]
  );
  const hasTrendData = trendPreviewSeries.some((point) => Number(point.total) > 0);
  const hasHeroMedia = featuredListingImages.length > 0 || hasTrendData;
  const overviewClassName = [
    "storefront-dashboard seller-dashboard seller-dashboard--overview",
    "seller-dashboard--overview-v2",
    "seller-dashboard--neo",
    `seller-dashboard--overview-kpis-${Math.min(4, Math.max(1, visibleKpiCount))}`,
    showRevenuePanel ? "seller-dashboard--has-revenue" : "seller-dashboard--no-revenue",
    showActivityPanel ? "seller-dashboard--has-activity" : "seller-dashboard--no-activity",
    hasHeroMedia ? "seller-dashboard--has-hero" : "seller-dashboard--no-hero",
  ].join(" ");

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

  const orderStatusMix = useMemo(() => {
    const buckets = { paid: 0, pending: 0, issue: 0 };
    sellerOrders.forEach((order) => {
      const status = String(order.status || "").toLowerCase();
      if (["paid", "approved", "completed", "delivered"].includes(status)) {
        buckets.paid += 1;
        return;
      }
      if (["pending", "processing"].includes(status)) {
        buckets.pending += 1;
        return;
      }
      if (["refunded", "cancelled", "disputed"].includes(status)) {
        buckets.issue += 1;
        return;
      }
      buckets.pending += 1;
    });
    const total = buckets.paid + buckets.pending + buckets.issue;
    const safeTotal = total || 1;
    const percent = {
      paid: Math.round((buckets.paid / safeTotal) * 100),
      pending: Math.round((buckets.pending / safeTotal) * 100),
      issue: Math.round((buckets.issue / safeTotal) * 100),
    };
    const sum = percent.paid + percent.pending + percent.issue;
    if (sum !== 100) {
      const diff = 100 - sum;
      const keys: Array<keyof typeof percent> = ["paid", "pending", "issue"];
      const largest = keys.reduce((current, key) =>
        percent[key] >= percent[current] ? key : current
      );
      percent[largest] += diff;
    }
    return { total, buckets, percent };
  }, [sellerOrders]);

  const setupCompletedCount = useMemo(
    () => setupChecklist.filter((item) => item.status === "done").length,
    [setupChecklist]
  );

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
  const displayBidsLoading = !isMockMode && bidsLoading;
  const displayBidsError = !isMockMode ? bidsError : null;
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

  const buildCardStyle = useCallback(
    (id?: string) => {
      void id;
      const background = baseCardBg;
      return {
        "--seller-card-bg": background,
        backgroundColor: background,
      } as CSSProperties;
    },
    [baseCardBg]
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
                recentOrderSummary.map(({ count, displayOrder }) => (
                  <div key={`order-summary-${displayOrder.id}`} className="storefront-widget-row">
                    <span>
                      {displayOrder.listingTitle}
                      {count > 1 ? ` (x${count})` : ""}
                    </span>
                    <div className="seller-row-meta">
                      <strong>
                        {formatCurrency(displayOrder.amount, displayOrder.currency)}
                      </strong>
                      <span
                        className={`seller-status-chip ${getStatusTone(displayOrder.status)}`}
                      >
                        {displayOrder.status}
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
            !displayOfferLoading && !displayOfferError && openOffers.length === 0;
          return (
            <div className="storefront-widget-list">
              {displayOfferLoading && <p>Loading offers…</p>}
              {displayOfferError && <p>{displayOfferError}</p>}
              {offerActionError && <p className="storefront-form-error">{offerActionError}</p>}
              {offerActionNotice && (
                <p className="storefront-status success">{offerActionNotice}</p>
              )}
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
              {!isEmpty && offerListingOptions.length > 0 && (
                <div className="seller-listing-filter">
                  <label htmlFor="seller-offer-listing">Listing</label>
                  <select
                    id="seller-offer-listing"
                    value={
                      offerListingFilter ||
                      offerListingOptions[0]?.id ||
                      ""
                    }
                    onChange={(event) => setOfferListingFilter(event.target.value)}
                  >
                    {offerListingOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!isEmpty &&
                filteredOffers.slice(0, 4).map((offer) => {
                  const actionable = isOfferActionable(offer);
                  const loading = offerActionLoading[offer.id];
                  return (
                    <div key={offer.id} className="storefront-widget-row storefront-widget-row--offer">
                      <div className="seller-row-main">
                        <span>{offer.listingTitle || "Listing offer"}</span>
                        <span className="seller-row-sub">
                          Buyer: {offer.buyerName} · {offer.createdAt}
                        </span>
                      </div>
                      <div className="seller-row-meta">
                        <strong>{formatCurrency(offer.offeredPrice, offer.currency)}</strong>
                        <span className={`seller-status-chip ${getStatusTone(offer.status)}`}>
                          {offer.status}
                        </span>
                      </div>
                      {offer.note && <p className="seller-row-note">{offer.note}</p>}
                      <div className="seller-row-actions">
                        {actionable ? (
                          <>
                            <button
                              className="btn primary small"
                              type="button"
                              disabled={loading}
                              onClick={() => handleOfferStatusUpdate(offer.id, "accepted")}
                            >
                              {loading ? "Saving..." : "Accept"}
                            </button>
                            <button
                              className="btn danger small"
                              type="button"
                              disabled={loading}
                              onClick={() => handleOfferStatusUpdate(offer.id, "declined")}
                            >
                              Decline
                            </button>
                          </>
                        ) : (
                          <span className="seller-row-muted">Waiting on buyer</span>
                        )}
                      </div>
                      {actionable && (
                        <div className="seller-row-counter">
                          <input
                            type="number"
                            inputMode="decimal"
                            placeholder="Counter offer"
                            value={
                              offerCounterDrafts[offer.id] ??
                              (Number.isFinite(offer.offeredPrice)
                                ? offer.offeredPrice.toFixed(2)
                                : "")
                            }
                            onChange={(event) =>
                              setOfferCounterDrafts((prev) => ({
                                ...prev,
                                [offer.id]: event.target.value,
                              }))
                            }
                          />
                          <input
                            type="text"
                            placeholder="Note (optional)"
                            value={offerCounterNotes[offer.id] ?? ""}
                            onChange={(event) =>
                              setOfferCounterNotes((prev) => ({
                                ...prev,
                                [offer.id]: event.target.value,
                              }))
                            }
                          />
                          <button
                            className="btn ghost small"
                            type="button"
                            disabled={loading}
                            onClick={() => handleOfferCounter(offer.id)}
                          >
                            Send counter
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        }
      case "bids": {
        const isEmpty = !displayBidsLoading && !displayBidsError && openBids.length === 0;
        return (
          <div className="storefront-widget-list">
            {displayBidsLoading && <p>Loading bids…</p>}
            {displayBidsError && <p>{displayBidsError}</p>}
            {bidActionError && <p className="storefront-form-error">{bidActionError}</p>}
            {bidActionNotice && <p className="storefront-status success">{bidActionNotice}</p>}
            {isEmpty && (
              <div className="seller-empty">
                <p>No bids yet.</p>
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
            {!isEmpty && bidListingOptions.length > 0 && (
              <div className="seller-listing-filter">
                <label htmlFor="seller-bid-listing">Listing</label>
                <select
                  id="seller-bid-listing"
                  value={bidListingFilter || bidListingOptions[0]?.id || ""}
                  onChange={(event) => setBidListingFilter(event.target.value)}
                >
                  {bidListingOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!isEmpty &&
              filteredBids.slice(0, 4).map((bid) => {
                const loading = bidActionLoading[bid.id];
                return (
                  <div key={bid.id} className="storefront-widget-row storefront-widget-row--offer">
                    <div className="seller-row-main">
                      <span>{bid.listingTitle || "Listing bid"}</span>
                      <span className="seller-row-sub">
                        Bidder: {bid.bidderName} · {bid.createdAt}
                      </span>
                    </div>
                    <div className="seller-row-meta">
                      <strong>{formatCurrency(bid.amount, bid.currency)}</strong>
                      <span className={`seller-status-chip ${getStatusTone(bid.status)}`}>
                        {bid.status}
                      </span>
                    </div>
                    <div className="seller-row-actions">
                      <button
                        className="btn primary small"
                        type="button"
                        disabled={loading}
                        onClick={() => handleBidStatusUpdate(bid.id, "accepted")}
                      >
                        {loading ? "Saving..." : "Accept"}
                      </button>
                      <button
                        className="btn danger small"
                        type="button"
                        disabled={loading}
                        onClick={() => handleBidStatusUpdate(bid.id, "declined")}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            {!isEmpty && (
              <p className="seller-row-muted">
                Accept the highest bid after the auction ends.
              </p>
            )}
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
                {messageThreads.length} total
              </span>
            </div>
            {messageActionError && (
              <p className="storefront-form-error">{messageActionError}</p>
            )}
            {messageActionNotice && (
              <p className="storefront-status success">{messageActionNotice}</p>
            )}
            {messageThreads.length > 0 && (
              <div className="storefront-message-list">
                {messageThreads.map((thread) => {
                  const key = thread.key;
                  const threadMessages = thread.messages.slice(-2);
                  return (
                    <div
                      key={thread.key}
                      className="storefront-message-mini storefront-message-mini--rich"
                    >
                      <div className="storefront-message-mini-header">
                        <div>
                          <strong>{thread.counterpartName}</strong>
                          <span>{thread.listingTitle || "Listing chat"}</span>
                        </div>
                        <span className="seller-row-sub">
                          {thread.lastMessageLabel}
                        </span>
                      </div>
                      <div className="storefront-message-thread">
                        {threadMessages.map((entry) => {
                          const isMine = entry.senderId === user?.id;
                          return (
                            <div
                              key={entry.id}
                              className={`storefront-thread-message${
                                isMine ? " is-me" : ""
                              }`}
                            >
                              <div className="storefront-thread-message-header">
                                <strong>{entry.senderName}</strong>
                                <span>{entry.createdAt}</span>
                              </div>
                              <p className="storefront-thread-message-body">
                                {entry.body}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      <div className="seller-row-actions">
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={() => handleMessageReplyToggle(key)}
                        >
                          {messageReplyOpen[key] ? "Hide reply" : "Reply"}
                        </button>
                      </div>
                      {messageReplyOpen[key] && (
                        <div className="storefront-message-reply">
                          <textarea
                            rows={2}
                            placeholder={`Reply to ${thread.counterpartName}`}
                            value={messageDrafts[key] ?? ""}
                            onChange={(event) =>
                              setMessageDrafts((prev) => ({
                                ...prev,
                                [key]: event.target.value,
                              }))
                            }
                          />
                          <button
                            className="btn primary small"
                            type="button"
                            disabled={messageSending[key]}
                            onClick={() => handleSendMarketplaceReply(thread)}
                          >
                            {messageSending[key] ? "Sending..." : "Send"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      case "verification":
        return (() => {
          const idItem = sellerVerificationItems.find(
            (item) => item.label.toLowerCase() === "age verification"
          );
          const payoutItem = sellerVerificationItems.find(
            (item) => item.label.toLowerCase() === "payout method"
          );
          const activityItem = sellerVerificationItems.find(
            (item) => item.label.toLowerCase() === "activity history"
          );
          const idStatus = idItem?.status || "pending";
          const isIdVerified = idStatus === "verified";
          const idTitle = isIdVerified ? "Age verified" : "Age verification required";
          const idCopy = isIdVerified
            ? "Your age is verified for marketplace access."
            : "Verify your age to keep your seller account active and unlock buyer trust.";
          const actionLabel = "Verify now";
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
                  <p className="seller-fee-note">
                    {sellerIsVerified
                      ? "Verified sellers pay a 2% transaction fee."
                      : "Non-verified sellers pay a 4% transaction fee until verification is complete."}
                  </p>
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

  const dashboardModuleTitles: Record<string, string> = {
    totalEarnings: "Total Sales",
    payouts: "Payout Balance",
    orders: "Orders",
    conversion: "Conversion",
    verification: "Verification",
    setup: "Setup checklist",
    activeListings: "Active Listings",
    buyerDisputes: "Buyer Disputes",
  };

  const openDashboardModule = (moduleId: string) => {
    setActiveDashboardModule(moduleId);
  };

  const closeDashboardModule = () => {
    setActiveDashboardModule(null);
  };

  const handleModuleClick =
    (moduleId: string) => (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, select, textarea, label")) return;
      openDashboardModule(moduleId);
    };

  const handleModuleKeyDown =
    (moduleId: string) => (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDashboardModule(moduleId);
      }
    };

  const activeDashboardTitle = activeDashboardModule
    ? dashboardModuleTitles[activeDashboardModule] ?? "Details"
    : "";

  const renderDashboardModuleContent = (moduleId: string) => {
    switch (moduleId) {
      case "conversion":
        return (
          <div className="seller-module-metric">
            <div className="seller-module-value">{conversionRate.toFixed(1)}%</div>
            <p className="seller-module-sub">Conversion from StoreFront listings.</p>
          </div>
        );
      case "setup":
        return (
          <div className="seller-module-stack">
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
        );
      case "orders":
        return (
          <div className="seller-module-stack">
            <div className="seller-panel-body">{renderWidgetContent("orders")}</div>
            {!hiddenWidgets.includes("offers") && (
              <div className="seller-panel-subsection">
                <div className="seller-panel-subheader">
                  <span className="seller-panel-eyebrow">Offers</span>
                  <h4>Offers</h4>
                </div>
                <div className="seller-panel-body">{renderWidgetContent("offers")}</div>
              </div>
            )}
            {!hiddenWidgets.includes("bids") && (
              <div className="seller-panel-subsection">
                <div className="seller-panel-subheader">
                  <span className="seller-panel-eyebrow">Bids</span>
                  <h4>Bids</h4>
                </div>
                <div className="seller-panel-body">{renderWidgetContent("bids")}</div>
              </div>
            )}
          </div>
        );
      case "payouts":
        return (
          <div className="seller-module-stack">
            <div className="seller-panel-body">{renderWidgetContent("payouts")}</div>
            <p className="seller-panel-note">
              Sales payouts appear here within 2 business days after completion.
            </p>
          </div>
        );
      default:
        return renderWidgetContent(moduleId);
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
        <span className="storefront-fee-note">
          {sellerFeePercent}% platform fee
        </span>
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
                  <label>{draft.auctionEnabled ? "Buy now price" : "Price"}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.price}
                    onChange={(event) => updateDraft({ price: event.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="storefront-field storefront-field--wide">
                  <label>Auction</label>
                  <div className="storefront-switch-grid">
                    <label className="storefront-switch">
                      <input
                        type="checkbox"
                        checked={draft.auctionEnabled}
                        onChange={(event) =>
                          updateDraft({
                            auctionEnabled: event.target.checked,
                          })
                        }
                      />
                      <span className="storefront-switch-track" aria-hidden="true" />
                      <span className="storefront-switch-label">Enable bidding</span>
                    </label>
                  </div>
                  {draft.auctionEnabled && (
                    <div className="storefront-auction-fields">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={draft.startingBid}
                        onChange={(event) =>
                          updateDraft({ startingBid: event.target.value })
                        }
                        placeholder="Starting bid"
                      />
                      <input
                        type="datetime-local"
                        value={draft.auctionEndAt}
                        onChange={(event) =>
                          updateDraft({ auctionEndAt: event.target.value })
                        }
                      />
                      <p className="storefront-field-hint">
                        Starting bid must be less than or equal to the buy now price.
                      </p>
                    </div>
                  )}
                </div>
                <div className="storefront-field">
                  <label>Category</label>
                  <select
                    value={draft.category}
                    onChange={(event) => updateDraft({ category: event.target.value })}
                  >
                    {CATEGORY_OPTIONS.filter(
                      (option) => option !== "All" && option !== "Free"
                    ).map((option) => (
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
                  <label>Listing status</label>
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      updateDraft({
                        status: event.target.value as DraftProduct["status"],
                      })
                    }
                    disabled={draft.status === "sold"}
                  >
                    {draft.status === "sold" && <option value="sold">Sold (locked)</option>}
                    <option value="active">Active (visible)</option>
                    <option value="pending">Pending (hidden)</option>
                    <option value="archived">Archived</option>
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
                  {photoNotice && (
                    <span className="storefront-field-hint">{photoNotice}</span>
                  )}
                  {unverifiedPhotoCount > 0 && (
                    <span className="storefront-field-hint warning">
                      We could not verify camera metadata for {unverifiedPhotoCount} photo
                      {unverifiedPhotoCount === 1 ? "" : "s"}. Please use original camera
                      photos.
                    </span>
                  )}
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
            {bulkListings.map((item, index) => {
              const unverifiedCount = countUnverifiedPhotos(item.images);
              return (
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
                    <label>{item.auctionEnabled ? "Buy now price" : "Price"}</label>
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
                  <div className="storefront-field storefront-field--wide">
                    <label>Auction</label>
                    <div className="storefront-switch-grid">
                      <label className="storefront-switch">
                        <input
                          type="checkbox"
                          checked={item.auctionEnabled}
                          onChange={(event) =>
                            updateBulkListing(item.id, {
                              auctionEnabled: event.target.checked,
                            })
                          }
                        />
                        <span className="storefront-switch-track" aria-hidden="true" />
                        <span className="storefront-switch-label">Enable bidding</span>
                      </label>
                    </div>
                    {item.auctionEnabled && (
                      <div className="storefront-auction-fields">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={item.startingBid}
                          onChange={(event) =>
                            updateBulkListing(item.id, {
                              startingBid: event.target.value,
                            })
                          }
                          placeholder="Starting bid"
                        />
                        <input
                          type="datetime-local"
                          value={item.auctionEndAt}
                          onChange={(event) =>
                            updateBulkListing(item.id, {
                              auctionEndAt: event.target.value,
                            })
                          }
                        />
                      <p className="storefront-field-hint">
                          Starting bid must be less than or equal to the buy now price.
                      </p>
                      </div>
                    )}
                  </div>
                  <div className="storefront-field">
                    <label>Category</label>
                    <select
                      value={item.category}
                      onChange={(event) =>
                        updateBulkListing(item.id, { category: event.target.value })
                      }
                    >
                      {CATEGORY_OPTIONS.filter(
                        (option) => option !== "All" && option !== "Free"
                      ).map((option) => (
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
                    <label>Listing status</label>
                    <select
                      value={item.status}
                      onChange={(event) =>
                        updateBulkListing(item.id, {
                          status: event.target.value as DraftProduct["status"],
                        })
                      }
                      disabled={item.status === "sold"}
                    >
                      {item.status === "sold" && (
                        <option value="sold">Sold (locked)</option>
                      )}
                      <option value="active">Active (visible)</option>
                      <option value="pending">Pending (hidden)</option>
                      <option value="archived">Archived</option>
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
                  {unverifiedCount > 0 && (
                    <span className="storefront-field-hint warning">
                      We could not verify camera metadata for {unverifiedCount} photo
                      {unverifiedCount === 1 ? "" : "s"}. Please use original camera photos.
                    </span>
                  )}
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
              );
            })}
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
    <div
      className={`dashboard-shell storefront-shell${
        isListingView ? "" : " storefront-shell--seller-messages"
      }`}
      style={pageBackground}
    >
      <Sidebar active="storefront" />
      <div className="main-content storefront-page">
        {isListingView ? (
          <section className="storefront-layout is-single storefront-layout--listing">
            <div className="storefront-left">{listingPanel}</div>
          </section>
      ) : (
        <section
          className={overviewClassName}
          style={dashboardStyle}
        >
            <div className="seller-dashboard-grid seller-dashboard-grid--overview">
              <div className="seller-dashboard-topbar seller-overview-block seller-overview-block--topbar">
                <header className="seller-dashboard-header">
                  <div className="seller-dashboard-title">
                    <div className="seller-dashboard-icon" aria-hidden="true">
                      <span>🛍️</span>
                    </div>
                    <div>
                      <span className="seller-dashboard-kicker">Seller Workspace</span>
                      <h2>Storefront Control Center</h2>
                      {sellerIsVerified && (
                        <span className="seller-verified-badge">Verified seller</span>
                      )}
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
                      onClick={() => setCustomizeOpen(true)}
                    >
                      Customize
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
                              {sellerIsVerified && (
                                <span className="seller-verified-badge">Verified seller</span>
                              )}
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
                  {hasHeroMedia && (
                    <div
                      className={`seller-dashboard-hero-media${
                        hasTrendData ? "" : " is-media-only"
                      }`}
                    >
                      {hasTrendData && (
                        <div
                          className="seller-dashboard-mini-chart"
                          role="img"
                          aria-label="Revenue trend"
                        >
                          {trendPreviewSeries.map((point, index) => (
                            <span
                              key={`trend-preview-${index}`}
                              style={{
                                height: `${Math.max(
                                  10,
                                  (point.total / Math.max(earningsSparkMax, 1)) * 100
                                )}%`,
                              }}
                            />
                          ))}
                        </div>
                      )}
                      <div className="seller-dashboard-media-grid">
                        {featuredListingImages.map((imageUrl, index) => (
                          <figure
                            className="seller-dashboard-media-tile"
                            key={`featured-listing-${index}`}
                          >
                            <img
                              src={imageUrl}
                              alt={`Listing preview ${index + 1}`}
                              loading="lazy"
                            />
                          </figure>
                        ))}
                      </div>
                    </div>
                  )}
                </header>

              </div>

              <div className="seller-dashboard-kpis seller-overview-block seller-overview-block--kpis">
                {!hiddenWidgets.includes("totalEarnings") && (
                <div
                  className="seller-kpi-card seller-kpi-card--k1"
                  style={buildCardStyle("totalEarnings")}
                  role="button"
                  tabIndex={0}
                  onClick={handleModuleClick("totalEarnings")}
                  onKeyDown={handleModuleKeyDown("totalEarnings")}
                  aria-label="View total sales details"
                >
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
                <div
                  className="seller-kpi-card seller-kpi-card--k2"
                  style={buildCardStyle("payouts")}
                  role="button"
                  tabIndex={0}
                  onClick={handleModuleClick("payouts")}
                  onKeyDown={handleModuleKeyDown("payouts")}
                  aria-label="View payout details"
                >
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
                <div
                  className="seller-kpi-card seller-kpi-card--k3"
                  style={buildCardStyle("orders")}
                  role="button"
                  tabIndex={0}
                  onClick={handleModuleClick("orders")}
                  onKeyDown={handleModuleKeyDown("orders")}
                  aria-label="View order details"
                >
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
              <div
                className="seller-kpi-card seller-kpi-card--k4"
                style={buildCardStyle()}
                role="button"
                tabIndex={0}
                onClick={handleModuleClick("conversion")}
                onKeyDown={handleModuleKeyDown("conversion")}
                aria-label="View conversion details"
              >
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

              </div>

                {showRevenuePanel && (
                  <div
                    className="seller-panel seller-panel--overview-revenue seller-overview-block seller-overview-block--revenue"
                    style={buildCardStyle("totalEarnings")}
                    role="button"
                    tabIndex={0}
                    onClick={handleModuleClick("totalEarnings")}
                    onKeyDown={handleModuleKeyDown("totalEarnings")}
                    aria-label="View revenue details"
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

                {showActivityPanel && (
                  <div
                    className="seller-panel seller-panel--overview-activity seller-overview-block seller-overview-block--activity"
                    style={buildCardStyle("orders")}
                    role="button"
                    tabIndex={0}
                    onClick={handleModuleClick("orders")}
                    onKeyDown={handleModuleKeyDown("orders")}
                    aria-label="View recent orders"
                  >
                    <div className="seller-panel-header">
                      <div>
                        <span className="seller-panel-eyebrow">Recent activity</span>
                        <h3>Recent activity</h3>
                      </div>
                      <button className="seller-panel-action" type="button">
                        View all
                      </button>
                    </div>
                    <div className="seller-panel-body">
                      {displayOrdersLoading && <p>Loading orders...</p>}
                      {displayOrdersError && <p>{displayOrdersError}</p>}
                      {!displayOrdersLoading &&
                        !displayOrdersError &&
                        sellerOrders.length === 0 && (
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
                      {!displayOrdersLoading &&
                        !displayOrdersError &&
                        sellerOrders.length > 0 && (
                          <div className="seller-activity-table" role="table">
                            <div
                              className="seller-activity-row seller-activity-row--header"
                              role="row"
                            >
                              <span role="columnheader">Customer</span>
                              <span role="columnheader">Status</span>
                              <span role="columnheader">Amount</span>
                              <span role="columnheader" className="seller-activity-time">
                                When
                              </span>
                            </div>
                            {recentOrderSummary.map(({ count, displayOrder }) => {
                              const orderPreviewImage = getOrderPreviewImage(displayOrder);
                              return (
                                <div
                                  key={`order-activity-${displayOrder.id}`}
                                  className="seller-activity-row"
                                  role="row"
                                >
                                  <div className="seller-activity-customer" role="cell">
                                    <span className="seller-activity-thumb" aria-hidden="true">
                                      {orderPreviewImage ? (
                                        <img src={orderPreviewImage} alt="" loading="lazy" />
                                      ) : (
                                        <span className="seller-activity-thumb-fallback" />
                                      )}
                                    </span>
                                    <div className="seller-activity-customer-meta">
                                      <strong>{displayOrder.buyerName}</strong>
                                      <span>
                                        {displayOrder.listingTitle}
                                        {count > 1 ? ` (x${count})` : ""}
                                      </span>
                                    </div>
                                  </div>
                                  <span
                                    className={`seller-status-chip ${getStatusTone(displayOrder.status)}`}
                                    role="cell"
                                  >
                                    {displayOrder.status}
                                  </span>
                                  <div className="seller-activity-amount" role="cell">
                                    <strong>
                                      {formatCurrency(displayOrder.amount, displayOrder.currency)}
                                    </strong>
                                    <span>
                                      Net {formatCurrency(displayOrder.net, displayOrder.currency)}
                                    </span>
                                  </div>
                                  <span className="seller-activity-time" role="cell">
                                    {formatRelativeTime(displayOrder.createdAt)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                    </div>
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
                    {!hiddenWidgets.includes("bids") && (
                      <div className="seller-panel-subsection">
                        <div className="seller-panel-subheader">
                          <span className="seller-panel-eyebrow">Bids</span>
                          <h4>Bids</h4>
                        </div>
                        <div className="seller-panel-body">
                          {renderWidgetContent("bids")}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div
                  className="seller-panel seller-panel--overview-traffic seller-overview-block seller-overview-block--traffic"
                  style={buildCardStyle("status")}
                >
                  <div className="seller-panel-header">
                    <div>
                      <span className="seller-panel-eyebrow">Order mix</span>
                      <h3>Order status</h3>
                    </div>
                    <button
                      className="seller-panel-action"
                      type="button"
                      onClick={() => openDashboardModule("orders")}
                    >
                      View details
                    </button>
                  </div>
                  <div className="seller-panel-body">
                    {orderStatusMix.total === 0 ? (
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
                    ) : (
                      <div className="seller-traffic">
                        <div
                          className="seller-traffic-donut"
                          style={
                            {
                              "--seg-paid": `${orderStatusMix.percent.paid}%`,
                              "--seg-pending": `${orderStatusMix.percent.pending}%`,
                              "--seg-issue": `${orderStatusMix.percent.issue}%`,
                            } as CSSProperties
                          }
                          aria-hidden="true"
                        />
                        <div className="seller-traffic-legend">
                          <div className="seller-traffic-row">
                            <span className="seller-traffic-dot is-paid" />
                            <span>Paid</span>
                            <strong>{orderStatusMix.percent.paid}%</strong>
                          </div>
                          <div className="seller-traffic-row">
                            <span className="seller-traffic-dot is-pending" />
                            <span>Pending</span>
                            <strong>{orderStatusMix.percent.pending}%</strong>
                          </div>
                          <div className="seller-traffic-row">
                            <span className="seller-traffic-dot is-issue" />
                            <span>Issue</span>
                            <strong>{orderStatusMix.percent.issue}%</strong>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="seller-status-summary">
                      {!hiddenWidgets.includes("verification") && (
                        <div className="seller-status-row">
                          <div>
                            <span>Verification</span>
                            <strong>{sellerIsVerified ? "Verified" : "Not verified"}</strong>
                          </div>
                          {!sellerIsVerified && (
                            <button
                              className="btn danger small"
                              type="button"
                              onClick={handleRequestVerification}
                            >
                              Verify
                            </button>
                          )}
                        </div>
                      )}
                      {!hiddenWidgets.includes("payouts") && (
                        <div className="seller-status-row">
                          <div>
                            <span>Pending payouts</span>
                            <strong>
                              {pendingPayoutAmount
                                ? formatCurrency(pendingPayoutAmount, "USD")
                                : "None"}
                            </strong>
                          </div>
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => openDashboardModule("payouts")}
                          >
                            View
                          </button>
                        </div>
                      )}
                      {!hiddenWidgets.includes("activeListings") && (
                        <div className="seller-status-row">
                          <div>
                            <span>Active listings</span>
                            <strong>{sellerListings.length}</strong>
                          </div>
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => openDashboardModule("activeListings")}
                          >
                            Open
                          </button>
                        </div>
                      )}
                      <div className="seller-status-row">
                        <div>
                          <span>Setup checklist</span>
                          <strong>
                            {setupCompletedCount}/{setupChecklist.length}
                          </strong>
                        </div>
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={() => openDashboardModule("setup")}
                        >
                          Review
                        </button>
                      </div>
                      {!hiddenWidgets.includes("buyerDisputes") && (
                        <div className="seller-status-row">
                          <div>
                            <span>Open disputes</span>
                            <strong>{openDisputes.length}</strong>
                          </div>
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => openDashboardModule("buyerDisputes")}
                          >
                            View
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
          </section>
        )}
      </div>
      {!isListingView && (
        <aside
          className="seller-messages-sidebar"
          data-accent="storefront"
          aria-label="Seller messages"
        >
          <div className="seller-messages-scroll">
            {renderWidgetContent("messages")}
          </div>
        </aside>
      )}
      <PopupModal
        open={customizeOpen}
        title="Customize dashboard"
        onClose={() => setCustomizeOpen(false)}
        className="seller-customize-modal"
        bodyClassName="seller-customize-modal-body"
      >
        <div className="storefront-panel seller-dashboard-customize-panel">
          <div className="storefront-panel-header">
            <div>
              <p className="storefront-panel-eyebrow">Seller workspace</p>
              <h3>Dashboard layout</h3>
            </div>
            <div className="storefront-dashboard-actions">
              <button
                className="btn primary small"
                type="button"
                onClick={handleSaveDashboardChanges}
                disabled={
                  !activeViewId || !dashboardDirty || dashboardSaveState === "saving"
                }
              >
                {dashboardSaveState === "saving" ? "Saving..." : "Save changes"}
              </button>
              {dashboardSaveState === "saved" && (
                <span className="storefront-dashboard-save-status" role="status">
                  Saved
                </span>
              )}
              {dashboardSaveState === "error" && (
                <span className="storefront-dashboard-save-status is-error" role="status">
                  Save failed
                </span>
              )}
            </div>
          </div>
          <p className="seller-panel-note">
            Custom dashboard views and themes are disabled. Everyone uses the same
            default look.
          </p>
          {dashboardError && <p className="storefront-form-error">{dashboardError}</p>}
          <div className="storefront-dashboard-customize">
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
                        <span className="storefront-widget-helper">{widget.helper}</span>
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </PopupModal>
      <PopupModal
        open={Boolean(activeDashboardModule)}
        title={activeDashboardTitle}
        onClose={closeDashboardModule}
        className="seller-detail-modal"
        bodyClassName="seller-detail-modal-body"
      >
        {activeDashboardModule && renderDashboardModuleContent(activeDashboardModule)}
      </PopupModal>
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
