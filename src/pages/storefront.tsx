import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import "../css/dashboard.css";
import "../css/storefront.css";
import "../css/sidebar.css";
import FullScreenLoader from "../components/FullScreenLoader";
import TopbarSearch from "../components/TopbarSearch";
import api from "../api/strapi";
import AvatarImage from "../components/AvatarImage";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { pickMediaUrls } from "../utils/media";

const USE_DEMO_LISTINGS = import.meta.env.DEV;
const STOREFRONT_DEMO_ENABLED_KEY = "storefront:demoListingsEnabled";
const STOREFRONT_DEMO_COUNT_KEY = "storefront:demoListingsCount";
const STOREFRONT_DEMO_MAX = 120;

const readStorefrontDemoEnabled = () => {
  if (typeof window === "undefined") return USE_DEMO_LISTINGS;
  const raw = window.localStorage.getItem(STOREFRONT_DEMO_ENABLED_KEY);
  if (raw === null) return USE_DEMO_LISTINGS;
  return raw === "true";
};

const readStorefrontDemoCount = () => {
  if (typeof window === "undefined") return 0;
  const raw = Number(window.localStorage.getItem(STOREFRONT_DEMO_COUNT_KEY) || 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(STOREFRONT_DEMO_MAX, raw));
};

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
  visibility?: "public" | "friends";
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

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const formatPrice = (value: number) => (value <= 0 ? "Free" : currency.format(value));

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};

const getEntityId = (value: any) => {
  if (!value) return null;
  if (typeof value === "number") return value;
  const data = value?.data ?? value;
  const id = data?.id ?? data?.attributes?.id;
  const numeric = Number(id);
  return Number.isFinite(numeric) ? numeric : null;
};

export default function Storefront() {
  usePageMeta({
    title: "StoreFront | Your Social Place",
    description: "Browse verified listings across every category and connect fast.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const navigate = useNavigate();
  const location = useLocation();
  const { getBackgroundStyle } = useUserPreferences();
  const previewMine = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("preview") === "mine";
  }, [location.search]);
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [conditionFilter, setConditionFilter] = useState("Any");
  const [sortMode, setSortMode] = useState<"default" | "trending">("default");
  const [locationFilter, setLocationFilter] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, profile, logout } = useAuth();
  const loadingStartedRef = useRef(false);
  const listingGridRef = useRef<HTMLDivElement | null>(null);
  const [demoEnabled, setDemoEnabled] = useState(readStorefrontDemoEnabled);
  const [demoCount, setDemoCount] = useState(readStorefrontDemoCount);

  useEffect(() => {
    if (loadingListings) {
      loadingStartedRef.current = true;
      return;
    }
    if (loadingStartedRef.current) {
      setHasLoadedOnce(true);
    }
  }, [loadingListings]);

  const demoListings = useMemo(() => {
    if (!demoEnabled || previewMine) return [];
    const extra = demoCount > 0 ? buildDemoListings(demoCount, 0) : [];
    return [...DEFAULT_PRODUCTS, ...extra];
  }, [demoCount, demoEnabled, previewMine]);

  const loadListings = useCallback(async () => {
    if (previewMine && !user?.id) {
      setProducts([]);
      return;
    }
    setLoadingListings(true);
    setListingError(null);
    try {
      const ownerFilter =
        previewMine && user?.id ? `&filters[owner][id][$eq]=${user.id}` : "";
      const res = await api.get(
        `/marketplace-listings?populate[0]=images&populate[1]=owner&sort=createdAt:desc${ownerFilter}`
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
        const localPickup =
          typeof attrs.localPickup === "boolean" ? attrs.localPickup : false;
        const cashAccepted = typeof attrs.cashAccepted === "boolean" ? attrs.cashAccepted : false;
        const shippingSummaryParts: string[] = [];
        if (localPickup) shippingSummaryParts.push("Local pickup available");
        if (cashAccepted) shippingSummaryParts.push("Cash accepted");
        if (!shippingSummaryParts.length) {
          shippingSummaryParts.push("Delivery arranged privately");
        }
        const shippingSummary = shippingSummaryParts.join(" · ");
        return {
          id: String(entry?.id ?? attrs.documentId ?? attrs.id ?? Date.now()),
          rawId: Number(entry?.id ?? attrs.documentId ?? attrs.id) || undefined,
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
          localPickup,
          cashAccepted,
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
      const fallback = demoListings;
      const combined = enriched.length ? [...demoListings, ...enriched] : fallback;
      setProducts(combined);
    } catch (err) {
      setListingError("Unable to load listings right now.");
      setProducts(demoListings);
    } finally {
      setLoadingListings(false);
    }
  }, [demoListings, previewMine, user?.id]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLocation = locationFilter.trim().toLowerCase();
    const minValue = minPrice.trim() ? Number(minPrice) : null;
    const maxValue = maxPrice.trim() ? Number(maxPrice) : null;
    const filtered = products.filter((product) => {
      if (categoryFilter !== "All" && product.category !== categoryFilter) {
        return false;
      }
      if (conditionFilter !== "Any" && product.condition !== conditionFilter) {
        return false;
      }
      if (freeOnly && product.price > 0) {
        return false;
      }
      if (verifiedOnly && product.seller.verifiedLevel !== "verified") {
        return false;
      }
      if (normalizedLocation && !product.location.toLowerCase().includes(normalizedLocation)) {
        return false;
      }
      if (minValue !== null && Number.isFinite(minValue) && product.price < minValue) {
        return false;
      }
      if (maxValue !== null && Number.isFinite(maxValue) && product.price > maxValue) {
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
  }, [
    categoryFilter,
    conditionFilter,
    freeOnly,
    locationFilter,
    maxPrice,
    minPrice,
    products,
    query,
    sortMode,
    verifiedOnly,
  ]);

  const handleBrowseTrending = () => {
    setSortMode("trending");
    listingGridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleListProduct = () => {
    navigate("/storefront/seller#list");
  };

  const handleOpenSellerDashboard = () => {
    navigate("/storefront/seller");
  };

  const handleOpenListing = (productId: string) => {
    navigate(`/storefront/listing/${productId}`);
  };

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

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  const pageBackground = getBackgroundStyle("storefront") || getBackgroundStyle("dashboard");
  const showInitialLoader = loadingListings && !hasLoadedOnce;
  const displayName =
    profile?.firstName || profile?.lastName
      ? `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim()
      : profile?.handle || user?.email || "Guest";
  const handleLine = profile?.handle || user?.email || "Profile";
  const avatarUrl = profile?.avatarUrl;
  const fallbackInitial = displayName.charAt(0).toUpperCase();

  const handleLogoClick = () => {
    navigate("/dashboard");
    setShowProfileMenu(false);
    setMenuOpen(false);
  };

  const handleProfileAction = (path: string) => {
    navigate(path);
    setShowProfileMenu(false);
    setMenuOpen(false);
  };

  return (
    <div className="dashboard-shell storefront-shell" style={pageBackground}>
      {showInitialLoader && <FullScreenLoader label="Loading storefront" />}
      <div className={`sidebar-shell ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-topbar">
          <button className="brand" type="button" onClick={handleLogoClick} style={{ cursor: "pointer" }}>
            <span className="brand-mark" aria-hidden="true">
              <img src="/logo2.png" alt="Your Social Place Logo" />
            </span>
            <span className="brand-text">Your Social Place</span>
          </button>
          <div className="mobile-topbar-actions">
            <button
              type="button"
              className={`hamburger ${menuOpen ? "is-open" : ""}`}
              onClick={() => {
                setMenuOpen((prev) => !prev);
                setShowProfileMenu(false);
              }}
              aria-label="Toggle storefront filters"
            >
              <span />
              <span />
              <span />
            </button>
            <button
              type="button"
              className={`mobile-avatar-button ${showProfileMenu ? "is-open" : ""}`}
              onClick={() => {
                setShowProfileMenu((prev) => !prev);
                setMenuOpen(false);
              }}
              aria-label={`Open profile menu for ${displayName}`}
            >
              {avatarUrl ? (
                <AvatarImage
                  src={avatarUrl}
                  alt={displayName}
                  className="mobile-avatar-image"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="mobile-avatar-fallback" aria-hidden="true">
                  {fallbackInitial}
                </span>
              )}
            </button>
            {showProfileMenu && (
              <div className="mobile-profile-menu">
                <button
                  className="mobile-profile-item"
                  type="button"
                  data-accent="dashboard"
                  onClick={() => handleProfileAction("/dashboard")}
                >
                  <span className="sidebar-nav-icon" aria-hidden="true">
                    <LayoutDashboard size={18} />
                  </span>
                  <span>Back to dashboard</span>
                </button>
                <button
                  className="mobile-profile-item"
                  type="button"
                  onClick={() => handleProfileAction("/me")}
                >
                  My Profile
                </button>
                {user && (
                  <button
                    className="mobile-profile-item"
                    type="button"
                    onClick={() => {
                      logout("user-action");
                      navigate("/login");
                      setShowProfileMenu(false);
                      setMenuOpen(false);
                    }}
                  >
                    Logout
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {menuOpen && (
          <button
            type="button"
            className="sidebar-overlay"
            aria-label="Close storefront filters"
            onClick={() => setMenuOpen(false)}
          />
        )}

        <aside className="dash-nav storefront-filter-nav">
          <button className="brand" type="button" onClick={handleLogoClick}>
            <span className="brand-mark" aria-hidden="true">
              <img src="/logo2.png" alt="Your Social Place Logo" />
            </span>
            <span className="brand-text">Your Social Place</span>
          </button>

          <div className="sidebar-profile-slot">
            <div className="sidebar-profile-row">
              <button
                type="button"
                className="sidebar-profile-button"
                onClick={() => setShowProfileMenu((prev) => !prev)}
                aria-expanded={showProfileMenu}
                aria-controls="storefront-profile-menu"
              >
                {avatarUrl ? (
                  <AvatarImage
                    src={avatarUrl}
                    alt={displayName}
                    className="avatar-octagon"
                    style={{ width: 48, height: 48, borderRadius: "50%" }}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: "linear-gradient(135deg, #60a5fa, #7c3aed)",
                      color: "#0b0d14",
                      fontWeight: 700,
                    }}
                  >
                    {fallbackInitial}
                  </div>
                )}
                <div style={{ textAlign: "left", minWidth: 0 }}>
                  <strong style={{ display: "block" }}>{displayName}</strong>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--ysp-muted-2, #9ca3af)",
                      display: "block",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={handleLine}
                  >
                    {handleLine}
                  </span>
                </div>
              </button>
            </div>
            {showProfileMenu && (
              <div id="storefront-profile-menu" className="sidebar-profile-menu">
                <button
                  className="btn ghost nav-btn sidebar-profile-menu-button"
                  type="button"
                  data-accent="dashboard"
                  onClick={() => handleProfileAction("/dashboard")}
                >
                  <span className="sidebar-nav-icon" aria-hidden="true">
                    <LayoutDashboard size={18} />
                  </span>
                  <span>Back to dashboard</span>
                </button>
              <button
                className="btn ghost nav-btn sidebar-profile-menu-button"
                type="button"
                onClick={() => handleProfileAction("/me")}
              >
                My profile
              </button>
                {user && (
                  <button
                    className="btn ghost nav-btn sidebar-profile-menu-button"
                    type="button"
                    onClick={() => {
                      logout("user-action");
                      navigate("/login");
                      setShowProfileMenu(false);
                      setMenuOpen(false);
                    }}
                  >
                    Logout
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="sidebar-nav-links">
            <button
              type="button"
              className="btn ghost sidebar-nav-link"
              data-accent="dashboard"
              onClick={() => handleProfileAction("/dashboard")}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                <LayoutDashboard size={18} />
              </span>
              <span>Back to dashboard</span>
            </button>
          </div>

          <div className="storefront-sidebar-panel">
            <div className="storefront-sidebar-header">
              <p className="storefront-sidebar-eyebrow">Search listings</p>
              <h3>Find exactly what you want</h3>
              <p className="storefront-sidebar-sub">
                Filter by location, price, and seller verification to narrow results fast.
              </p>
            </div>

            <div className="storefront-sidebar-group">
              <label className="storefront-field" htmlFor="storefront-search">
                <span>Keyword</span>
                <input
                  id="storefront-search"
                  type="text"
                  placeholder="Search title, description, or location"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="storefront-field" htmlFor="storefront-location">
                <span>Location</span>
                <input
                  id="storefront-location"
                  type="text"
                  placeholder="City or state"
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                />
              </label>
            </div>

            <div className="storefront-sidebar-group">
              <label className="storefront-field" htmlFor="storefront-category">
                <span>Category</span>
                <select
                  id="storefront-category"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="storefront-field" htmlFor="storefront-condition">
                <span>Condition</span>
                <select
                  id="storefront-condition"
                  value={conditionFilter}
                  onChange={(event) => setConditionFilter(event.target.value)}
                >
                  {CONDITION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="storefront-sidebar-group">
              <div className="storefront-field">
                <span>Price range</span>
                <div className="storefront-range">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Min"
                    value={minPrice}
                    onChange={(event) => setMinPrice(event.target.value)}
                  />
                  <span className="storefront-range-sep">to</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Max"
                    value={maxPrice}
                    onChange={(event) => setMaxPrice(event.target.value)}
                  />
                </div>
              </div>
              <label className="storefront-field" htmlFor="storefront-sort">
                <span>Sort</span>
                <select
                  id="storefront-sort"
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as "default" | "trending")}
                >
                  <option value="default">Newest</option>
                  <option value="trending">Trending</option>
                </select>
              </label>
            </div>

          <div className="storefront-sidebar-toggles">
            <label className="storefront-toggle">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(event) => setVerifiedOnly(event.target.checked)}
              />
              <span className="storefront-switch" aria-hidden="true">
                <span className="storefront-switch-thumb" />
              </span>
              <span className="storefront-toggle-text">Verified sellers only</span>
            </label>
            <label className="storefront-toggle">
              <input
                type="checkbox"
                checked={freeOnly}
                onChange={(event) => setFreeOnly(event.target.checked)}
              />
              <span className="storefront-switch" aria-hidden="true">
                <span className="storefront-switch-thumb" />
              </span>
              <span className="storefront-toggle-text">Show free items only</span>
            </label>
          </div>
          </div>
        </aside>
      </div>

      <div className="main-content storefront-page">
        <TopbarSearch />

        <section className="dash-hero storefront-hero">
          <div className="storefront-hero-copy">
            <p className="storefront-eyebrow">StoreFront</p>
            <h1>Find verified listings across every category.</h1>
            <p>
              Explore everything from free picks to cars and collectibles. Tap a listing to
              view details, message the seller, or send a bargain offer.
            </p>
            <div className="storefront-hero-actions">
              <button className="btn primary" type="button" onClick={handleListProduct}>
                List a product
              </button>
              <button className="btn ghost" type="button" onClick={handleBrowseTrending}>
                Browse trending
              </button>
              <button className="btn ghost" type="button" onClick={handleOpenSellerDashboard}>
                Seller dashboard
              </button>
            </div>
          </div>
          <div className="storefront-hero-stats">
            <div className="storefront-stat">
              <span>Active listings</span>
              <strong>{products.length}</strong>
            </div>
            <div className="storefront-stat">
              <span>Platform fee</span>
              <strong>3%</strong>
            </div>
            <div className="storefront-stat">
              <span>Verified protection</span>
              <strong>Buyer + Seller</strong>
            </div>
          </div>
        </section>

        <section className="storefront-layout is-single">
          <div className="storefront-left">
            {loadingListings && (
              <div className="storefront-status">Loading listings...</div>
            )}
            {listingError && <div className="storefront-status error">{listingError}</div>}
            {!loadingListings && !listingError && filteredProducts.length === 0 && (
              <div className="storefront-status">
                No listings yet. Be the first to list a product.
              </div>
            )}

            <div className="storefront-grid" ref={listingGridRef}>
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  role="button"
                  tabIndex={0}
                  className="storefront-card"
                  onClick={() => handleOpenListing(product.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleOpenListing(product.id);
                    }
                  }}
                >
                  <div className="storefront-card-image">
                    {product.images[0] ? (
                      <img src={product.images[0]} alt={product.title} />
                    ) : (
                      <div className="storefront-card-fallback" />
                    )}
                    <span className="storefront-card-condition">{product.condition}</span>
                    <span className="storefront-card-price-pill">
                      {formatPrice(product.price)}
                    </span>
                  </div>
                  <div className="storefront-card-body">
                    <h3>{product.title}</h3>
                    <p className="storefront-card-location">{product.location}</p>
                    <div className="storefront-card-row">
                      <span className="storefront-card-price">
                        {formatPrice(product.price)}
                      </span>
                      <span className="storefront-card-stock">
                        {product.stock} in stock
                      </span>
                    </div>
                    <div className="storefront-card-tags">
                      <span>{product.category}</span>
                      {product.visibility === "friends" && (
                        <span className="is-friends">Friends only</span>
                      )}
                      {product.seller.verifiedLevel === "verified" && (
                        <span className="is-verified">Verified seller</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
