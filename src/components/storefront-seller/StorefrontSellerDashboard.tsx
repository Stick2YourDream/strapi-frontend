import { useId, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
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

type DashboardOffer = {
  id: string;
  listingId: number;
  listingTitle?: string;
  buyerName: string;
  offeredPrice: number;
  currency: string;
  status: "pending" | "countered" | "accepted" | "declined" | "withdrawn";
  createdAt: string;
  note?: string;
  lastActionBy?: "buyer" | "seller";
};

type SnapshotChartPoint = {
  x: number;
  y: number;
  label: string;
  total: number;
};

type SnapshotChart = {
  linePath: string;
  points: SnapshotChartPoint[];
  xTicks: string[];
  yTicks: number[];
  rangeStartLabel: string;
  latestLabel: string;
  latestValue: number;
  previousValue: number;
  maxValue: number;
  topBound: number;
  bottomBound: number;
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
  openOffers: DashboardOffer[];
  offerActionError: string | null;
  offerActionNotice: string | null;
  offerActionLoading: Record<string, boolean>;
  offerCounterDrafts: Record<string, string>;
  offerCounterNotes: Record<string, string>;
  isOfferActionable: (offer: DashboardOffer) => boolean;
  onOfferDraftChange: (offerId: string, value: string) => void;
  onOfferNoteChange: (offerId: string, value: string) => void;
  onAcceptOffer: (offerId: string) => void;
  onDeclineOffer: (offerId: string) => void;
  onCounterOffer: (offerId: string) => void;
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
  openOffers,
  offerActionError,
  offerActionNotice,
  offerActionLoading,
  offerCounterDrafts,
  offerCounterNotes,
  isOfferActionable,
  onOfferDraftChange,
  onOfferNoteChange,
  onAcceptOffer,
  onDeclineOffer,
  onCounterOffer,
  totalEarningsValue,
  snapshotChart,
  sellerOrdersCount,
  snapshotVisitors,
}: StorefrontSellerDashboardProps) {
  const previewLabel = storefrontEnabled
    ? uiConfig.previewButtonLabel
    : uiConfig.previewDisabledLabel;
  const hasActiveListings = activeListingCount > 0;
  const orderEmptyLabel = hasActiveListings
    ? `No orders yet from your ${activeListingCount} active listing${activeListingCount === 1 ? "" : "s"}.`
    : uiConfig.orderEmptyLabel;
  const orderEmptyActionLabel = hasActiveListings
    ? "View Active Listings"
    : uiConfig.orderCtaLabel;
  const handleOrderEmptyAction = hasActiveListings
    ? () => onOpenDashboardModule("activeListings")
    : onCreateFirstListing;
  const dashboardOffers = openOffers.slice(0, 2);
  const topOfferAmount = dashboardOffers.length
    ? Math.max(...dashboardOffers.map((offer) => Number(offer.offeredPrice || 0)))
    : 0;
  const snapshotIdBase = useId().replace(/:/g, "");
  const snapshotStrokeId = `${snapshotIdBase}-snapshot-stroke`;
  const snapshotGlowId = `${snapshotIdBase}-snapshot-glow`;
  const latestSnapshotPoint = snapshotChart.points[snapshotChart.points.length - 1] ?? null;
  const snapshotStartLabel = snapshotChart.rangeStartLabel || snapshotChart.latestLabel;
  const snapshotRangeLabel =
  snapshotStartLabel === snapshotChart.latestLabel
      ? snapshotChart.latestLabel
      : `${snapshotStartLabel} - ${snapshotChart.latestLabel}`;
  const snapshotTrendDelta = snapshotChart.latestValue - snapshotChart.previousValue;
  const snapshotTrendTone =
    snapshotTrendDelta > 0 ? "up" : snapshotTrendDelta < 0 ? "down" : "flat";
  const snapshotTrendText =
    snapshotChart.previousValue > 0
      ? `${snapshotTrendDelta >= 0 ? "+" : "-"}${Math.round(
          (Math.abs(snapshotTrendDelta) / snapshotChart.previousValue) * 100
        )}%`
      : snapshotTrendDelta !== 0
        ? `${snapshotTrendDelta > 0 ? "+" : "-"}${formatCurrency(
            Math.abs(snapshotTrendDelta),
            "USD"
          )}`
        : "Flat";
  const snapshotTrendNote =
    snapshotChart.previousValue > 0
      ? `${snapshotTrendDelta >= 0 ? "Up" : "Down"} ${formatCurrency(
          Math.abs(snapshotTrendDelta),
          "USD"
        )} versus the previous period`
      : snapshotChart.latestValue > 0
        ? "First measurable revenue in the active trend window"
        : "Waiting for your first completed order";
  const snapshotGridLines = [0, 0.25, 0.5, 0.75, 1].map(
    (ratio) => snapshotChart.bottomBound - ratio * (snapshotChart.bottomBound - snapshotChart.topBound)
  );
  const closeGearMenu = () => {
    if (!accountMenuOpen) return;
    onToggleAccountMenu();
  };
  const runGearAction =
    (action: () => void) => () => {
      closeGearMenu();
      action();
    };
  const settingsModal =
    accountMenuOpen && typeof document !== "undefined"
      ? createPortal(
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
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
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
          </div>,
          document.body
        )
      : null;

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
                  <p>{orderEmptyLabel}</p>
                  <button
                    className="seller-cc-btn seller-cc-btn--primary seller-cc-btn--wide"
                    type="button"
                    onClick={handleOrderEmptyAction}
                  >
                    {orderEmptyActionLabel}
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
        {settingsModal}

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
                <span className="seller-cc-kpi-action">
                  <span>Review status</span>
                  <span className="seller-cc-kpi-action-arrow" aria-hidden="true">
                    →
                  </span>
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
                <span className="seller-cc-kpi-action">
                  <span>Open payouts</span>
                  <span className="seller-cc-kpi-action-arrow" aria-hidden="true">
                    →
                  </span>
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
                <span className="seller-cc-kpi-action">
                  <span>Manage listings</span>
                  <span className="seller-cc-kpi-action-arrow" aria-hidden="true">
                    →
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="seller-cc-kpi-card seller-cc-kpi-card--setup"
                onClick={() => onOpenDashboardModule("setup")}
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
                <span className="seller-cc-kpi-action">
                  <span>{nextChecklistItem ? "Continue setup" : "View checklist"}</span>
                  <span className="seller-cc-kpi-action-arrow" aria-hidden="true">
                    →
                  </span>
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
                <span className="seller-cc-kpi-action">
                  <span>Open disputes</span>
                  <span className="seller-cc-kpi-action-arrow" aria-hidden="true">
                    →
                  </span>
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

            <div className="seller-cc-offers" style={buildCardStyle("offers")}>
              <div className="seller-cc-offers-head">
                <div>
                  <span className="seller-cc-kicker">Bargain</span>
                  <h3>Open offers</h3>
                </div>
                <div className="seller-cc-offers-head-actions">
                  {topOfferAmount > 0 && (
                    <span className="seller-cc-offers-amount">
                      {formatCurrency(topOfferAmount, dashboardOffers[0]?.currency || "USD")}
                    </span>
                  )}
                  <button
                    className="seller-cc-chip-btn"
                    type="button"
                    onClick={() => onOpenDashboardModule("offers")}
                  >
                    View all
                  </button>
                </div>
              </div>
              {offerActionError && <p className="seller-cc-offers-feedback is-error">{offerActionError}</p>}
              {offerActionNotice && (
                <p className="seller-cc-offers-feedback is-success">{offerActionNotice}</p>
              )}
              {dashboardOffers.length === 0 ? (
                <div className="seller-cc-offers-empty">
                  <p>No open offers yet.</p>
                  <button
                    className="seller-cc-chip-btn"
                    type="button"
                    onClick={() => onOpenDashboardModule("offers")}
                  >
                    Check offer inbox
                  </button>
                </div>
              ) : (
                <div className="seller-cc-offers-list">
                  {dashboardOffers.map((offer) => {
                    const actionable = isOfferActionable(offer);
                    const loading = Boolean(offerActionLoading[offer.id]);
                    const draftValue =
                      offerCounterDrafts[offer.id] ??
                      (Number.isFinite(offer.offeredPrice) ? offer.offeredPrice.toFixed(2) : "");
                    const draftNote = offerCounterNotes[offer.id] ?? "";
                    return (
                      <article key={`dashboard-offer-${offer.id}`} className="seller-cc-offer-card">
                        <div className="seller-cc-offer-head">
                          <div className="seller-cc-offer-head-copy">
                            <strong>{offer.buyerName}</strong>
                            <span>
                              {formatCurrency(offer.offeredPrice, offer.currency)} · {offer.createdAt}
                            </span>
                          </div>
                          <span className={`seller-status-chip ${getStatusTone(offer.status)}`}>
                            {offer.status}
                          </span>
                        </div>
                        <p className="seller-cc-offer-subtitle">
                          {actionable ? "Waiting on your response" : "Waiting on buyer response"}
                        </p>
                        {offer.listingTitle ? (
                          <p className="seller-cc-offer-note">For {offer.listingTitle}</p>
                        ) : null}
                        {offer.note ? <p className="seller-cc-offer-note">{offer.note}</p> : null}
                        {actionable ? (
                          <>
                            <div className="seller-cc-offer-actions">
                              <button
                                className="btn primary small"
                                type="button"
                                disabled={loading}
                                onClick={() => onAcceptOffer(offer.id)}
                              >
                                {loading ? "Saving..." : "Accept"}
                              </button>
                              <button
                                className="btn danger small"
                                type="button"
                                disabled={loading}
                                onClick={() => onDeclineOffer(offer.id)}
                              >
                                Decline
                              </button>
                            </div>
                            <div className="seller-cc-offer-counter">
                              <input
                                type="number"
                                inputMode="decimal"
                                placeholder="45.00"
                                value={draftValue}
                                onChange={(event) => onOfferDraftChange(offer.id, event.target.value)}
                              />
                              <input
                                type="text"
                                placeholder="Optional note"
                                value={draftNote}
                                onChange={(event) => onOfferNoteChange(offer.id, event.target.value)}
                              />
                              <button
                                className="btn ghost small"
                                type="button"
                                disabled={loading}
                                onClick={() => onCounterOffer(offer.id)}
                              >
                                Counter
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="seller-cc-offer-actions">
                            <button
                              className="seller-cc-chip-btn"
                              type="button"
                              onClick={() => onOpenDashboardModule("offers")}
                            >
                              Review thread
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {uiConfig.showPerformanceSnapshot && (
            <button
              type="button"
              className="seller-cc-snapshot seller-cc-snapshot--action"
              style={buildCardStyle("totalEarnings")}
              onClick={() => onOpenDashboardModule("totalEarnings")}
              aria-label="Open performance snapshot details"
            >
              <div className="seller-cc-snapshot-head">
                <div className="seller-cc-snapshot-title">
                  <span>{uiConfig.performanceMonthlyLabel}</span>
                  <h3>{uiConfig.performanceTitle}</h3>
                </div>
                <span
                  className={`seller-cc-snapshot-trend seller-cc-snapshot-trend--${snapshotTrendTone}`}
                >
                  {snapshotTrendText}
                </span>
              </div>
              <div className="seller-cc-snapshot-revenue">
                <span>{uiConfig.performanceRevenueLabel}</span>
                <strong>{formatCurrency(totalEarningsValue, "USD")}</strong>
                <div className="seller-cc-snapshot-revenue-note">
                  <span className="seller-cc-snapshot-revenue-pill">{snapshotChart.latestLabel}</span>
                  <p>{snapshotTrendNote}</p>
                </div>
              </div>
              <div className="seller-cc-snapshot-panel">
                <div className="seller-cc-snapshot-panel-head">
                  <div>
                    <strong>Revenue Trend</strong>
                    <span>{snapshotRangeLabel}</span>
                  </div>
                  <div className="seller-cc-snapshot-callout">
                    <span>Current Period</span>
                    <strong>{formatCurrency(snapshotChart.latestValue, "USD")}</strong>
                  </div>
                </div>
                <div
                  className="seller-cc-snapshot-chart"
                  role="img"
                  aria-label={`Revenue trend from ${snapshotStartLabel} to ${snapshotChart.latestLabel}`}
                >
                  <div className="seller-cc-snapshot-y">
                    {snapshotChart.yTicks.map((value, index) => (
                      <span key={`snapshot-y-${index}`}>{formatCurrency(value, "USD")}</span>
                    ))}
                  </div>
                  <div className="seller-cc-snapshot-plot">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <defs>
                        <linearGradient id={snapshotStrokeId} x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#7ce9ff" />
                          <stop offset="55%" stopColor="#5ca4ff" />
                          <stop offset="100%" stopColor="#9f82ff" />
                        </linearGradient>
                        <filter id={snapshotGlowId} x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="2.2" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      <g className="seller-cc-snapshot-grid">
                        {snapshotGridLines.map((y, index) => (
                          <line key={`snapshot-grid-${index}`} x1="0" x2="100" y1={y} y2={y} />
                        ))}
                      </g>
                      {latestSnapshotPoint && (
                        <circle
                          className="seller-cc-snapshot-point-halo"
                          cx={latestSnapshotPoint.x}
                          cy={latestSnapshotPoint.y}
                          r="6.2"
                        />
                      )}
                      <path
                        d={snapshotChart.linePath}
                        className="seller-cc-snapshot-line-glow"
                        style={{ filter: `url(#${snapshotGlowId})` }}
                      />
                      <path
                        d={snapshotChart.linePath}
                        className="seller-cc-snapshot-line"
                        style={{ stroke: `url(#${snapshotStrokeId})` }}
                      />
                      {snapshotChart.points.map((point, index) => {
                        const isLatest = index === snapshotChart.points.length - 1;
                        return (
                          <circle
                            key={`snapshot-point-${index}`}
                            className={`seller-cc-snapshot-point${
                              isLatest ? " seller-cc-snapshot-point--active" : ""
                            }`}
                            cx={point.x}
                            cy={point.y}
                            r={isLatest ? "3.2" : "2.15"}
                          />
                        );
                      })}
                    </svg>
                    <div
                      className="seller-cc-snapshot-x"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(snapshotChart.xTicks.length, 1)}, minmax(0, 1fr))`,
                      }}
                    >
                      {snapshotChart.xTicks.map((label, index) => (
                        <span key={`snapshot-x-${index}`}>{label}</span>
                      ))}
                    </div>
                  </div>
                </div>
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
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
