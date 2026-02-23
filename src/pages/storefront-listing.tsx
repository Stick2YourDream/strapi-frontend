import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
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
import {
  STOREFRONT_DEMO_COUNT_KEY,
  STOREFRONT_DEMO_ENABLED_KEY,
  buildStorefrontDemoListings,
  readStorefrontDemoCount,
  readStorefrontDemoEnabled,
} from "../data/storefront-demo";

const VERIFIED_SELLER_FEE_RATE = 0.02;
const STANDARD_SELLER_FEE_RATE = 0.04;

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

type OfferStatus = "pending" | "countered" | "accepted" | "declined" | "withdrawn";

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
  note?: string;
  lastActionBy?: "buyer" | "seller";
};

type BidStatus = "pending" | "accepted" | "declined" | "withdrawn";

type StorefrontBid = {
  id: string;
  listingId: number;
  bidderId?: number;
  sellerId?: number;
  bidderName: string;
  amount: number;
  currency: string;
  status: BidStatus;
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

const matchesListingId = (product: StorefrontProduct, id?: string | null) => {
  if (!id) return false;
  const compare = String(id);
  if (product.id === compare) return true;
  if (product.documentId && product.documentId === compare) return true;
  if (product.rawId !== undefined && String(product.rawId) === compare) return true;
  return false;
};

const buildStorefrontProduct = (entry: any): StorefrontProduct => {
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
  const documentId = String(entry?.documentId ?? attrs.documentId ?? "").trim();
  const id = documentId || String(entry?.id ?? attrs.id ?? Date.now());
  const rawId =
    Number(entry?.id ?? attrs.id ?? attrs.documentId ?? documentId) || undefined;
  return {
    id,
    documentId: documentId || undefined,
    rawId,
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
};

const DEFAULT_MESSAGES: StorefrontMessage[] = [];

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

const getApiErrorMessage = (err: unknown, fallback: string) => {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string }; message?: string }
      | undefined;
    return data?.error?.message || data?.message || fallback;
  }
  return fallback;
};

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

const QUICK_BUYER_MESSAGES = [
  "Hi! Is this still available?",
  "Can you share a few more photos?",
  "What's the lowest price you'd take?",
  "Can we meet for local pickup?",
  "Is shipping available?",
  "What condition issues should I know about?",
] as const;

export default function StorefrontListing() {
  const { user } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const { listingId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [demoEnabled, setDemoEnabled] = useState(readStorefrontDemoEnabled);
  const [demoCount, setDemoCount] = useState(readStorefrontDemoCount);
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [selectedId, setSelectedId] = useState("");
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
  const [bids, setBids] = useState<StorefrontBid[]>([]);
  const [bidLoading, setBidLoading] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidNotice, setBidNotice] = useState<string | null>(null);
  const [bidDraftAmount, setBidDraftAmount] = useState("");
  const [counterDrafts, setCounterDrafts] = useState<Record<string, string>>({});
  const [counterNotes, setCounterNotes] = useState<Record<string, string>>({});
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
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const captureGuardRef = useRef<string | null>(null);
  const offerPanelRef = useRef<HTMLDivElement | null>(null);
  const searchContext = useMemo(
    () => (location.state && typeof location.state === "object" ? location.state : {}) as {
      query?: string;
      category?: string;
      location?: string;
    },
    [location.state]
  );
  const searchQuery = String(searchContext?.query || "").trim().toLowerCase();
  const searchCategory = String(searchContext?.category || "").trim();
  const demoProducts = useMemo<StorefrontProduct[]>(() => {
    if (!demoEnabled || demoCount <= 0) return [];
    return buildStorefrontDemoListings(demoCount).map((entry) => ({
      id: entry.id,
      title: entry.title,
      price: 0.01,
      status: "active",
      category: entry.category,
      condition: entry.condition,
      location: entry.location,
      description: entry.description,
      images: entry.images,
      seller: {
        id: "demo-seller",
        userId: 0,
        name: "Demo Seller",
        rating: 4.8,
        responseTime: "Typically replies within 1 hour",
        verifiedLevel: "verified" as const,
        badges: ["ID verified", "Payout verified"],
      },
      stock: entry.stock,
      shipping: "Delivery arranged privately",
      shippingEnabled: false,
      shippingCarriers: [],
      shippingInternational: false,
      localPickup: entry.localPickup,
      cashAccepted: entry.cashAccepted,
      noShippingRequired: true,
      shippingNotes: "",
      isDemo: true,
    } satisfies StorefrontProduct));
  }, [demoCount, demoEnabled]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncDemo = () => {
      setDemoEnabled(readStorefrontDemoEnabled());
      setDemoCount(readStorefrontDemoCount());
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === STOREFRONT_DEMO_ENABLED_KEY ||
        event.key === STOREFRONT_DEMO_COUNT_KEY
      ) {
        syncDemo();
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("storefront:demo-updated", syncDemo);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("storefront:demo-updated", syncDemo);
    };
  }, []);

  const loadListings = useCallback(async () => {
    setLoadingListings(true);
    setListingError(null);
    try {
      const res = await api.get(
        "/marketplace-listings?populate[0]=images&populate[1]=owner&sort=createdAt:desc"
      );
      const entries = Array.isArray(res.data?.data) ? res.data.data : [];
      const mapped: StorefrontProduct[] = entries.map(buildStorefrontProduct);
      if (listingId && !mapped.some((product) => matchesListingId(product, listingId))) {
        try {
          const directRes = await api.get(
            `/marketplace-listings/${listingId}?populate[0]=images&populate[1]=owner`
          );
          const directEntry = directRes.data?.data;
          if (directEntry) {
            const directProduct = buildStorefrontProduct(directEntry);
            const exists = mapped.some((product) => {
              if (directProduct.rawId && product.rawId === directProduct.rawId) return true;
              if (directProduct.documentId && product.documentId === directProduct.documentId) {
                return true;
              }
              return product.id === directProduct.id;
            });
            if (!exists) mapped.push(directProduct);
          }
        } catch {
          // Ignore direct fetch failures; listing may be private or unavailable.
        }
      }
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
      const nextProducts = [...demoProducts, ...enriched];
      setProducts(nextProducts);
      const nextSelectedId =
        listingId &&
        nextProducts.some((product: StorefrontProduct) =>
          matchesListingId(product, listingId)
        )
          ? listingId
          : nextProducts[0]?.id || "";
      setSelectedId(nextSelectedId);
    } catch (err) {
      if (demoProducts.length > 0) {
        setProducts(demoProducts);
        const fallbackId =
          listingId &&
          demoProducts.some((product: StorefrontProduct) =>
            matchesListingId(product, listingId)
          )
            ? listingId
            : demoProducts[0]?.id || "";
        setSelectedId(fallbackId);
      } else {
        setListingError("Unable to load listings right now.");
        setProducts([]);
        setSelectedId("");
      }
    } finally {
      setLoadingListings(false);
    }
  }, [demoProducts, listingId]);

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

    if (!user?.ageVerified) {
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
      return;
    }

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
            status:
              (String(attrs.status || "pending").toLowerCase() as OfferStatus) ||
              "pending",
            createdAt: attrs.createdAt
              ? new Date(attrs.createdAt).toLocaleString()
              : "",
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
    },
    [user?.id]
  );

  const loadBids = useCallback(
    async (listing: StorefrontProduct | undefined) => {
      if (!listing || !user?.id) {
        setBids([]);
        return;
      }
      const listingId = listing.rawId ?? Number(listing.id);
      if (!Number.isFinite(listingId)) {
        setBids([]);
        return;
      }
      setBidLoading(true);
      setBidError(null);
      try {
        const res = await api.get("/marketplace-bids/me", {
          params: { listingId },
        });
        const mapped = (res.data?.data ?? []).map((entry: any) => {
          const attrs = normalize(entry);
          const bidderData = attrs.bidder?.data ?? attrs.bidder;
          const bidder = normalize(bidderData);
          const listingData = attrs.listing?.data ?? attrs.listing;
          return {
            id: String(entry.id ?? attrs.documentId ?? `${listingId}-${attrs.createdAt}`),
            listingId: getEntityId(listingData) ?? listingId,
            bidderId: getEntityId(bidderData) ?? undefined,
            sellerId: getEntityId(attrs.seller) ?? undefined,
            bidderName:
              `${String(bidder.firstName || "").trim()} ${String(bidder.lastName || "").trim()}`.trim() ||
              String(bidder.username || "").trim() ||
              String(bidder.email || "").split("@")[0] ||
              "Bidder",
            amount: Number(attrs.amount || 0),
            currency: String(attrs.currency || "USD").toUpperCase(),
            status: (String(attrs.status || "pending").toLowerCase() as BidStatus) ||
              "pending",
            createdAt: attrs.createdAt
              ? new Date(attrs.createdAt).toLocaleString()
              : "",
          } satisfies StorefrontBid;
        });
        setBids(mapped);
      } catch {
        setBidError("Unable to load bids.");
      } finally {
        setBidLoading(false);
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

  const selectedProduct = useMemo(() => {
    if (listingId) {
      return products.find((product) => matchesListingId(product, listingId));
    }
    return (
      products.find((product) => matchesListingId(product, selectedId)) ||
      filteredProducts[0]
    );
  }, [filteredProducts, listingId, products, selectedId]);

  const similarListings = useMemo(() => {
    if (!selectedProduct) return [];
    const activeListings = products.filter((item) => {
      const status = String(item.status || "active").toLowerCase();
      return status === "active" && item.id !== selectedProduct.id;
    });
    if (!activeListings.length) return [];
    const preferredCategory =
      searchCategory && searchCategory !== "All"
        ? searchCategory
        : selectedProduct.category;
    const categoryMatch = activeListings.filter(
      (item) => item.category === preferredCategory
    );
    const tokens = searchQuery.split(/\s+/).filter(Boolean);
    const queryMatch =
      tokens.length > 0
        ? activeListings.filter((item) =>
            tokens.some((token) =>
              `${item.title} ${item.description} ${item.location} ${item.category}`
                .toLowerCase()
                .includes(token)
            )
          )
        : [];
    const combined = [...queryMatch, ...categoryMatch, ...activeListings];
    const seen = new Set<string>();
    const result: StorefrontProduct[] = [];
    combined.forEach((item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      result.push(item);
    });
    return result.slice(0, 4);
  }, [products, searchQuery, selectedProduct]);

  const isListingOwner = selectedProduct?.seller.userId === user?.id;
  const listingStatus = String(selectedProduct?.status || "active").toLowerCase();
  const isListingActive = listingStatus === "active";
  const canMakeOffer = Boolean(
    selectedProduct && user?.id && !isListingOwner && isListingActive
  );
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

  useEffect(() => {
    if (listingId) {
      return;
    }
    if (
      selectedId &&
      filteredProducts.some((product) => matchesListingId(product, selectedId))
    ) {
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
  }, [capturePayPalReturn]);

  useEffect(() => {
    void loadConversation(selectedProduct);
    void loadSellerVerification(selectedProduct?.seller.userId ?? null);
    void loadOffers(selectedProduct);
    void loadBids(selectedProduct);
  }, [loadConversation, loadSellerVerification, loadOffers, loadBids, selectedProduct]);

  useEffect(() => {
    setOfferNotice(null);
    setOfferError(null);
    setOfferDraftPrice("");
    setOfferDraftNote("");
    setCounterDrafts({});
    setCounterNotes({});
    setBidNotice(null);
    setBidError(null);
    setBidDraftAmount("");
  }, [selectedProduct?.id]);

  useEffect(() => {
    setCheckoutError(null);
    setCheckoutStatus(null);
  }, [selectedProduct?.id]);

  const conversation = useMemo(() => {
    if (!selectedProduct) return [];
    return messages.filter((message) => message.productId === selectedProduct.id);
  }, [messages, selectedProduct]);

  const offersForDisplay = useMemo(() => {
    if (!selectedProduct || !user?.id) return [];
    const listingId = selectedProduct.rawId ?? Number(selectedProduct.id);
    const relevant = offers.filter((offer) => offer.listingId === listingId);
    if (isListingOwner) {
      return relevant.filter(
        (offer) => offer.status === "pending" || offer.status === "countered"
      );
    }
    return relevant.filter((offer) => offer.buyerId === user.id);
  }, [offers, isListingOwner, selectedProduct, user?.id]);

  const bidsForDisplay = useMemo(() => {
    if (!selectedProduct || !user?.id) return [];
    const listingId = selectedProduct.rawId ?? Number(selectedProduct.id);
    const relevant = bids.filter((bid) => bid.listingId === listingId);
    if (isListingOwner) {
      return relevant;
    }
    return relevant.filter((bid) => bid.bidderId === user.id);
  }, [bids, isListingOwner, selectedProduct, user?.id]);

  const highestBid = useMemo(() => {
    if (!selectedProduct) return null;
    const listingHighest = Number(selectedProduct.highestBid ?? 0);
    const bidHighest = bids.reduce((max, bid) => Math.max(max, bid.amount || 0), 0);
    const value = Math.max(listingHighest, bidHighest);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  }, [bids, selectedProduct]);

  const auctionEndAt = useMemo(() => {
    if (!selectedProduct?.auctionEndAt) return null;
    const parsed = new Date(selectedProduct.auctionEndAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [selectedProduct?.auctionEndAt]);

  const auctionEnded = auctionEndAt ? auctionEndAt.getTime() <= Date.now() : false;

  const highestPendingBid = useMemo(() => {
    if (bidsForDisplay.length === 0) return null;
    const pending = bidsForDisplay.filter((bid) => bid.status === "pending");
    if (pending.length === 0) return null;
    return pending.sort((a, b) => b.amount - a.amount)[0] ?? null;
  }, [bidsForDisplay]);

  const acceptedBid = useMemo(() => {
    const bid = bidsForDisplay.find((item) => item.status === "accepted");
    return bid ?? null;
  }, [bidsForDisplay]);

  const acceptedOffer = useMemo(() => {
    if (isListingOwner) return null;
    return offersForDisplay.find((offer) => offer.status === "accepted") || null;
  }, [isListingOwner, offersForDisplay]);

  const currentUserRole: "buyer" | "seller" = isListingOwner ? "seller" : "buyer";

  const getOfferLastActorLabel = useCallback(
    (offer: StorefrontOffer) => {
      const lastActionBy = offer.lastActionBy ?? "buyer";
      if (lastActionBy === "buyer") {
        return isListingOwner ? "Buyer" : "You";
      }
      return isListingOwner ? "You" : "Seller";
    },
    [isListingOwner]
  );

  const isOfferAwaitingCurrentUser = useCallback(
    (offer: StorefrontOffer) => (offer.lastActionBy ?? "buyer") !== currentUserRole,
    [currentUserRole]
  );

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
    if (!isListingActive) {
      setCheckoutError("Listing is not available for checkout.");
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
      const res = await api.post("/marketplace-orders/paypal", {
        listingId,
        offerId: acceptedOffer?.id,
      });
      const approvalUrl = res.data?.approvalUrl;
      if (approvalUrl && typeof window !== "undefined") {
        window.open(approvalUrl, "_blank", "noopener,noreferrer");
        setCheckoutStatus("Approve the payment in PayPal to continue.");
      } else {
        setCheckoutError("PayPal approval link not available.");
      }
    } catch (err) {
      setCheckoutError("Unable to start PayPal checkout.");
    } finally {
      setCheckoutLoading(false);
    }
  }, [acceptedOffer, isListingActive, selectedProduct]);

  const effectivePrice = selectedProduct
    ? acceptedOffer
      ? acceptedOffer.offeredPrice
      : selectedProduct.price
    : 0;
  const feeCurrency = acceptedOffer?.currency || "USD";
  const platformFeeRate =
    selectedProduct?.seller.verifiedLevel === "verified"
      ? VERIFIED_SELLER_FEE_RATE
      : STANDARD_SELLER_FEE_RATE;
  const feeRateLabel =
    platformFeeRate === VERIFIED_SELLER_FEE_RATE
      ? "2% platform fee (verified seller)"
      : "4% platform fee";
  const platformFee = effectivePrice * platformFeeRate;
  const sellerPayout = effectivePrice - platformFee;

  const handleOpenOfferPanel = () => {
    offerPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSubmitOffer = async () => {
    if (!selectedProduct || !user?.id || isListingOwner) return;
    const listingId = resolveListingIdPayload(selectedProduct);
    const offerPrice = Number(offerDraftPrice);
    if (!listingId) {
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
    } catch (err) {
      setOfferError(getApiErrorMessage(err, "Unable to send offer."));
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

  const handleCounterOffer = async (offerId: string) => {
    if (!selectedProduct || !user?.id) return;
    const draftValue = counterDrafts[offerId];
    const noteValue = counterNotes[offerId];
    const existingOffer = offers.find((offer) => offer.id === offerId);
    const counterPrice = Number(draftValue ?? existingOffer?.offeredPrice);
    if (!Number.isFinite(counterPrice) || counterPrice <= 0) {
      setOfferError("Enter a valid counter amount.");
      return;
    }
    setOfferError(null);
    setOfferNotice(null);
    setOfferLoading(true);
    try {
      await api.put(`/marketplace-offers/${offerId}`, {
        data: {
          status: "countered",
          offeredPrice: counterPrice,
          note: noteValue?.trim() || undefined,
        },
      });
      setOfferNotice(
        isListingOwner ? "Counter offer sent to the buyer." : "Counter offer sent to the seller."
      );
      setCounterDrafts((prev) => {
        const next = { ...prev };
        delete next[offerId];
        return next;
      });
      setCounterNotes((prev) => {
        const next = { ...prev };
        delete next[offerId];
        return next;
      });
      await loadOffers(selectedProduct);
    } catch {
      setOfferError("Unable to send counter offer.");
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

  const handlePlaceBid = async () => {
    if (!selectedProduct || !user?.id || isListingOwner) return;
    if (!isListingActive) {
      setBidError("Listing is not accepting bids.");
      return;
    }
    if (!selectedProduct.auctionEnabled) {
      setBidError("Bidding is not enabled for this listing.");
      return;
    }
    const listingId = resolveListingIdPayload(selectedProduct);
    const bidAmount = Number(bidDraftAmount);
    if (!listingId) {
      setBidError("Listing is not ready for bids.");
      return;
    }
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      setBidError("Enter a valid bid amount.");
      return;
    }
    const buyNowPrice = Number(selectedProduct.price || 0);
    if (Number.isFinite(buyNowPrice) && buyNowPrice > 0 && bidAmount > buyNowPrice) {
      setBidError("Bid cannot exceed the buy now price.");
      return;
    }
    setBidError(null);
    setBidNotice(null);
    setBidLoading(true);
    try {
      await api.post("/marketplace-bids", {
        data: {
          listing: listingId,
          amount: bidAmount,
        },
      });
      setBidNotice("Bid submitted.");
      setBidDraftAmount("");
      await loadBids(selectedProduct);
    } catch (err) {
      setBidError(getApiErrorMessage(err, "Unable to place bid."));
    } finally {
      setBidLoading(false);
    }
  };

  const handleUpdateBid = async (bidId: string, status: BidStatus) => {
    if (!selectedProduct || !user?.id) return;
    setBidError(null);
    setBidNotice(null);
    setBidLoading(true);
    try {
      await api.put(`/marketplace-bids/${bidId}`, { data: { status } });
      setBidNotice(
        status === "accepted"
          ? "Bid accepted."
          : status === "declined"
          ? "Bid declined."
          : "Bid withdrawn."
      );
      await loadBids(selectedProduct);
    } catch {
      setBidError("Unable to update bid.");
    } finally {
      setBidLoading(false);
    }
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

  const handleQuickMessage = (value: string) => {
    const next = String(value || "").trim();
    if (!next) return;
    setMessageDraft(next);
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
              {String(selectedProduct.status || "active").toLowerCase() === "sold" && (
                <span className="storefront-status-pill sold">Sold</span>
              )}
              {String(selectedProduct.status || "active").toLowerCase() === "pending" && (
                <span className="storefront-status-pill pending">Pending</span>
              )}
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
                    {String(selectedProduct.status || "active").toLowerCase() === "sold" && (
                      <div className="storefront-sold-banner">Sold</div>
                    )}
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
            {selectedProduct &&
              String(selectedProduct.status || "active").toLowerCase() === "sold" &&
              similarListings.length > 0 && (
                <div className="storefront-panel storefront-similar">
                  <div className="storefront-panel-header">
                    <div>
                      <p className="storefront-panel-eyebrow">Similar listings</p>
                      <h3>Explore similar items</h3>
                    </div>
                    <span>Available now</span>
                  </div>
                  <div className="storefront-similar-grid">
                    {similarListings.map((item) => (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        className="storefront-card"
                        onClick={() => navigate(`/storefront/listing/${item.id}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(`/storefront/listing/${item.id}`);
                          }
                        }}
                      >
                        <div className="storefront-card-image">
                          {item.images[0] ? (
                            <img src={item.images[0]} alt={item.title} />
                          ) : (
                            <div className="storefront-card-fallback" />
                          )}
                          <span className="storefront-card-condition">
                            {item.condition}
                          </span>
                          <span className="storefront-card-price-pill">
                            {formatPrice(item.price)}
                          </span>
                        </div>
                        <div className="storefront-card-body">
                          <h3>{item.title}</h3>
                          <p className="storefront-card-location">{item.location}</p>
                          <div className="storefront-card-row">
                            <span className="storefront-card-price">
                              {formatPrice(item.price)}
                            </span>
                            <span className="storefront-card-stock">
                              {item.stock} in stock
                            </span>
                          </div>
                          <div className="storefront-card-tags">
                            <span>{item.category}</span>
                            {item.seller.verifiedLevel === "verified" && (
                              <span className="is-verified">Verified seller</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>

          <aside className="storefront-detail-aside">
            <div className="storefront-panel storefront-fee-panel">
              <div className="storefront-panel-header">
                <div>
                  <p className="storefront-panel-eyebrow">Transaction summary</p>
                  <h3>Estimated payout</h3>
                </div>
                <span className="storefront-fee-note">{feeRateLabel}</span>
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
                <span>Platform fee</span>
                <strong>-{formatCurrency(platformFee, feeCurrency)}</strong>
              </div>
              <div className="storefront-fee-row total">
                <span>{isListingOwner ? "You receive" : "Seller receives"}</span>
                <strong>{formatCurrency(sellerPayout, feeCurrency)}</strong>
              </div>
              {!isListingOwner && (
                <div className="storefront-payment-methods" aria-label="Payment methods">
                  <p className="storefront-panel-eyebrow">Payment method</p>
                  <div className="storefront-payment-option">
                    <span className="storefront-payment-icon paypal" aria-hidden="true">
                      P
                    </span>
                    <span>Pay online (PayPal)</span>
                  </div>
                </div>
              )}
              {checkoutError && (
                <p className="storefront-form-error">{checkoutError}</p>
              )}
              {checkoutStatus && (
                <p className="storefront-status success">{checkoutStatus}</p>
              )}
              {!isListingOwner && (
                <button
                  className="btn primary"
                  type="button"
                  disabled={checkoutLoading || !selectedProduct}
                  onClick={handlePayWithPaypal}
                >
                  {checkoutLoading ? "Connecting..." : "Pay with PayPal"}
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
              {!isListingOwner && (
                <div className="storefront-message-quick">
                  <span className="storefront-message-quick-label">Quick messages</span>
                  <div className="storefront-message-quick-list">
                    {QUICK_BUYER_MESSAGES.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className="storefront-message-quick-btn"
                        onClick={() => handleQuickMessage(preset)}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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

            {selectedProduct?.auctionEnabled && (
              <div className="storefront-panel storefront-auction">
                <div className="storefront-panel-header">
                  <div>
                    <p className="storefront-panel-eyebrow">Auction</p>
                    <h3>Place a bid</h3>
                  </div>
                  <span
                    className={`storefront-auction-pill ${
                      auctionEnded ? "ended" : "live"
                    }`}
                  >
                    {auctionEnded ? "Auction ended" : "Live"}
                  </span>
                </div>
                <div className="storefront-auction-grid">
                  <div>
                    <span>Ends</span>
                    <strong>
                      {auctionEndAt ? auctionEndAt.toLocaleString() : "TBD"}
                    </strong>
                  </div>
                  <div>
                    <span>Starting bid</span>
                    <strong>
                      {formatPrice(Number(selectedProduct.startingBid || 0))}
                    </strong>
                  </div>
                  <div>
                    <span>Current bid</span>
                    <strong>
                      {formatPrice(
                        Number(highestBid ?? selectedProduct.startingBid ?? 0)
                      )}
                    </strong>
                  </div>
                </div>
                {bidError && <p className="storefront-form-error">{bidError}</p>}
                {bidNotice && <p className="storefront-status success">{bidNotice}</p>}
                {!isListingOwner && !auctionEnded && (
                  <div className="storefront-auction-form">
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      placeholder="Your bid"
                      value={bidDraftAmount}
                      onChange={(event) => setBidDraftAmount(event.target.value)}
                    />
                    <button
                      className="btn primary"
                      type="button"
                      onClick={handlePlaceBid}
                      disabled={bidLoading}
                    >
                      {bidLoading ? "Submitting..." : "Place bid"}
                    </button>
                  </div>
                )}
                {!isListingOwner && auctionEnded && (
                  <p className="storefront-thread-empty">
                    Auction ended. Waiting on seller acceptance.
                  </p>
                )}
                {bidLoading && <p className="storefront-thread-empty">Loading bids…</p>}
                {!bidLoading && bidsForDisplay.length === 0 && (
                  <p className="storefront-thread-empty">
                    {isListingOwner
                      ? "No bids yet."
                      : "No bids yet. Be the first to bid."}
                  </p>
                )}
                {!bidLoading && bidsForDisplay.length > 0 && (
                  <div className="storefront-auction-list">
                    {bidsForDisplay.map((bid) => (
                      <div key={bid.id} className={`storefront-auction-card ${bid.status}`}>
                        <div>
                          <strong>{isListingOwner ? bid.bidderName : "You"}</strong>
                          <span>
                            {formatPrice(bid.amount)} • {bid.createdAt}
                          </span>
                        </div>
                        <div className="storefront-auction-actions">
                          {isListingOwner &&
                            auctionEnded &&
                            bid.status === "pending" &&
                            bid.id === highestPendingBid?.id && (
                              <button
                                className="btn primary small"
                                type="button"
                                onClick={() => handleUpdateBid(bid.id, "accepted")}
                              >
                                Accept winner
                              </button>
                            )}
                          {isListingOwner &&
                            auctionEnded &&
                            bid.status === "pending" && (
                              <button
                                className="btn ghost small"
                                type="button"
                                onClick={() => handleUpdateBid(bid.id, "declined")}
                              >
                                Decline
                              </button>
                            )}
                          {!isListingOwner &&
                            bid.status === "pending" &&
                            !auctionEnded && (
                              <button
                                className="btn ghost small"
                                type="button"
                                onClick={() => handleUpdateBid(bid.id, "withdrawn")}
                              >
                                Withdraw
                              </button>
                            )}
                          {bid.status !== "pending" && (
                            <span className={`storefront-auction-pill ${bid.status}`}>
                              {bid.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {acceptedBid && (
                  <p className="storefront-status success">
                    Winning bid accepted.
                  </p>
                )}
              </div>
            )}

            <div className="storefront-panel storefront-offer" ref={offerPanelRef}>
              <div className="storefront-panel-header">
                <div>
                  <p className="storefront-panel-eyebrow">Bargain</p>
                  <h3>{isListingOwner ? "Open offers" : "Send an offer"}</h3>
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
                    ? "No open offers yet."
                    : "No offers yet. Submit your bargain to get started."}
                </p>
              )}
              {!offerLoading && offersForDisplay.length > 0 && (
                <div className="storefront-offer-list">
                  {offersForDisplay.map((offer) => (
                    <div key={offer.id} className={`storefront-offer-card ${offer.status}`}>
                      <div className="storefront-offer-head">
                        <div>
                          <strong>{isListingOwner ? offer.buyerName : "You"}</strong>
                          <span>
                            {formatCurrency(offer.offeredPrice, offer.currency)} •{" "}
                            {offer.createdAt}
                          </span>
                        </div>
                        <span className={`storefront-offer-pill ${offer.status}`}>
                          {offer.status}
                        </span>
                      </div>
                      {offer.note && (
                        <p className="storefront-offer-note">{offer.note}</p>
                      )}
                      {(offer.status === "pending" || offer.status === "countered") && (
                        <p className="storefront-offer-meta">
                          {offer.status === "countered"
                            ? `Countered by ${getOfferLastActorLabel(offer)} | ${
                                isOfferAwaitingCurrentUser(offer)
                                  ? "Your move"
                                  : "Awaiting response"
                              }`
                            : isListingOwner
                              ? "Waiting on your response"
                              : "Waiting on seller response"}
                        </p>
                      )}
                      <div className="storefront-offer-actions">
                        {(offer.status === "pending" || offer.status === "countered") &&
                          isOfferAwaitingCurrentUser(offer) && (
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
                        {!isListingOwner &&
                          (offer.status === "pending" || offer.status === "countered") && (
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => handleUpdateOffer(offer.id, "withdrawn")}
                            >
                              Withdraw
                            </button>
                          )}
                      </div>
                      {(offer.status === "pending" || offer.status === "countered") &&
                        isOfferAwaitingCurrentUser(offer) && (
                          <div className="storefront-offer-counter">
                            <input
                              type="number"
                              min={0.01}
                              step={0.01}
                              placeholder="Counter offer"
                              value={
                                counterDrafts[offer.id] ??
                                (Number.isFinite(offer.offeredPrice)
                                  ? offer.offeredPrice.toFixed(2)
                                  : "")
                              }
                              onChange={(event) =>
                                setCounterDrafts((prev) => ({
                                  ...prev,
                                  [offer.id]: event.target.value,
                                }))
                              }
                            />
                            <input
                              type="text"
                              placeholder="Optional note"
                              value={counterNotes[offer.id] ?? ""}
                              onChange={(event) =>
                                setCounterNotes((prev) => ({
                                  ...prev,
                                  [offer.id]: event.target.value,
                                }))
                              }
                            />
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => handleCounterOffer(offer.id)}
                            >
                              Counter
                            </button>
                          </div>
                        )}
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
