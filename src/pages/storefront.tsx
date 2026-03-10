import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import "../css/dashboard.css";
import "../css/storefront.css";
import "../css/sidebar.css";
import FullScreenLoader from "../components/FullScreenLoader";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import RightSidebarShell from "../components/RightSidebarShell";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { pickMediaUrls } from "../utils/media";
import {
  canWarmCriticalRouteChunks,
  preloadStorefrontSellerRoute,
} from "../routes/routePreloaders";
import {
  STOREFRONT_DEMO_COUNT_KEY,
  STOREFRONT_DEMO_ENABLED_KEY,
  buildStorefrontDemoListings,
  readStorefrontDemoCount,
  readStorefrontDemoEnabled,
} from "../data/storefront-demo";

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
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  soldAt?: string;
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

const SOLD_VISIBILITY_DAYS = 5;
const SOLD_VISIBILITY_MS = SOLD_VISIBILITY_DAYS * 24 * 60 * 60 * 1000;

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
  const [radiusMiles, setRadiusMiles] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const { user, profile } = useAuth();
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

  useEffect(() => {
    if (!profile) return;
    if (!locationFilter.trim() && profile.storefrontDefaultLocation) {
      setLocationFilter(profile.storefrontDefaultLocation);
    }
    if (!radiusMiles && Number(profile.storefrontDefaultRadiusMiles) > 0) {
      setRadiusMiles(String(profile.storefrontDefaultRadiusMiles));
    }
  }, [
    locationFilter,
    profile?.storefrontDefaultLocation,
    profile?.storefrontDefaultRadiusMiles,
    radiusMiles,
  ]);

  const demoListings = useMemo<StorefrontProduct[]>(() => {
    if (!demoEnabled || previewMine || demoCount <= 0) return [];
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
      shippingNotes: "",
      noShippingRequired: true,
      isDemo: true,
    } satisfies StorefrontProduct));
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
          status: String(attrs.status || "active"),
          createdAt: String(attrs.createdAt || entry?.createdAt || ""),
          updatedAt: String(attrs.updatedAt || entry?.updatedAt || ""),
          soldAt: String(attrs.soldAt || ""),
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
      const merged = [...demoListings, ...enriched];
      setProducts(merged);
    } catch (err) {
      if (demoListings.length > 0) {
        setProducts(demoListings);
      } else {
        setListingError("Unable to load listings right now.");
        setProducts([]);
      }
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
      const status = String(product.status || "active").toLowerCase();
      if (!previewMine && ["pending", "draft", "archived"].includes(status)) {
        return false;
      }
      if (status === "sold" && !previewMine) {
        const soldAtRaw =
          product.soldAt?.trim() ||
          product.updatedAt?.trim() ||
          product.createdAt?.trim() ||
          "";
        const soldAtMs = soldAtRaw ? Date.parse(soldAtRaw) : Number.NaN;
        if (Number.isFinite(soldAtMs)) {
          const ageMs = Date.now() - soldAtMs;
          if (ageMs > SOLD_VISIBILITY_MS) {
            return false;
          }
        }
      }
      const categoryLower = product.category.toLowerCase();
      const contentCheck = `${product.title} ${product.description} ${product.category}`.toLowerCase();
      if (BLOCKED_CATEGORIES.has(categoryLower) || hasBlockedKeyword(contentCheck)) {
        return false;
      }
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

  const handleSellerRouteIntent = () => {
    preloadStorefrontSellerRoute();
  };

  const handleListProduct = () => {
    handleSellerRouteIntent();
    navigate("/storefront/seller#list");
  };

  const handleOpenSellerDashboard = () => {
    handleSellerRouteIntent();
    navigate("/storefront/seller");
  };

  const handleOpenListing = (productId: string) => {
    navigate(`/storefront/listing/${productId}`, {
      state: {
        query: query.trim(),
        category: categoryFilter,
        location: locationFilter.trim(),
      },
    });
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!canWarmCriticalRouteChunks()) return;

    let cancelWarmupTrigger = () => {};
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const idleId = idleWindow.requestIdleCallback(() => handleSellerRouteIntent(), {
        timeout: 1200,
      });
      cancelWarmupTrigger = () => {
        if (typeof idleWindow.cancelIdleCallback === "function") {
          idleWindow.cancelIdleCallback(idleId);
        }
      };
    } else {
      const fallbackTimer = window.setTimeout(handleSellerRouteIntent, 500);
      cancelWarmupTrigger = () => {
        window.clearTimeout(fallbackTimer);
      };
    }

    return () => {
      cancelWarmupTrigger();
    };
  }, []);

  const pageBackground = getBackgroundStyle("storefront") || getBackgroundStyle("dashboard");
  const showInitialLoader = loadingListings && !hasLoadedOnce;

  const renderStorefrontSidebarPanel = (idPrefix: string, panelClassName = "") => (
    <div
      className={`storefront-sidebar-panel${panelClassName ? ` ${panelClassName}` : ""}`}
    >
      <div className="storefront-sidebar-header">
        <p className="storefront-sidebar-eyebrow">Search listings</p>
        <h3>Find exactly what you want</h3>
        <p className="storefront-sidebar-sub">
          Filter by location, price, and seller verification to narrow results fast.
        </p>
      </div>

      <div className="storefront-sidebar-group">
        <label className="storefront-field" htmlFor={`${idPrefix}-search`}>
          <span>Keyword</span>
          <input
            id={`${idPrefix}-search`}
            type="text"
            placeholder="Search title, description, or location"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="storefront-field" htmlFor={`${idPrefix}-location`}>
          <span>Location</span>
          <input
            id={`${idPrefix}-location`}
            type="text"
            placeholder="City or state"
            value={locationFilter}
            onChange={(event) => setLocationFilter(event.target.value)}
          />
        </label>
        <label className="storefront-field" htmlFor={`${idPrefix}-radius`}>
          <span>Radius (miles)</span>
          <input
            id={`${idPrefix}-radius`}
            type="number"
            min="1"
            step="1"
            placeholder="e.g. 25"
            value={radiusMiles}
            onChange={(event) => setRadiusMiles(event.target.value)}
          />
        </label>
        <p className="storefront-field-hint">
          The radius is stored and prefilled but not used to actually filter listings yet
          because listings only have a text location string (no lat/long). If you want true
          radius filtering, I can add geocoding + distance checks.
        </p>
      </div>

      <div className="storefront-sidebar-group">
        <label className="storefront-field" htmlFor={`${idPrefix}-category`}>
          <span>Category</span>
          <select
            id={`${idPrefix}-category`}
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
        <label className="storefront-field" htmlFor={`${idPrefix}-condition`}>
          <span>Condition</span>
          <select
            id={`${idPrefix}-condition`}
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
        <label className="storefront-field" htmlFor={`${idPrefix}-sort`}>
          <span>Sort</span>
          <select
            id={`${idPrefix}-sort`}
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
  );

  return (
    <div className="dashboard-shell storefront-shell" style={pageBackground}>
      {showInitialLoader && <FullScreenLoader label="Loading storefront" />}
      <Sidebar active="storefront" />
      <RightSidebarShell
        ariaLabel="Storefront search sidebar"
        headTitle="Search listings"
        headSubtitle={`${filteredProducts.length} results`}
        headIcon={<Search size={18} />}
        headTooltip="Storefront search"
        className="right-search-sidebar"
      >
        {renderStorefrontSidebarPanel("storefront-right")}
      </RightSidebarShell>

      <div className="main-content storefront-page">
        <div className="storefront-results-shell">
          <section className="storefront-quick-actions" aria-label="Storefront quick actions">
            <h1 className="storefront-page-heading">YSP Storefront</h1>
            <div className="storefront-hero-actions">
              <button
                className="btn primary"
                type="button"
                onClick={handleListProduct}
                onMouseEnter={handleSellerRouteIntent}
                onFocus={handleSellerRouteIntent}
                onTouchStart={handleSellerRouteIntent}
              >
                List a product
              </button>
              <button className="btn ghost" type="button" onClick={handleBrowseTrending}>
                Browse trending
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={handleOpenSellerDashboard}
                onMouseEnter={handleSellerRouteIntent}
                onFocus={handleSellerRouteIntent}
                onTouchStart={handleSellerRouteIntent}
              >
                Seller dashboard
              </button>
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
                {filteredProducts.map((product) => {
                  const statusLower = String(product.status || "active").toLowerCase();
                  const isSold = statusLower === "sold";
                  const isPending = statusLower === "pending";
                  const isAvailable = statusLower === "active" || statusLower === "available";
                  return (
                  <div
                    key={product.id}
                    role="button"
                    tabIndex={0}
                    className={`storefront-card ${
                      isSold
                        ? "is-sold"
                        : isPending
                        ? "is-pending"
                        : ""
                    }`}
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
                      {isSold && (
                        <span className="storefront-card-ribbon is-sold">SOLD</span>
                      )}
                      {isPending && (
                        <span className="storefront-card-ribbon is-pending">Pending</span>
                      )}
                      {isAvailable && (
                        <span className="storefront-card-ribbon is-available">Available</span>
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
                );
              })}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
