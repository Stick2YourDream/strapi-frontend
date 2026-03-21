type ListingStateLike = {
  status?: string | null;
  purchaseState?: string | null;
  soldAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

export const SOLD_VISIBILITY_DAYS = 5;
export const SOLD_VISIBILITY_MS = SOLD_VISIBILITY_DAYS * 24 * 60 * 60 * 1000;

export const resolveStorefrontDisplayStatus = (listing?: ListingStateLike | null) => {
  const rawStatus = String(listing?.status || "active").trim().toLowerCase();
  const purchaseState = String(listing?.purchaseState || "available")
    .trim()
    .toLowerCase();

  if (rawStatus === "sold" || purchaseState === "sold") return "sold";
  if (rawStatus === "pending" || purchaseState === "cart" || purchaseState === "checkout") {
    return "pending";
  }
  return rawStatus || "active";
};

export const isStorefrontSoldRecentlyVisible = (listing?: ListingStateLike | null) => {
  if (resolveStorefrontDisplayStatus(listing) !== "sold") return false;
  const soldAtRaw =
    String(listing?.soldAt || "").trim() ||
    String(listing?.updatedAt || "").trim() ||
    String(listing?.createdAt || "").trim();
  if (!soldAtRaw) return false;
  const soldAtMs = Date.parse(soldAtRaw);
  return Number.isFinite(soldAtMs) && Date.now() - soldAtMs <= SOLD_VISIBILITY_MS;
};

export const isStorefrontListingVisible = (
  listing?: ListingStateLike | null,
  previewMine = false
) => {
  const rawStatus = String(listing?.status || "active").trim().toLowerCase();
  if (previewMine) return true;
  if (rawStatus === "draft" || rawStatus === "archived" || rawStatus === "pending") {
    return false;
  }
  if (resolveStorefrontDisplayStatus(listing) === "sold") {
    return isStorefrontSoldRecentlyVisible(listing);
  }
  return true;
};
