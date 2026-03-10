import { type CSSProperties, type RefObject } from "react";
import "../../css/storefront-seller-dashboard.css";
import type { SellerDashboardUiConfig } from "./sellerDashboardUiConfig";

type SetupChecklistItemId = "listing" | "payout";

type SetupChecklistItem = {
  id: SetupChecklistItemId;
  label: string;
  status: "done" | "pending" | "required";
};

type RecentOrderSummaryItem = {
  count: number;
  displayOrder: {
    id: number;
    listingTitle: string;
    buyerName: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
  };
};

type SellerListingPreview = {
  id: string;
  title: string;
  location: string;
  price: number;
};

type SnapshotChart = {
  areaPath: string;
  linePath: string;
  points: Array<{ x: number; y: number }>;
};

type StorefrontSellerDashboardProps = {
  dashboardStyle: CSSProperties;
  uiConfig: SellerDashboardUiConfig;
  sellerIsVerified: boolean;
  storefrontEnabled: boolean;
  onPreviewStore: () => void;
  onOpenListing: () => void;
  accountMenuRef: RefObject<HTMLDivElement>;
  accountMenuOpen: boolean;
  onToggleAccountMenu: () => void;
  onOpenPaymentMethods: () => void;
  buildCardStyle: (id?: string) => CSSProperties;
  onOpenDashboardModule: (moduleId: string) => void;
  displayOrdersLoading: boolean;
  displayOrdersError: string | null;
  recentOrderSummary: RecentOrderSummaryItem[];
  onCreateFirstListing: () => void;
  formatRelativeTime: (value: string) => string;
  formatCurrency: (value: number, currency?: string) => string;
  getStatusTone: (status: string) => string;
  sellerVerificationSummaryLabel: string;
  pendingPayoutAmount: number;
  pendingPayoutCount: number;
  activeListingCount: number;
  setupCompletedCount: number;
  setupChecklist: SetupChecklistItem[];
  nextChecklistItem: SetupChecklistItem | null;
  orderStatusPaidPercent: number;
  orderStatusPendingPercent: number;
  openDisputesCount: number;
  onSetupAction: (id: SetupChecklistItemId) => void;
  setupActionLabels: Record<SetupChecklistItemId, string>;
  displayListingsLoading: boolean;
  displayListingError: string | null;
  sellerListings: SellerListingPreview[];
  formatPrice: (value: number) => string;
  onEditListingById: (listingId: string) => void;
  totalEarningsValue: number;
  snapshotChart: SnapshotChart;
  sellerOrdersCount: number;
  snapshotVisitors: number;
};

export default function StorefrontSellerDashboard({
  dashboardStyle,
  uiConfig,
  sellerIsVerified,
  storefrontEnabled,
  onPreviewStore,
  onOpenListing,
  accountMenuRef,
  accountMenuOpen,
  onToggleAccountMenu,
  onOpenPaymentMethods,
  buildCardStyle,
  onOpenDashboardModule,
  displayOrdersLoading,
  displayOrdersError,
  recentOrderSummary,
  onCreateFirstListing,
  formatRelativeTime,
  formatCurrency,
  getStatusTone,
  sellerVerificationSummaryLabel,
  pendingPayoutAmount,
  pendingPayoutCount,
  activeListingCount,
  setupCompletedCount,
  setupChecklist,
  nextChecklistItem,
  orderStatusPaidPercent,
  orderStatusPendingPercent,
  openDisputesCount,
  onSetupAction,
  setupActionLabels,
  displayListingsLoading,
  displayListingError,
  sellerListings,
  formatPrice,
  onEditListingById,
  totalEarningsValue,
  snapshotChart,
  sellerOrdersCount,
  snapshotVisitors,
}: StorefrontSellerDashboardProps) {
  const previewLabel = storefrontEnabled
    ? uiConfig.previewButtonLabel
    : uiConfig.previewDisabledLabel;
  const closeGearMenu = () => {
    if (!accountMenuOpen) return;
    onToggleAccountMenu();
  };
  const runGearAction =
    (action: () => void) => () => {
      closeGearMenu();
      action();
    };

  return (
    <section className="seller-cc-page" style={dashboardStyle}>
      <div className="seller-cc-shell">
        <section className="seller-cc-hero">
          <header className="seller-cc-hero-header">
            <div className="seller-cc-hero-title">
              <div className="seller-cc-hero-copy">
                <span className="seller-cc-kicker">{uiConfig.heroKicker}</span>
                <h2>{uiConfig.heroTitle}</h2>
                <p>{uiConfig.heroSubtitle}</p>
                {sellerIsVerified ? (
                  <span className="seller-cc-verified-pill">{uiConfig.heroVerifiedLabel}</span>
                ) : (
                  <span className="seller-cc-helper-note"></span>
                )}
              </div>
            </div>
            <div className="seller-cc-hero-gear" ref={accountMenuRef}>
              <button
                className="seller-cc-gear-trigger"
                type="button"
                onClick={onToggleAccountMenu}
                aria-haspopup="dialog"
                aria-expanded={accountMenuOpen}
                aria-controls="seller-cc-settings-modal"
                aria-label={uiConfig.settingsButtonLabel}
                title={uiConfig.settingsButtonLabel}
              >
                ⚙
              </button>
              {accountMenuOpen && (
                <div className="seller-cc-gear-modal" role="presentation">
                  <button
                    type="button"
                    className="seller-cc-gear-backdrop"
                    onClick={closeGearMenu}
                    aria-label="Close settings"
                  />
                  <div
                    id="seller-cc-settings-modal"
                    className="seller-cc-gear-menu seller-cc-gear-menu--modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label={uiConfig.settingsButtonLabel}
                  >
                    <div className="seller-cc-gear-menu-head">
                      <h3>{uiConfig.settingsButtonLabel}</h3>
                      <button
                        type="button"
                        className="seller-cc-gear-close"
                        onClick={closeGearMenu}
                        aria-label="Close settings"
                      >
                        ×
                      </button>
                    </div>
                    <button
                      className="seller-cc-account-link"
                      type="button"
                      onClick={runGearAction(onPreviewStore)}
                      disabled={!storefrontEnabled}
                      aria-disabled={!storefrontEnabled}
                    >
                      {previewLabel}
                    </button>
                    <button
                      className="seller-cc-account-link"
                      type="button"
                      onClick={runGearAction(onOpenListing)}
                    >
                      {uiConfig.addProductButtonLabel}
                    </button>
                    <button
                      className="seller-cc-account-link"
                      type="button"
                      onClick={runGearAction(onOpenPaymentMethods)}
                    >
                      {uiConfig.accountButtonLabel}
                    </button>
                    <button
                      className="seller-cc-account-link seller-cc-account-link--cta"
                      type="button"
                      onClick={runGearAction(onCreateFirstListing)}
                    >
                      {uiConfig.orderCtaLabel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </header>

          <div className="seller-cc-order-section">
            <h3>{uiConfig.orderSummaryTitle}</h3>
            <div className="seller-cc-order-card" style={buildCardStyle("orders")}>
              <div className="seller-cc-order-head">
                <span>{uiConfig.orderStatusLabel}</span>
                <button
                  className="seller-cc-chip-btn"
                  type="button"
                  onClick={() => onOpenDashboardModule("orders")}
                >
                  {uiConfig.orderViewDetailsLabel}
                </button>
              </div>
              {displayOrdersLoading && <p className="seller-cc-order-note">Loading orders...</p>}
              {displayOrdersError && <p className="seller-cc-order-note">{displayOrdersError}</p>}
              {!displayOrdersLoading && !displayOrdersError && recentOrderSummary.length === 0 && (
                <div className="seller-cc-order-empty">
                  <p>{uiConfig.orderEmptyLabel}</p>
                  <button
                    className="seller-cc-btn seller-cc-btn--primary seller-cc-btn--wide"
                    type="button"
                    onClick={onCreateFirstListing}
                  >
                    {uiConfig.orderCtaLabel}
                  </button>
                </div>
              )}
              {!displayOrdersLoading && !displayOrdersError && recentOrderSummary.length > 0 && (
                <div className="seller-cc-order-list">
                  {recentOrderSummary.slice(0, 4).map(({ count, displayOrder }) => (
                    <div key={`order-summary-${displayOrder.id}`} className="seller-cc-order-row">
                      <div className="seller-cc-order-row-main">
                        <strong>{displayOrder.listingTitle}</strong>
                        <span>
                          {displayOrder.buyerName}
                          {count > 1 ? ` (x${count})` : ""} {" - "}
                          {formatRelativeTime(displayOrder.createdAt)}
                        </span>
                      </div>
                      <div className="seller-cc-order-row-meta">
                        <strong>{formatCurrency(displayOrder.amount, displayOrder.currency)}</strong>
                        <span className={`seller-status-chip ${getStatusTone(displayOrder.status)}`}>
                          {displayOrder.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="seller-cc-lower">
          <div className="seller-cc-left-column">
            <div className="seller-cc-kpis">
              <button
                type="button"
                className="seller-cc-kpi-card seller-cc-kpi-card--verification"
                onClick={() => onOpenDashboardModule("verification")}
              >
                <span className="seller-cc-kpi-head">
                  <span className="seller-cc-kpi-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span className="seller-cc-kpi-label">Verification</span>
                </span>
                <strong>{sellerVerificationSummaryLabel}</strong>
                <span className="seller-cc-kpi-meta">
                  {sellerIsVerified
                    ? "Age and payout checks complete"
                    : "Complete identity to unlock payouts"}
                </span>
              </button>
              <button
                type="button"
                className="seller-cc-kpi-card seller-cc-kpi-card--payouts"
                onClick={() => onOpenDashboardModule("payouts")}
              >
                <span className="seller-cc-kpi-head">
                  <span className="seller-cc-kpi-icon" aria-hidden="true">
                    +
                  </span>
                  <span className="seller-cc-kpi-label">Pending Payouts</span>
                </span>
                <strong>{pendingPayoutAmount ? formatCurrency(pendingPayoutAmount, "USD") : "None"}</strong>
                <span className="seller-cc-kpi-meta">
                  {pendingPayoutCount ? `${pendingPayoutCount} waiting to settle` : "All payouts are settled"}
                </span>
              </button>
              <button
                type="button"
                className="seller-cc-kpi-card seller-cc-kpi-card--listings"
                onClick={() => onOpenDashboardModule("activeListings")}
              >
                <span className="seller-cc-kpi-head">
                  <span className="seller-cc-kpi-icon" aria-hidden="true">
                    ▣
                  </span>
                  <span className="seller-cc-kpi-label">Active Listings</span>
                </span>
                <strong>{activeListingCount}</strong>
                <span className="seller-cc-kpi-meta">
                  {activeListingCount
                    ? `${Math.min(activeListingCount, 5)} currently visible`
                    : "Create your first listing"}
                </span>
              </button>
              <button
                type="button"
                className="seller-cc-kpi-card seller-cc-kpi-card--setup"
                onClick={() => onOpenDashboardModule("verification")}
              >
                <span className="seller-cc-kpi-head">
                  <span className="seller-cc-kpi-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span className="seller-cc-kpi-label">Setup Checklist</span>
                </span>
                <strong>
                  {setupCompletedCount} / {setupChecklist.length}
                </strong>
                <span className="seller-cc-kpi-meta">
                  {nextChecklistItem ? `Next: ${nextChecklistItem.label}` : "All steps complete"}
                </span>
              </button>
              <button
                type="button"
                className="seller-cc-kpi-card seller-cc-kpi-card--disputes"
                onClick={() => onOpenDashboardModule("buyerDisputes")}
              >
                <span className="seller-cc-kpi-head">
                  <span className="seller-cc-kpi-icon" aria-hidden="true">
                    !
                  </span>
                  <span className="seller-cc-kpi-label">Open Disputes</span>
                </span>
                <strong>{openDisputesCount}</strong>
                <span className="seller-cc-kpi-meta">
                  Paid {orderStatusPaidPercent}% {" - "}
                  Pending {orderStatusPendingPercent}%
                </span>
              </button>
            </div>

            {uiConfig.showSetupGuide && (
              <div className="seller-cc-guide" style={buildCardStyle()}>
                <div className="seller-cc-guide-book">
                  <h3>{uiConfig.guideTitle}</h3>
                  <span>{uiConfig.guideSubtitle}</span>
                  <ul>
                    {setupChecklist.map((item) => (
                      <li key={`guide-item-${item.id}`}>
                        <button
                          type="button"
                          className={`seller-cc-guide-link is-${item.status}`}
                          onClick={() => onSetupAction(item.id)}
                          title={item.label}
                        >
                          <span
                            className={`seller-cc-check-status is-${item.status}`}
                            aria-hidden="true"
                          />
                          <span>{item.label}</span>
                          <span className="seller-cc-guide-link-arrow" aria-hidden="true">
                            →
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {nextChecklistItem ? (
                    <button
                      className="seller-cc-chip-btn seller-cc-chip-btn--primary"
                      type="button"
                      onClick={() => onSetupAction(nextChecklistItem.id)}
                    >
                      {setupActionLabels[nextChecklistItem.id]}
                    </button>
                  ) : (
                    <button
                      className="seller-cc-chip-btn"
                      type="button"
                      onClick={() => onOpenDashboardModule("verification")}
                    >
                      {uiConfig.guideFallbackActionLabel}
                    </button>
                  )}
                </div>
                <div className="seller-cc-guide-content">
                  <div className="seller-cc-guide-head">
                    <h4>{uiConfig.listingsTitle}</h4>
                    <button
                      className="seller-cc-chip-btn"
                      type="button"
                      onClick={() => onOpenDashboardModule("activeListings")}
                    >
                      {uiConfig.listingsViewAllLabel}
                    </button>
                  </div>
                  {displayListingsLoading && <p className="seller-cc-guide-note">Loading listings...</p>}
                  {displayListingError && <p className="seller-cc-guide-note">{displayListingError}</p>}
                  {!displayListingsLoading && !displayListingError && sellerListings.length === 0 && (
                    <div className="seller-cc-guide-canvas">
                      <span>{uiConfig.listingsEmptyLabel}</span>
                      <button
                        className="seller-cc-chip-btn seller-cc-chip-btn--primary"
                        type="button"
                        onClick={onCreateFirstListing}
                      >
                        {uiConfig.listingsCtaLabel}
                      </button>
                    </div>
                  )}
                  {!displayListingsLoading && !displayListingError && sellerListings.length > 0 && (
                    <div className="seller-cc-guide-list">
                      {sellerListings.slice(0, 4).map((listing) => (
                        <div key={`listing-guide-${listing.id}`} className="seller-cc-guide-row">
                          <div>
                            <strong>{listing.title}</strong>
                            <span>{listing.location || "Location not set"}</span>
                          </div>
                          <div>
                            <strong>{formatPrice(listing.price)}</strong>
                            <button
                              type="button"
                              className="seller-cc-link-btn"
                              onClick={() => onEditListingById(listing.id)}
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {uiConfig.showPerformanceSnapshot && (
            <aside className="seller-cc-snapshot" style={buildCardStyle("totalEarnings")}>
              <h3>{uiConfig.performanceTitle}</h3>
              <div className="seller-cc-snapshot-revenue">
                <span>{uiConfig.performanceRevenueLabel}</span>
                <strong>{formatCurrency(totalEarningsValue, "USD")}</strong>
              </div>
              <div className="seller-cc-snapshot-chart">
                <span>{uiConfig.performanceMonthlyLabel}</span>
                <svg viewBox="0 0 100 100" role="img" aria-label="Revenue trend">
                  <defs>
                    <linearGradient id="sellerSnapshotStroke" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7dd7ff" />
                      <stop offset="100%" stopColor="#4c89ff" />
                    </linearGradient>
                  </defs>
                  <path d={snapshotChart.areaPath} className="seller-cc-snapshot-area" />
                  <path d={snapshotChart.linePath} className="seller-cc-snapshot-line" />
                  {snapshotChart.points.map((point, index) => (
                    <circle
                      key={`snapshot-point-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r="2.2"
                      fill="url(#sellerSnapshotStroke)"
                    />
                  ))}
                </svg>
              </div>
              <div className="seller-cc-snapshot-footer">
                <div>
                  <strong>{sellerOrdersCount}</strong>
                  <span>{uiConfig.performanceOrdersLabel}</span>
                </div>
                <div>
                  <strong>{snapshotVisitors}</strong>
                  <span>{uiConfig.performanceVisitorsLabel}</span>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}
