import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "../css/dashboard.css";
import "../css/storefront-listing.css";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { pickMediaUrls } from "../utils/media";

const PLATFORM_FEE_RATE = 0.03;
const USE_DEMO_LISTINGS = import.meta.env.DEV;

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
  rawId?: number;
  title: string;
  price: number;
  category: string;
  condition: string;
  location: string;
  description: string;
  images: string[];
  seller: StorefrontSeller;
  stock: number;
  shipping: string;
  shippingEnabled?: boolean;
  shippingCarriers?: string[];
  shippingInternational?: boolean;
  localPickup?: boolean;
  cashAccepted?: boolean;
  noShippingRequired?: boolean;
  shippingNotes?: string;
  isDemo?: boolean;
};

type StorefrontMessage = {
  id: string;
  productId: string;
  sender: "buyer" | "seller";
  senderName: string;
  body: string;
  timestamp: string;
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
  buyerPaymentProvider?: "stripe" | "paypal" | "cashapp" | "venmo" | "cash" | "other";
  buyerPaymentEmail?: string;
  buyerAddressLine1?: string;
  buyerAddressLine2?: string;
  buyerAddressCity?: string;
  buyerAddressRegion?: string;
  buyerAddressPostal?: string;
  buyerAddressCountry?: string;
  payoutProvider?: string;
  payoutEmail?: string;
  stripeIdentityStatus?: string;
};

type PaymentMethod = "paypal" | "stripe" | "cashapp" | "venmo" | "cash";

const CATEGORY_OPTIONS = [
  "All",
  "Free",
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

const DEMO_IMAGE_SETS = [
  [
    "https://images.unsplash.com/photo-1512499617640-c2f999098c01?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1487014679447-9f8336841d58?auto=format&fit=crop&w=900&q=80",
  ],
  [
    "https://images.unsplash.com/photo-1526401485004-46910ecc8e51?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=900&q=80",
  ],
  [
    "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1523206489230-c012c64b2b48?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=900&q=80",
  ],
  [
    "https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1519181245277-cffeb31da2e3?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1453672915606-6e4bafafbb9d?auto=format&fit=crop&w=900&q=80",
  ],
  [
    "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1501045661006-fcebe0257c3f?auto=format&fit=crop&w=900&q=80",
  ],
];

const DEMO_TITLES = [
  "Designer lounge chair",
  "Portable espresso kit",
  "Smart home starter set",
  "Wireless noise-canceling headphones",
  "Trail-ready camera backpack",
  "Limited edition vinyl set",
  "Ergonomic standing desk",
  "Handmade ceramic dinnerware",
  "Compact travel drone",
  "Studio lighting kit",
];

const DEMO_LOCATIONS = [
  "Seattle, WA",
  "Austin, TX",
  "Portland, OR",
  "Denver, CO",
  "San Diego, CA",
  "Chicago, IL",
];

const DEFAULT_PRODUCTS: StorefrontProduct[] = [
  {
    id: "camera-kit",
    title: "Vintage film camera kit",
    price: 0.01,
    category: "Collectibles",
    condition: "Good",
    location: "Seattle, WA",
    description:
      "Full 35mm starter kit with lenses, light meter, and fresh film rolls. Cleaned and ready to shoot.",
    images: [
      "https://images.unsplash.com/photo-1452587925148-ce544e77e70d?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1519181245277-cffeb31da2e3?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1453672915606-6e4bafafbb9d?auto=format&fit=crop&w=900&q=80",
    ],
    seller: {
      id: "seller-1",
      userId: 0,
      name: "Avery Lopez",
      rating: 4.9,
      responseTime: "Typically replies within 1 hour",
      verifiedLevel: "verified",
      badges: ["ID verified", "Payout verified"],
    },
    stock: 1,
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
    id: "desk-setup",
    title: "Minimalist desk setup bundle",
    price: 0.01,
    category: "Home",
    condition: "Like new",
    location: "Portland, OR",
    description:
      "Complete workspace set: oak desk, ergonomic chair, and adjustable lamp. Pickup preferred.",
    images: [
      "https://images.unsplash.com/photo-1487014679447-9f8336841d58?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=900&q=80",
    ],
    seller: {
      id: "seller-2",
      userId: 0,
      name: "Morgan Tate",
      rating: 4.7,
      responseTime: "Typically replies within 2 hours",
      verifiedLevel: "pending",
      badges: ["ID verified", "Payment pending"],
    },
    stock: 1,
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
    id: "fitness-kit",
    title: "At-home fitness starter kit",
    price: 0.01,
    category: "Fitness",
    condition: "New",
    location: "Austin, TX",
    description:
      "Resistance bands, yoga mat, and adjustable dumbbells. Unopened and ready to ship.",
    images: [
      "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1526401485004-46910ecc8e51?auto=format&fit=crop&w=900&q=80",
    ],
    seller: {
      id: "seller-3",
      userId: 0,
      name: "Jordan Reed",
      rating: 4.8,
      responseTime: "Typically replies within 30 minutes",
      verifiedLevel: "verified",
      badges: ["ID verified", "Payout verified"],
    },
    stock: 4,
    shipping: "Delivery arranged privately",
    shippingEnabled: false,
    shippingCarriers: [],
    shippingInternational: false,
    localPickup: false,
    cashAccepted: false,
    shippingNotes: "",
    noShippingRequired: true,
    isDemo: true,
  },
  {
    id: "smartphone",
    title: "Unlocked smartphone 256GB",
    price: 0.01,
    category: "Electronics",
    condition: "Good",
    location: "Denver, CO",
    description:
      "Unlocked, lightly used, includes case and fast charger. Battery health 92%.",
    images: [
      "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1523206489230-c012c64b2b48?auto=format&fit=crop&w=900&q=80",
    ],
    seller: {
      id: "seller-4",
      userId: 0,
      name: "Skylar Brooks",
      rating: 4.6,
      responseTime: "Typically replies within 4 hours",
      verifiedLevel: "verified",
      badges: ["ID verified", "Phone verified"],
    },
    stock: 2,
    shipping: "Delivery arranged privately",
    shippingEnabled: false,
    shippingCarriers: [],
    shippingInternational: false,
    localPickup: true,
    cashAccepted: false,
    shippingNotes: "",
    noShippingRequired: true,
    isDemo: true,
  },
];

const DEFAULT_MESSAGES: StorefrontMessage[] = [];

const buildDemoListings = (count: number, startIndex = 0): StorefrontProduct[] => {
  const total = Math.max(1, Math.min(20, count));
  return Array.from({ length: total }).map((_, index) => {
    const seed = startIndex + index;
    const title = DEMO_TITLES[seed % DEMO_TITLES.length];
    const category = CATEGORY_OPTIONS[(seed % (CATEGORY_OPTIONS.length - 1)) + 1];
    const condition = CONDITION_OPTIONS[(seed % (CONDITION_OPTIONS.length - 1)) + 1];
    const location = DEMO_LOCATIONS[seed % DEMO_LOCATIONS.length];
    const images = DEMO_IMAGE_SETS[seed % DEMO_IMAGE_SETS.length];
    const price = 0.01;
    return {
      id: `demo-${seed + 1}`,
      title,
      price,
      category,
      condition,
      location,
      description:
        "Demo listing for StoreFront previews. Swap this out with real seller inventory when live.",
      images,
      seller: {
        id: `demo-seller-${seed % 4}`,
        userId: 0,
        name: "Demo Seller",
        rating: 4.8,
        responseTime: "Typically replies within 1 hour",
        verifiedLevel: "verified",
        badges: ["ID verified", "Payout verified"],
      },
      stock: 1 + (seed % 5),
      shipping: "Delivery arranged privately",
      shippingEnabled: false,
      shippingCarriers: [],
      shippingInternational: false,
      localPickup: seed % 2 === 0,
      cashAccepted: seed % 3 === 0,
      shippingNotes: "",
      noShippingRequired: true,
      isDemo: true,
    };
  });
};

const DEMO_FALLBACK_PRODUCTS = USE_DEMO_LISTINGS
  ? [...DEFAULT_PRODUCTS, ...buildDemoListings(20, 0)]
  : [];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const formatPrice = (value: number) => (value <= 0 ? "Free" : currency.format(value));
const roundCurrency = (value: number) => Math.round(value * 100) / 100;
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

const normalizeStatus = (value?: string | null): VerificationItem["status"] => {
  if (value === "verified" || value === "pending" || value === "optional") {
    return value;
  }
  return "optional";
};

const buildSellerVerification = (status?: VerificationStatus | null): VerificationItem[] => [
  {
    label: "Government ID",
    status: normalizeStatus(status?.sellerIdStatus),
    detail: "Optional for verified seller badge",
  },
  {
    label: "Payout method",
    status: normalizeStatus(status?.sellerPayoutStatus),
    detail: "Optional payout verification",
  },
  {
    label: "Activity history",
    status: "pending",
    detail: "Earn buyer trust over time",
  },
];

export default function StorefrontListing() {
  const { user } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const { listingId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [products, setProducts] = useState<StorefrontProduct[]>(
    USE_DEMO_LISTINGS ? DEMO_FALLBACK_PRODUCTS : []
  );
  const [selectedId, setSelectedId] = useState(
    USE_DEMO_LISTINGS ? DEMO_FALLBACK_PRODUCTS[0]?.id || "" : ""
  );
  const [messages, setMessages] = useState<StorefrontMessage[]>(DEFAULT_MESSAGES);
  const [messageDraft, setMessageDraft] = useState("");
  const [loadingListings, setLoadingListings] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [offers, setOffers] = useState<StorefrontOffer[]>([]);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [offerNotice, setOfferNotice] = useState<string | null>(null);
  const [offerDraftPrice, setOfferDraftPrice] = useState("");
  const [offerDraftNote, setOfferDraftNote] = useState("");
  const [query] = useState("");
  const [categoryFilter] = useState("All");
  const [conditionFilter] = useState("Any");
  const [sortMode] = useState<"default" | "trending">("default");
  const [selfVerification, setSelfVerification] = useState<VerificationStatus | null>(null);
  const [sellerVerification, setSellerVerification] = useState<VerificationStatus | null>(
    null
  );
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("paypal");
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const captureGuardRef = useRef<string | null>(null);
  const offerPanelRef = useRef<HTMLDivElement | null>(null);

  usePageMeta({
    title: "StoreFront | Your Social Place",
    description:
      "Browse and sell curated listings. Optional verified seller badge with secure messaging.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const sellerVerificationItems = useMemo(
    () => buildSellerVerification(sellerVerification),
    [sellerVerification]
  );

  const loadListings = useCallback(async () => {
    setLoadingListings(true);
    setListingError(null);
    try {
      const res = await api.get(
        "/marketplace-listings?populate[0]=images&populate[1]=owner&sort=createdAt:desc"
      );
      const entries = Array.isArray(res.data?.data) ? res.data.data : [];
      const mapped: StorefrontProduct[] = entries.map((entry: any) => {
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
        const shippingSummary = attrs.localPickup
          ? "Local pickup available"
          : "Delivery arranged privately";
        return {
          id: String(entry?.id ?? attrs.documentId ?? attrs.id ?? Date.now()),
          rawId: Number(entry?.id ?? attrs.documentId ?? attrs.id) || undefined,
          title: String(attrs.title || "Untitled listing"),
          price: Number(attrs.price || 0),
          category: String(attrs.category || "General"),
          condition: String(attrs.condition || "Good"),
          location: String(attrs.location || "Flexible pickup"),
          description: String(attrs.description || ""),
          images,
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
        } satisfies StorefrontProduct;
      });
      let verifiedMap = new Map<number, StorefrontSeller["verifiedLevel"]>();
      const sellerIds = Array.from(
        new Set(
          mapped
            .map((product: StorefrontProduct) => product.seller.userId)
            .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
        )
      );
      if (sellerIds.length) {
        try {
          const query = sellerIds
            .map((id, index) => `filters[owner][id][$in][${index}]=${id}`)
            .join("&");
          const verificationRes = await api.get(
            `/marketplace-verifications?populate=owner&${query}`
          );
          const verificationEntries = Array.isArray(verificationRes.data?.data)
            ? verificationRes.data.data
            : [];
          verificationEntries.forEach((entry: any) => {
            const attrs = normalize(entry);
            const ownerId = getEntityId(attrs.owner ?? entry?.owner);
            if (!ownerId) return;
            const sellerIdStatus = attrs.sellerIdStatus;
            const sellerPayoutStatus = attrs.sellerPayoutStatus;
            let level: StorefrontSeller["verifiedLevel"] = "unverified";
            if (sellerIdStatus === "verified" && sellerPayoutStatus === "verified") {
              level = "verified";
            } else if (sellerIdStatus === "pending" || sellerPayoutStatus === "pending") {
              level = "pending";
            }
            verifiedMap.set(ownerId, level);
          });
        } catch {
          verifiedMap = new Map();
        }
      }
      const enriched: StorefrontProduct[] = mapped.map((product: StorefrontProduct) => {
        const sellerId = product.seller.userId;
        const level = sellerId ? verifiedMap.get(sellerId) : undefined;
        if (!level) return product;
        const badges =
          level === "verified"
            ? Array.from(new Set([...product.seller.badges, "Verified seller"]))
            : product.seller.badges;
        return {
          ...product,
          seller: {
            ...product.seller,
            verifiedLevel: level,
            badges,
          },
        };
      });
      const fallback = USE_DEMO_LISTINGS ? DEMO_FALLBACK_PRODUCTS : [];
      const nextProducts = enriched.length ? enriched : fallback;
      setProducts(nextProducts);
      const nextSelectedId =
        listingId &&
        nextProducts.some((product: StorefrontProduct) => product.id === listingId)
          ? listingId
          : nextProducts[0]?.id || "";
      setSelectedId(nextSelectedId);
    } catch (err) {
      setListingError("Unable to load listings right now.");
      const fallback = USE_DEMO_LISTINGS ? DEMO_FALLBACK_PRODUCTS : [];
      setProducts(fallback);
      const nextSelectedId =
        listingId &&
        fallback.some((product: StorefrontProduct) => product.id === listingId)
          ? listingId
          : fallback[0]?.id || "";
      setSelectedId(nextSelectedId);
    } finally {
      setLoadingListings(false);
    }
  }, [listingId]);

  const fetchVerificationForUser = useCallback(async (userId?: number | null) => {
    if (!userId) return null;
    try {
      const res = await api.get(
        `/marketplace-verifications?filters[owner][id][$eq]=${userId}`
      );
      const entry = Array.isArray(res.data?.data) ? res.data.data[0] : null;
      return normalize(entry) as VerificationStatus;
    } catch {
      return null;
    }
  }, []);

  const loadSelfVerification = useCallback(async () => {
    try {
      const res = await api.get("/marketplace-verifications/me");
      const entry = res.data?.data;
      setSelfVerification(entry ? (normalize(entry) as VerificationStatus) : null);
    } catch {
      setSelfVerification(null);
    }
  }, []);

  const loadSellerVerification = useCallback(
    async (sellerId?: number | null) => {
      if (!sellerId) {
        setSellerVerification(null);
        return;
      }
      const status = await fetchVerificationForUser(sellerId);
      setSellerVerification(status);
    },
    [fetchVerificationForUser]
  );

  const handleRequestSellerVerification = async () => {
    if (verificationLoading) return;
    setVerificationNotice(null);
    setVerificationError(null);

    const payload: Partial<VerificationStatus> = {};
    type StatusKey = "sellerIdStatus" | "sellerPayoutStatus";
    const markPending = (key: StatusKey, value?: string) => {
      if (value !== "verified") {
        payload[key] = "pending";
      }
    };

    if (!selfVerification) {
      payload.sellerIdStatus = "pending";
      payload.sellerPayoutStatus = "pending";
    } else {
      markPending("sellerIdStatus", selfVerification.sellerIdStatus);
      markPending("sellerPayoutStatus", selfVerification.sellerPayoutStatus);
    }

    if (Object.keys(payload).length === 0) {
      setVerificationNotice("You are already fully verified.");
      return;
    }

    setVerificationLoading(true);
    try {
      await api.put("/marketplace-verifications/me", { data: payload });
      setVerificationNotice("Optional seller verification request sent.");
      await loadSelfVerification();
    } catch {
      setVerificationError("Unable to submit verification request.");
    } finally {
      setVerificationLoading(false);
    }
  };

  const loadConversation = useCallback(
    async (listing: StorefrontProduct | undefined) => {
      if (!listing || !user?.id || !listing.seller.userId) {
        setMessages([]);
        return;
      }
      setChatLoading(true);
      setChatError(null);
      const listingId = listing.rawId ?? Number(listing.id);
      const sellerId = listing.seller.userId;
      const query = [
        `filters[$or][0][sender][id][$eq]=${user.id}`,
        `filters[$or][0][recipient][id][$eq]=${sellerId}`,
        `filters[$or][1][sender][id][$eq]=${sellerId}`,
        `filters[$or][1][recipient][id][$eq]=${user.id}`,
        `filters[listing][id][$eq]=${listingId}`,
        "sort=createdAt:desc",
        "pagination[pageSize]=200",
        "populate=sender",
      ].join("&");
      try {
        const res = await api.get(`/messages?${query}`);
        const mapped: StorefrontMessage[] = (res.data?.data ?? []).map((message: any) => {
          const attrs = normalize(message);
          const senderId = getEntityId(attrs.sender);
          const senderName =
            String(normalize(attrs.sender)?.username || "").trim() ||
            String(normalize(attrs.sender)?.email || "").split("@")[0] ||
            "User";
          return {
            id: String(message.id ?? attrs.documentId ?? `${senderId}-${attrs.createdAt}`),
            productId: listing.id,
            sender: senderId === user.id ? "buyer" : "seller",
            senderName: senderId === user.id ? "You" : senderName,
            body: String(attrs.body || ""),
            timestamp: attrs.createdAt
              ? new Date(attrs.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "",
          } satisfies StorefrontMessage;
        });
        mapped.sort((a: StorefrontMessage, b: StorefrontMessage) =>
          a.timestamp > b.timestamp ? 1 : -1
        );
        setMessages(mapped);
      } catch {
        setChatError("Unable to load messages.");
      } finally {
        setChatLoading(false);
      }
    },
    [user?.id]
  );

  const loadOffers = useCallback(
    async (listing: StorefrontProduct | undefined) => {
      if (!listing || !user?.id) {
        setOffers([]);
        return;
      }
      const listingId = listing.rawId ?? Number(listing.id);
      if (!Number.isFinite(listingId)) {
        setOffers([]);
        return;
      }
      setOfferLoading(true);
      setOfferError(null);
      try {
        const res = await api.get("/marketplace-offers/me", {
          params: { listingId },
        });
        const mapped = (res.data?.data ?? []).map((entry: any) => {
          const attrs = normalize(entry);
          const buyerData = attrs.buyer?.data ?? attrs.buyer;
          const buyer = normalize(buyerData);
          const listingData = attrs.listing?.data ?? attrs.listing;
          return {
            id: String(entry.id ?? attrs.documentId ?? `${listingId}-${attrs.createdAt}`),
            listingId: getEntityId(listingData) ?? listingId,
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
            createdAt: attrs.createdAt
              ? new Date(attrs.createdAt).toLocaleString()
              : "",
          } satisfies StorefrontOffer;
        });
        setOffers(mapped);
      } catch {
        setOfferError("Unable to load offers.");
      } finally {
        setOfferLoading(false);
      }
    },
    [user?.id]
  );

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = products.filter((product) => {
      if (categoryFilter !== "All" && product.category !== categoryFilter) {
        return false;
      }
      if (conditionFilter !== "Any" && product.condition !== conditionFilter) {
        return false;
      }
      if (!normalizedQuery) return true;
      return (
        product.title.toLowerCase().includes(normalizedQuery) ||
        product.description.toLowerCase().includes(normalizedQuery) ||
        product.location.toLowerCase().includes(normalizedQuery)
      );
    });
    if (sortMode === "trending") {
      return [...filtered].sort((a, b) => {
        const ratingDiff = b.seller.rating - a.seller.rating;
        if (Math.abs(ratingDiff) > 0.01) return ratingDiff;
        return b.price - a.price;
      });
    }
    return filtered;
  }, [categoryFilter, conditionFilter, products, query, sortMode]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId) || filteredProducts[0],
    [filteredProducts, products, selectedId]
  );

  const isListingOwner = selectedProduct?.seller.userId === user?.id;
  const canMakeOffer = Boolean(selectedProduct && user?.id && !isListingOwner);
  const canCashPickup = Boolean(selectedProduct?.localPickup && selectedProduct?.cashAccepted);

  const quickOfferOptions = useMemo(() => {
    if (!selectedProduct || !Number.isFinite(selectedProduct.price)) return [];
    if (selectedProduct.price <= 0) return [];
    const options = [0.8, 0.9, 1].map((rate) =>
      roundCurrency(selectedProduct.price * rate)
    );
    return Array.from(new Set(options)).filter((value) => value > 0);
  }, [selectedProduct]);

  const isOfferOptionActive = useCallback(
    (value: number) => Math.abs(Number(offerDraftPrice) - value) < 0.005,
    [offerDraftPrice]
  );

  const capturePayPalReturn = useCallback(async () => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(location.search);
    const status = params.get("paypal");
    const orderId = params.get("orderId");
    if (!status || !orderId) return;
    const captureKey = `paypal:${orderId}`;
    if (captureGuardRef.current === captureKey) return;
    captureGuardRef.current = captureKey;
    if (status === "cancel") {
      setCheckoutStatus("Payment cancelled.");
      return;
    }
    if (status !== "success") return;
    try {
      await api.post(`/marketplace-orders/paypal/${orderId}/capture`);
      setCheckoutStatus("Payment captured. Your order is confirmed.");
      void loadListings();
    } catch {
      setCheckoutError("Unable to capture PayPal payment.");
    }
  }, [loadListings, location.search]);

  const captureStripeReturn = useCallback(async () => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(location.search);
    const status = params.get("stripe");
    const orderId = params.get("orderId");
    const sessionId = params.get("session_id");
    if (!status || !orderId) return;
    const captureKey = `stripe:${orderId}:${sessionId ?? ""}`;
    if (captureGuardRef.current === captureKey) return;
    captureGuardRef.current = captureKey;
    if (status === "cancel") {
      setCheckoutStatus("Stripe checkout cancelled.");
      return;
    }
    if (status !== "success" || !sessionId) {
      return;
    }
    try {
      await api.post(`/marketplace-orders/stripe/${orderId}/capture`, { sessionId });
      setCheckoutStatus("Payment captured. Your order is confirmed.");
      void loadListings();
    } catch {
      setCheckoutError("Unable to capture Stripe payment.");
    }
  }, [loadListings, location.search]);

  useEffect(() => {
    if (listingId) {
      return;
    }
    if (selectedId && filteredProducts.some((product) => product.id === selectedId)) {
      return;
    }
    if (filteredProducts[0]) {
      setSelectedId(filteredProducts[0].id);
    }
  }, [filteredProducts, selectedId]);

  useEffect(() => {
    if (listingId) {
      setSelectedId(listingId);
    }
  }, [listingId]);

  useEffect(() => {
    void loadListings();
    void loadSelfVerification();
  }, [loadListings, loadSelfVerification]);

  useEffect(() => {
    void capturePayPalReturn();
    void captureStripeReturn();
  }, [capturePayPalReturn, captureStripeReturn]);

  useEffect(() => {
    void loadConversation(selectedProduct);
    void loadSellerVerification(selectedProduct?.seller.userId ?? null);
    void loadOffers(selectedProduct);
  }, [loadConversation, loadSellerVerification, loadOffers, selectedProduct]);

  useEffect(() => {
    setOfferNotice(null);
    setOfferError(null);
    setOfferDraftPrice("");
    setOfferDraftNote("");
  }, [selectedProduct?.id]);

  useEffect(() => {
    if (!canCashPickup && paymentMethod === "cash") {
      setPaymentMethod("paypal");
    }
  }, [canCashPickup, paymentMethod]);

  useEffect(() => {
    setCheckoutError(null);
    setCheckoutStatus(null);
  }, [paymentMethod]);

  const conversation = useMemo(() => {
    if (!selectedProduct) return [];
    return messages.filter((message) => message.productId === selectedProduct.id);
  }, [messages, selectedProduct]);

  const offersForDisplay = useMemo(() => {
    if (!selectedProduct || !user?.id) return [];
    const listingId = selectedProduct.rawId ?? Number(selectedProduct.id);
    const relevant = offers.filter((offer) => offer.listingId === listingId);
    if (isListingOwner) {
      return relevant.filter((offer) => offer.status === "pending");
    }
    return relevant.filter((offer) => offer.buyerId === user.id);
  }, [offers, isListingOwner, selectedProduct, user?.id]);

  const acceptedOffer = useMemo(() => {
    if (isListingOwner) return null;
    return offersForDisplay.find((offer) => offer.status === "accepted") || null;
  }, [isListingOwner, offersForDisplay]);

  const resolveListingIdPayload = (listing?: StorefrontProduct | null) => {
    if (!listing) return null;
    if (typeof listing.rawId === "number" && Number.isFinite(listing.rawId)) {
      return listing.rawId;
    }
    if (listing.id) return listing.id;
    return null;
  };

  const handlePayWithPaypal = useCallback(async () => {
    if (!selectedProduct) return;
    setCheckoutError(null);
    setCheckoutStatus(null);
    setCheckoutLoading(true);
    try {
      const listingId = resolveListingIdPayload(selectedProduct);
      if (!listingId) {
        setCheckoutError("Listing is not ready for checkout.");
        return;
      }
      const res = await api.post("/marketplace-orders/paypal", {
        listingId,
        offerId: acceptedOffer?.id,
        paymentMethod,
      });
      const approvalUrl = res.data?.approvalUrl;
      if (approvalUrl && typeof window !== "undefined") {
        window.open(approvalUrl, "_blank", "noopener,noreferrer");
        setCheckoutStatus(
          paymentMethod === "venmo"
            ? "Approve the payment in PayPal (Venmo will appear if available)."
            : "Approve the payment in PayPal to continue."
        );
      } else {
        setCheckoutError("PayPal approval link not available.");
      }
    } catch (err) {
      setCheckoutError("Unable to start PayPal checkout.");
    } finally {
      setCheckoutLoading(false);
    }
  }, [acceptedOffer, canCashPickup, paymentMethod, selectedProduct]);

  const handlePayWithStripe = useCallback(async () => {
    if (!selectedProduct) return;
    setCheckoutError(null);
    setCheckoutStatus(null);
    setCheckoutLoading(true);
    try {
      const listingId = resolveListingIdPayload(selectedProduct);
      if (!listingId) {
        setCheckoutError("Listing is not ready for checkout.");
        return;
      }
      const res = await api.post("/marketplace-orders/stripe", {
        listingId,
        offerId: acceptedOffer?.id,
        paymentMethod,
      });
      const checkoutUrl = res.data?.checkoutUrl;
      if (checkoutUrl && typeof window !== "undefined") {
        window.open(checkoutUrl, "_blank", "noopener,noreferrer");
        setCheckoutStatus("Complete the Stripe checkout to continue.");
      } else {
        setCheckoutError("Stripe checkout link not available.");
      }
    } catch {
      setCheckoutError("Unable to start Stripe checkout.");
    } finally {
      setCheckoutLoading(false);
    }
  }, [acceptedOffer, paymentMethod, selectedProduct]);

  const handleManualPayment = useCallback(async () => {
    if (!selectedProduct) return;
    if (paymentMethod !== "cash") return;
    if (!canCashPickup) {
      setCheckoutError("Cash pickup is not available for this listing.");
      return;
    }
    setCheckoutError(null);
    setCheckoutStatus(null);
    setCheckoutLoading(true);
    try {
      const listingId = resolveListingIdPayload(selectedProduct);
      if (!listingId) {
        setCheckoutError("Listing is not ready for checkout.");
        return;
      }
      const res = await api.post("/marketplace-orders/manual", {
        listingId,
        offerId: acceptedOffer?.id,
        paymentProvider: paymentMethod,
      });
      setCheckoutStatus(
        res.data?.message ||
          "Cash pickup selected. Message the seller to confirm time and location."
      );
    } catch {
      setCheckoutError("Unable to record manual order.");
    } finally {
      setCheckoutLoading(false);
    }
  }, [acceptedOffer, paymentMethod, selectedProduct]);

  const effectivePrice = selectedProduct
    ? acceptedOffer
      ? acceptedOffer.offeredPrice
      : selectedProduct.price
    : 0;
  const feeCurrency = acceptedOffer?.currency || "USD";
  const platformFeeRate = paymentMethod === "cash" ? 0 : PLATFORM_FEE_RATE;
  const platformFee = effectivePrice * platformFeeRate;
  const sellerPayout = effectivePrice - platformFee;

  const handleOpenOfferPanel = () => {
    offerPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSubmitOffer = async () => {
    if (!selectedProduct || !user?.id || isListingOwner) return;
    const listingId = selectedProduct.rawId ?? Number(selectedProduct.id);
    const offerPrice = Number(offerDraftPrice);
    if (!Number.isFinite(listingId)) {
      setOfferError("Listing is not ready for offers.");
      return;
    }
    if (!Number.isFinite(offerPrice) || offerPrice <= 0) {
      setOfferError("Enter a valid offer amount.");
      return;
    }
    setOfferError(null);
    setOfferNotice(null);
    setOfferLoading(true);
    try {
      await api.post("/marketplace-offers", {
        data: {
          listing: listingId,
          offeredPrice: offerPrice,
          note: offerDraftNote.trim() || undefined,
        },
      });
      setOfferNotice("Offer sent to the seller.");
      setOfferDraftPrice("");
      setOfferDraftNote("");
      await loadOffers(selectedProduct);
    } catch {
      setOfferError("Unable to send offer.");
    } finally {
      setOfferLoading(false);
    }
  };

  const handleCreateOffer = () => {
    void handleSubmitOffer();
  };

  const handleRespondOffer = async (offerId: string, status: OfferStatus) => {
    if (!selectedProduct || !user?.id) return;
    setOfferError(null);
    setOfferNotice(null);
    setOfferLoading(true);
    try {
      await api.put(`/marketplace-offers/${offerId}`, { data: { status } });
      setOfferNotice(
        status === "accepted" ? "Offer accepted." : "Offer declined."
      );
      await loadOffers(selectedProduct);
    } catch {
      setOfferError("Unable to update offer.");
    } finally {
      setOfferLoading(false);
    }
  };

  const handleWithdrawOffer = async (offerId: string) => {
    if (!selectedProduct || !user?.id) return;
    setOfferError(null);
    setOfferNotice(null);
    setOfferLoading(true);
    try {
      await api.put(`/marketplace-offers/${offerId}`, {
        data: { status: "withdrawn" },
      });
      setOfferNotice("Offer withdrawn.");
      await loadOffers(selectedProduct);
    } catch {
      setOfferError("Unable to withdraw offer.");
    } finally {
      setOfferLoading(false);
    }
  };

  const handleUpdateOffer = (offerId: string, status: OfferStatus) => {
    if (status === "withdrawn") {
      void handleWithdrawOffer(offerId);
      return;
    }
    void handleRespondOffer(offerId, status);
  };

  const handleSendMessage = async () => {
    if (!selectedProduct || !user?.id) return;
    if (!selectedProduct.seller.userId) {
      setChatError("Seller chat is not available for this listing.");
      return;
    }
    const trimmed = messageDraft.trim();
    if (!trimmed) return;
    setChatError(null);
    try {
      await api.post("/messages", {
        data: {
          body: trimmed,
          recipient: selectedProduct.seller.userId,
          listing: selectedProduct.rawId ?? Number(selectedProduct.id),
        },
      });
      setMessageDraft("");
      await loadConversation(selectedProduct);
    } catch {
      setChatError("Unable to send message.");
    }
  };

  const pageBackground = getBackgroundStyle("storefront") || getBackgroundStyle("dashboard");

  return (
    <div className="dashboard-shell storefront-shell" style={pageBackground}>
      <Sidebar active="storefront" />

      <div className="main-content storefront-page storefront-detail-page">
        <TopbarSearch />

        <div className="storefront-detail-header">
          <button
            className="btn ghost small"
            type="button"
            onClick={() => navigate("/storefront")}
          >
            Back to StoreFront
          </button>
          <div className="storefront-detail-title">
            <p className="storefront-panel-eyebrow">Listing details</p>
            <h1>{selectedProduct?.title || "Listing"}</h1>
          </div>
          {selectedProduct && (
            <div className="storefront-detail-actions">
              <span className="storefront-price-pill">
                {formatPrice(selectedProduct.price)}
              </span>
              {canMakeOffer && (
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={handleOpenOfferPanel}
                >
                  Bargain
                </button>
              )}
            </div>
          )}
        </div>

        {loadingListings && (
          <div className="storefront-status">Loading listing...</div>
        )}
        {listingError && <div className="storefront-status error">{listingError}</div>}
        {!loadingListings && !listingError && !selectedProduct && (
          <div className="storefront-status">Listing not found.</div>
        )}

        <section className="storefront-detail-layout">
          <div className="storefront-detail-main">
            <div className="storefront-panel storefront-detail">
              {selectedProduct && (
                <>
                  <p className="storefront-description">{selectedProduct.description}</p>
                  <div className="storefront-meta-grid">
                    <div>
                      <span>Condition</span>
                      <strong>{selectedProduct.condition}</strong>
                    </div>
                    <div>
                      <span>Location</span>
                      <strong>{selectedProduct.location}</strong>
                    </div>
                    <div>
                      <span>Delivery</span>
                      <strong>Arranged privately</strong>
                      <small>Coordinate pickup or delivery directly with the seller.</small>
                    </div>
                    <div>
                      <span>Local pickup</span>
                      <strong>
                        {selectedProduct.localPickup ? "Available" : "Not available"}
                      </strong>
                    </div>
                    <div>
                      <span>Cash payment</span>
                      <strong>
                        {selectedProduct.cashAccepted ? "Accepted" : "Not available"}
                      </strong>
                    </div>
                    <div>
                      <span>Stock</span>
                      <strong>{selectedProduct.stock} available</strong>
                    </div>
                  </div>
                  <div className="storefront-gallery">
                    {selectedProduct.images.length === 0 && (
                      <div className="storefront-gallery-empty">
                        No additional images uploaded yet.
                      </div>
                    )}
                    {selectedProduct.images.map((image, index) => (
                      <div key={`${image}-${index}`} className="storefront-gallery-item">
                        <img src={image} alt={`${selectedProduct.title} ${index + 1}`} />
                      </div>
                    ))}
                  </div>
                  <div className="storefront-seller">
                    <div>
                      <h4>{selectedProduct.seller.name}</h4>
                      <p>{selectedProduct.seller.responseTime}</p>
                    </div>
                    <div className="storefront-badges">
                      {selectedProduct.seller.badges.map((badge) => (
                        <span key={badge}>{badge}</span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <aside className="storefront-detail-aside">
            <div className="storefront-panel storefront-fee-panel">
              <div className="storefront-panel-header">
                <div>
                  <p className="storefront-panel-eyebrow">Transaction summary</p>
                  <h3>Estimated payout</h3>
                </div>
                <span className="storefront-fee-note">
                  {paymentMethod === "cash" ? "0% platform fee (cash pickup)" : "3% platform fee"}
                </span>
              </div>
              <div className="storefront-fee-row">
                <span>{acceptedOffer ? "Original price" : "Listing price"}</span>
                <strong>
                  {selectedProduct ? formatPrice(selectedProduct.price) : "$0.00"}
                </strong>
              </div>
              {acceptedOffer && (
                <div className="storefront-fee-row">
                  <span>Accepted offer</span>
                  <strong>
                    {formatCurrency(acceptedOffer.offeredPrice, acceptedOffer.currency)}
                  </strong>
                </div>
              )}
              <div className="storefront-fee-row">
                <span>{paymentMethod === "cash" ? "Platform fee (cash pickup)" : "Platform fee"}</span>
                <strong>-{formatCurrency(platformFee, feeCurrency)}</strong>
              </div>
              <div className="storefront-fee-row total">
                <span>{isListingOwner ? "You receive" : "Seller receives"}</span>
                <strong>{formatCurrency(sellerPayout, feeCurrency)}</strong>
              </div>
              {!isListingOwner && (
                <div className="storefront-payment-methods" role="radiogroup" aria-label="Payment methods">
                  <p className="storefront-panel-eyebrow">Payment method</p>
                  <label className="storefront-payment-option">
                    <input
                      type="radio"
                      name="payment-method"
                      value="stripe"
                      checked={paymentMethod === "stripe"}
                      onChange={() => setPaymentMethod("stripe")}
                    />
                    <span className="storefront-payment-icon stripe" aria-hidden="true">
                      S
                    </span>
                    <span>Pay online (Card via Stripe)</span>
                  </label>
                  <label className="storefront-payment-option">
                    <input
                      type="radio"
                      name="payment-method"
                      value="cashapp"
                      checked={paymentMethod === "cashapp"}
                      onChange={() => setPaymentMethod("cashapp")}
                    />
                    <span className="storefront-payment-icon cashapp" aria-hidden="true">
                      $
                    </span>
                    <span>Pay with Cash App (via Stripe)</span>
                  </label>
                  <label className="storefront-payment-option">
                    <input
                      type="radio"
                      name="payment-method"
                      value="paypal"
                      checked={paymentMethod === "paypal"}
                      onChange={() => setPaymentMethod("paypal")}
                    />
                    <span className="storefront-payment-icon paypal" aria-hidden="true">
                      P
                    </span>
                    <span>Pay online (PayPal)</span>
                  </label>
                  <label className="storefront-payment-option">
                    <input
                      type="radio"
                      name="payment-method"
                      value="venmo"
                      checked={paymentMethod === "venmo"}
                      onChange={() => setPaymentMethod("venmo")}
                    />
                    <span className="storefront-payment-icon venmo" aria-hidden="true">
                      V
                    </span>
                    <span>Pay online (Venmo via PayPal)</span>
                  </label>
                  {canCashPickup && (
                    <label className="storefront-payment-option">
                      <input
                        type="radio"
                        name="payment-method"
                        value="cash"
                        checked={paymentMethod === "cash"}
                        onChange={() => setPaymentMethod("cash")}
                      />
                      <span className="storefront-payment-icon cash" aria-hidden="true">
                        $
                      </span>
                      <span>Pay with cash on pickup (no platform fee)</span>
                    </label>
                  )}
                  {!canCashPickup && (
                    <p className="storefront-thread-empty">
                      Cash pickup is not available for this listing.
                    </p>
                  )}
                </div>
              )}
              {checkoutError && (
                <p className="storefront-form-error">{checkoutError}</p>
              )}
              {checkoutStatus && (
                <p className="storefront-status success">{checkoutStatus}</p>
              )}
              {!isListingOwner &&
                (paymentMethod === "paypal" || paymentMethod === "venmo") && (
                  <button
                    className="btn primary"
                    type="button"
                    disabled={checkoutLoading || !selectedProduct}
                    onClick={handlePayWithPaypal}
                  >
                    {checkoutLoading
                      ? "Connecting..."
                      : paymentMethod === "venmo"
                        ? "Pay with Venmo"
                        : "Pay with PayPal"}
                  </button>
                )}
              {!isListingOwner &&
                (paymentMethod === "stripe" || paymentMethod === "cashapp") && (
                  <button
                    className="btn primary"
                    type="button"
                    disabled={checkoutLoading || !selectedProduct}
                    onClick={handlePayWithStripe}
                  >
                    {checkoutLoading
                      ? "Connecting..."
                      : paymentMethod === "cashapp"
                        ? "Pay with Cash App"
                        : "Pay with card"}
                  </button>
                )}
              {!isListingOwner && paymentMethod === "cash" && (
                <button
                  className="btn ghost"
                  type="button"
                  disabled={checkoutLoading}
                  onClick={handleManualPayment}
                >
                  {checkoutLoading ? "Saving..." : "Confirm cash pickup"}
                </button>
              )}
              <a className="storefront-policy-link" href="/marketplace-policy">
                View delivery & pickup guidance
              </a>
              <a className="storefront-policy-link" href="/marketplace-fee-disclosure">
                View platform fee disclosure
              </a>
            </div>

            <div className="storefront-panel storefront-chat">
              <div className="storefront-panel-header">
                <div>
                  <p className="storefront-panel-eyebrow">Buyer chat</p>
                  <h3>Message the seller</h3>
                </div>
                <div className="storefront-chat-header-meta">
                  <span className="storefront-chat-private">Private</span>
                  <span>{selectedProduct?.seller.name || "Seller"}</span>
                </div>
              </div>
              <div className="storefront-thread">
                {chatLoading && (
                  <p className="storefront-thread-empty">Loading conversation…</p>
                )}
                {!chatLoading && chatError && (
                  <p className="storefront-thread-empty">{chatError}</p>
                )}
                {!chatLoading && !chatError && conversation.length === 0 && (
                  <p className="storefront-thread-empty">
                    Start a conversation about this listing.
                  </p>
                )}
                {conversation.map((message) => (
                  <div
                    key={message.id}
                    className={`storefront-message ${
                      message.sender === "buyer" ? "is-buyer" : "is-seller"
                    }`}
                  >
                    <div>
                      <span className="storefront-message-name">{message.senderName}</span>
                      <span className="storefront-message-time">{message.timestamp}</span>
                    </div>
                    <p>{message.body}</p>
                  </div>
                ))}
              </div>
              <div className="storefront-message-input">
                <input
                  type="text"
                  placeholder="Write a message…"
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                />
                <button className="btn ghost" type="button" onClick={handleSendMessage}>
                  Send
                </button>
              </div>
            </div>

            <div className="storefront-panel storefront-offer" ref={offerPanelRef}>
              <div className="storefront-panel-header">
                <div>
                  <p className="storefront-panel-eyebrow">Bargain</p>
                  <h3>{isListingOwner ? "Pending offers" : "Send an offer"}</h3>
                </div>
                {selectedProduct && (
                  <span className="storefront-price-pill">
                    {formatPrice(selectedProduct.price)}
                  </span>
                )}
              </div>
              {offerError && <p className="storefront-form-error">{offerError}</p>}
              {offerNotice && <p className="storefront-status success">{offerNotice}</p>}
              {!isListingOwner && (
                <div className="storefront-offer-form">
                  {quickOfferOptions.length > 0 && (
                    <div className="storefront-offer-quick">
                      <span>Quick select</span>
                      <div className="storefront-offer-quick-options">
                        {quickOfferOptions.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={`storefront-offer-option${
                              isOfferOptionActive(value) ? " is-active" : ""
                            }`}
                            onClick={() => setOfferDraftPrice(value.toFixed(2))}
                          >
                            {formatPrice(value)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="storefront-offer-inputs">
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      placeholder="Offer price"
                      value={offerDraftPrice}
                      onChange={(event) => setOfferDraftPrice(event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Optional note to seller"
                      value={offerDraftNote}
                      onChange={(event) => setOfferDraftNote(event.target.value)}
                    />
                  </div>
                  <button className="btn primary" type="button" onClick={handleCreateOffer}>
                    Send offer
                  </button>
                </div>
              )}
              {offerLoading && <p className="storefront-thread-empty">Loading offers…</p>}
              {!offerLoading && offersForDisplay.length === 0 && (
                <p className="storefront-thread-empty">
                  {isListingOwner
                    ? "No pending offers yet."
                    : "No offers yet. Submit your bargain to get started."}
                </p>
              )}
              {!offerLoading && offersForDisplay.length > 0 && (
                <div className="storefront-offer-list">
                  {offersForDisplay.map((offer) => (
                    <div key={offer.id} className={`storefront-offer-card ${offer.status}`}>
                      <div>
                        <strong>{offer.buyerName}</strong>
                        <span>
                          {formatCurrency(offer.offeredPrice, offer.currency)} • {offer.createdAt}
                        </span>
                      </div>
                      <div className="storefront-offer-actions">
                        {isListingOwner && offer.status === "pending" && (
                          <>
                            <button
                              className="btn primary small"
                              type="button"
                              onClick={() => handleUpdateOffer(offer.id, "accepted")}
                            >
                              Accept
                            </button>
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => handleUpdateOffer(offer.id, "declined")}
                            >
                              Decline
                            </button>
                          </>
                        )}
                        {!isListingOwner && offer.status === "pending" && (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => handleUpdateOffer(offer.id, "withdrawn")}
                          >
                            Withdraw
                          </button>
                        )}
                        {offer.status !== "pending" && (
                          <span className={`storefront-offer-pill ${offer.status}`}>
                            {offer.status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              className="storefront-panel storefront-verification"
              id="seller-verification"
              tabIndex={-1}
            >
              <div className="storefront-panel-header">
                <div>
                  <p className="storefront-panel-eyebrow">Trust and safety</p>
                  <h3>Seller verification</h3>
                </div>
                <span>{selectedProduct?.seller.name || "Seller"}</span>
              </div>
              <div className="storefront-verification-grid">
                {sellerVerificationItems.map((item) => (
                  <div key={item.label} className={`storefront-verify ${item.status}`}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                    <span className="storefront-verify-pill">{item.status}</span>
                  </div>
                ))}
              </div>
              {verificationError && <p className="storefront-form-error">{verificationError}</p>}
              {verificationNotice && (
                <p className="storefront-status success">{verificationNotice}</p>
              )}
              {isListingOwner ? (
                <>
                  <p className="storefront-field-hint">
                    Verification is optional. Verified sellers display a badge on their listings.
                  </p>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={verificationLoading}
                    onClick={handleRequestSellerVerification}
                  >
                    {verificationLoading ? "Sending request..." : "Request verification"}
                  </button>
                </>
              ) : (
                <p className="storefront-field-hint">
                  Buyers can checkout without verification. Verified sellers display a badge.
                </p>
              )}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
