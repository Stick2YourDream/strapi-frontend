export type SellerDashboardUiConfig = {
  heroKicker: string;
  heroTitle: string;
  heroSubtitle: string;
  heroHelper: string;
  heroVerifiedLabel: string;
  previewButtonLabel: string;
  previewDisabledLabel: string;
  addProductButtonLabel: string;
  accountButtonLabel: string;
  paymentMethodsLabel: string;
  dashboardLayoutLabel: string;
  settingsButtonLabel: string;
  rangeLabel7: string;
  rangeLabel30: string;
  rangeLabel90: string;
  orderSummaryTitle: string;
  orderStatusLabel: string;
  orderViewDetailsLabel: string;
  orderEmptyLabel: string;
  orderCtaLabel: string;
  guideTitle: string;
  guideSubtitle: string;
  guideFallbackActionLabel: string;
  listingsTitle: string;
  listingsViewAllLabel: string;
  listingsEmptyLabel: string;
  listingsCtaLabel: string;
  performanceTitle: string;
  performanceRevenueLabel: string;
  performanceMonthlyLabel: string;
  performanceOrdersLabel: string;
  performanceVisitorsLabel: string;
  heroImageUrl: string;
  heroImageInset: number;
  heroImageOpacity: number;
  heroOverlayOpacity: number;
  shellMaxWidth: number;
  showSetupGuide: boolean;
  showPerformanceSnapshot: boolean;
  colors: {
    bgTop: string;
    bgBottom: string;
    border: string;
    borderStrong: string;
    text: string;
    muted: string;
    accent: string;
    primaryStart: string;
    primaryEnd: string;
    primaryText: string;
  };
};

export const DEFAULT_SELLER_DASHBOARD_UI_CONFIG: SellerDashboardUiConfig = {
  heroKicker: "",
  heroTitle: "Storefront Control Center",
  heroSubtitle: "",
  heroHelper: "",
  heroVerifiedLabel: "Verified Seller",
  previewButtonLabel: "Preview Listings",
  previewDisabledLabel: "Storefront disabled",
  addProductButtonLabel: "Add Product",
  accountButtonLabel: "Account",
  paymentMethodsLabel: "Payment Methods",
  dashboardLayoutLabel: "Dashboard Layout",
  settingsButtonLabel: "Dashboard settings",
  rangeLabel7: "Last 7 Days",
  rangeLabel30: "Last 30 Days",
  rangeLabel90: "Last 90 Days",
  orderSummaryTitle: "Order Summary",
  orderStatusLabel: "Order Status",
  orderViewDetailsLabel: "View Details",
  orderEmptyLabel: "No orders yet.",
  orderCtaLabel: "Create Your First Listing",
  guideTitle: "YSP",
  guideSubtitle: "Account Setup Guide",
  guideFallbackActionLabel: "Review Account",
  listingsTitle: "Recent Listings",
  listingsViewAllLabel: "View all",
  listingsEmptyLabel: "No listings yet.",
  listingsCtaLabel: "Create Your First Listing",
  performanceTitle: "Performance Snapshot",
  performanceRevenueLabel: "Total Revenue",
  performanceMonthlyLabel: "Monthly Overview",
  performanceOrdersLabel: "Orders",
  performanceVisitorsLabel: "Visitors",
  heroImageUrl: "/dashboard/sfsellerbg.png",
  heroImageInset: 37,
  heroImageOpacity: 1,
  heroOverlayOpacity: 1,
  shellMaxWidth: 1260,
  showSetupGuide: true,
  showPerformanceSnapshot: true,
  colors: {
    bgTop: "#071126",
    bgBottom: "#0a1a35",
    border: "#70adf0",
    borderStrong: "#85cbff",
    text: "#f1f6ff",
    muted: "#a8bdd9",
    accent: "#63c6ff",
    primaryStart: "#4f97ff",
    primaryEnd: "#67d8ff",
    primaryText: "#032349",
  },
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const readString = (value: unknown, fallback: string) => {
  const next = String(value ?? "").trim();
  return next || fallback;
};

const readColor = (value: unknown, fallback: string) => {
  const next = String(value ?? "").trim();
  return next || fallback;
};

const readNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  decimals = 0
) => {
  const parsed = Number(value);
  const clamped = Number.isFinite(parsed) ? clampNumber(parsed, min, max) : fallback;
  if (decimals <= 0) return Math.round(clamped);
  return Number(clamped.toFixed(decimals));
};

const readBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
};

export const mergeSellerDashboardUiConfig = (
  value?: Partial<SellerDashboardUiConfig> | null
): SellerDashboardUiConfig => {
  const base = DEFAULT_SELLER_DASHBOARD_UI_CONFIG;
  const input = value ?? {};
  const inputColors: Partial<SellerDashboardUiConfig["colors"]> = input.colors ?? {};
  return {
    heroKicker: readString(input.heroKicker, base.heroKicker),
    heroTitle: readString(input.heroTitle, base.heroTitle),
    heroSubtitle: readString(input.heroSubtitle, base.heroSubtitle),
    heroHelper: readString(input.heroHelper, base.heroHelper),
    heroVerifiedLabel: readString(input.heroVerifiedLabel, base.heroVerifiedLabel),
    previewButtonLabel: readString(input.previewButtonLabel, base.previewButtonLabel),
    previewDisabledLabel: readString(input.previewDisabledLabel, base.previewDisabledLabel),
    addProductButtonLabel: readString(input.addProductButtonLabel, base.addProductButtonLabel),
    accountButtonLabel: readString(input.accountButtonLabel, base.accountButtonLabel),
    paymentMethodsLabel: readString(input.paymentMethodsLabel, base.paymentMethodsLabel),
    dashboardLayoutLabel: readString(input.dashboardLayoutLabel, base.dashboardLayoutLabel),
    settingsButtonLabel: readString(input.settingsButtonLabel, base.settingsButtonLabel),
    rangeLabel7: readString(input.rangeLabel7, base.rangeLabel7),
    rangeLabel30: readString(input.rangeLabel30, base.rangeLabel30),
    rangeLabel90: readString(input.rangeLabel90, base.rangeLabel90),
    orderSummaryTitle: readString(input.orderSummaryTitle, base.orderSummaryTitle),
    orderStatusLabel: readString(input.orderStatusLabel, base.orderStatusLabel),
    orderViewDetailsLabel: readString(input.orderViewDetailsLabel, base.orderViewDetailsLabel),
    orderEmptyLabel: readString(input.orderEmptyLabel, base.orderEmptyLabel),
    orderCtaLabel: readString(input.orderCtaLabel, base.orderCtaLabel),
    guideTitle: readString(input.guideTitle, base.guideTitle),
    guideSubtitle: readString(input.guideSubtitle, base.guideSubtitle),
    guideFallbackActionLabel: readString(
      input.guideFallbackActionLabel,
      base.guideFallbackActionLabel
    ),
    listingsTitle: readString(input.listingsTitle, base.listingsTitle),
    listingsViewAllLabel: readString(input.listingsViewAllLabel, base.listingsViewAllLabel),
    listingsEmptyLabel: readString(input.listingsEmptyLabel, base.listingsEmptyLabel),
    listingsCtaLabel: readString(input.listingsCtaLabel, base.listingsCtaLabel),
    performanceTitle: readString(input.performanceTitle, base.performanceTitle),
    performanceRevenueLabel: readString(
      input.performanceRevenueLabel,
      base.performanceRevenueLabel
    ),
    performanceMonthlyLabel: readString(
      input.performanceMonthlyLabel,
      base.performanceMonthlyLabel
    ),
    performanceOrdersLabel: readString(input.performanceOrdersLabel, base.performanceOrdersLabel),
    performanceVisitorsLabel: readString(
      input.performanceVisitorsLabel,
      base.performanceVisitorsLabel
    ),
    heroImageUrl: readString(input.heroImageUrl, base.heroImageUrl),
    heroImageInset: readNumber(input.heroImageInset, base.heroImageInset, 20, 60),
    heroImageOpacity: readNumber(input.heroImageOpacity, base.heroImageOpacity, 0.15, 1, 2),
    heroOverlayOpacity: readNumber(
      input.heroOverlayOpacity,
      base.heroOverlayOpacity,
      0.35,
      1,
      2
    ),
    shellMaxWidth: readNumber(input.shellMaxWidth, base.shellMaxWidth, 1100, 1640),
    showSetupGuide: readBoolean(input.showSetupGuide, base.showSetupGuide),
    showPerformanceSnapshot: readBoolean(
      input.showPerformanceSnapshot,
      base.showPerformanceSnapshot
    ),
    colors: {
      bgTop: readColor(inputColors.bgTop, base.colors.bgTop),
      bgBottom: readColor(inputColors.bgBottom, base.colors.bgBottom),
      border: readColor(inputColors.border, base.colors.border),
      borderStrong: readColor(inputColors.borderStrong, base.colors.borderStrong),
      text: readColor(inputColors.text, base.colors.text),
      muted: readColor(inputColors.muted, base.colors.muted),
      accent: readColor(inputColors.accent, base.colors.accent),
      primaryStart: readColor(inputColors.primaryStart, base.colors.primaryStart),
      primaryEnd: readColor(inputColors.primaryEnd, base.colors.primaryEnd),
      primaryText: readColor(inputColors.primaryText, base.colors.primaryText),
    },
  };
};
