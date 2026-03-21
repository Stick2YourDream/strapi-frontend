import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Clock3, ShieldCheck, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "../css/storefront.css";
import api from "../api/strapi";
import PopupModal from "./PopupModal";
import { resolveStorefrontDisplayStatus } from "../utils/storefront-listing-state";

type CartItem = {
  id: number;
  listingId?: number | null;
  offerId?: number | null;
  listingTitle: string;
  listingStatus: string;
  purchaseState: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  status: string;
  paypalOrderId?: string;
  reservationExpiresAt?: string;
};

type StorefrontCartModalProps = {
  open: boolean;
  onClose: () => void;
  onCartCountChange?: (count: number) => void;
  onCartUpdated?: () => void | Promise<void>;
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

const formatCurrency = (value: number, currencyCode?: string) => {
  const normalized = String(currencyCode || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    }).format(value);
  } catch {
    return `${normalized} ${value.toFixed(2)}`;
  }
};

const getApiErrorMessage = (err: unknown, fallback: string) => {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string }; message?: string }
      | undefined;
    return data?.error?.message || data?.message || fallback;
  }
  return fallback;
};

export default function StorefrontCartModal({
  open,
  onClose,
  onCartCountChange,
  onCartUpdated,
}: StorefrontCartModalProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);

  const loadCart = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/marketplace-orders/cart");
      const mapped = (res.data?.data ?? []).map((entry: any) => {
        const attrs = normalize(entry);
        const listingData = attrs.listing?.data ?? attrs.listing;
        const listing = normalize(listingData);
        return {
          id: Number(entry?.id ?? attrs.id ?? 0),
          listingId: getEntityId(listingData),
          offerId: getEntityId(attrs.offer?.data ?? attrs.offer),
          listingTitle: String(listing.title || "Listing"),
          listingStatus: String(listing.status || "active"),
          purchaseState: String(listing.purchaseState || "available"),
          amount: Number(attrs.amount || 0),
          fee: Number(attrs.fee || 0),
          net: Number(attrs.net || 0),
          currency: String(attrs.currency || "USD").toUpperCase(),
          status: String(attrs.status || "cart").toLowerCase(),
          paypalOrderId: String(attrs.paypalOrderId || ""),
          reservationExpiresAt: attrs.reservationExpiresAt
            ? String(attrs.reservationExpiresAt)
            : undefined,
        } satisfies CartItem;
      });
      setItems(mapped);
      onCartCountChange?.(mapped.length);
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load your cart."));
      setItems([]);
      onCartCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onCartCountChange, open]);

  useEffect(() => {
    if (!open) return;
    void loadCart();
  }, [loadCart, open]);

  const notifyCartUpdated = useCallback(async () => {
    await onCartUpdated?.();
  }, [onCartUpdated]);

  const handleRemove = useCallback(
    async (item: CartItem) => {
      setActionId(item.id);
      setError(null);
      setStatus(null);
      try {
        await api.delete(`/marketplace-orders/cart/${item.id}`);
        setStatus(`Removed "${item.listingTitle}" from your cart.`);
        await loadCart();
        await notifyCartUpdated();
      } catch (err) {
        setError(getApiErrorMessage(err, "Unable to remove this cart item."));
      } finally {
        setActionId(null);
      }
    },
    [loadCart, notifyCartUpdated]
  );

  const handleCheckout = useCallback(
    async (item: CartItem) => {
      if (!item.listingId) {
        setError("Listing is not ready for checkout.");
        return;
      }
      setActionId(item.id);
      setError(null);
      setStatus(null);
      try {
        const res = await api.post("/marketplace-orders/paypal", {
          listingId: item.listingId,
          returnOrigin:
            typeof window !== "undefined" ? window.location.origin : undefined,
        });
        const approvalUrl = String(res.data?.approvalUrl || "").trim();
        if (!approvalUrl || typeof window === "undefined") {
          setError("PayPal approval link not available.");
          return;
        }
        window.open(approvalUrl, "_blank", "noopener,noreferrer");
        setStatus(`PayPal opened for "${item.listingTitle}".`);
        await loadCart();
        await notifyCartUpdated();
      } catch (err) {
        setError(getApiErrorMessage(err, "Unable to start checkout."));
      } finally {
        setActionId(null);
      }
    },
    [loadCart, notifyCartUpdated]
  );

  const handleOpenListing = useCallback(
    (item: CartItem) => {
      if (!item.listingId) return;
      onClose();
      navigate(`/storefront/listing/${item.listingId}`);
    },
    [navigate, onClose]
  );

  const cartSubtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.amount, 0),
    [items]
  );
  const cartFees = useMemo(() => items.reduce((sum, item) => sum + item.fee, 0), [items]);
  const cartSellerPayout = useMemo(
    () => items.reduce((sum, item) => sum + item.net, 0),
    [items]
  );

  return (
    <PopupModal
      open={open}
      title="Your cart"
      onClose={onClose}
      className="storefront-cart-modal"
      bodyClassName="storefront-cart-modal-body"
    >
      <div className="storefront-cart-modal-summary">
        <div className="storefront-cart-modal-summary-top">
          <div>
            <p className="storefront-panel-eyebrow">Reserved items</p>
            <h4>Checkout locks each item for one buyer at a time</h4>
            <p>
              Items in your cart stay reserved while you complete checkout or remove
              them.
            </p>
          </div>
          <div className="storefront-cart-modal-count" aria-hidden="true">
            <ShoppingCart size={22} />
            <strong>{items.length}</strong>
            <span>item{items.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="storefront-cart-modal-summary-metrics">
          <div className="storefront-cart-modal-metric">
            <span>Total reserved</span>
            <strong>{formatCurrency(cartSubtotal)}</strong>
          </div>
          <div className="storefront-cart-modal-metric">
            <span>Platform fees</span>
            <strong>{formatCurrency(cartFees)}</strong>
          </div>
          <div className="storefront-cart-modal-metric">
            <span>Seller payout</span>
            <strong>{formatCurrency(cartSellerPayout)}</strong>
          </div>
        </div>
      </div>

      {loading && <div className="storefront-status">Loading cart...</div>}
      {error && <div className="storefront-status error">{error}</div>}
      {status && <div className="storefront-status success">{status}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="storefront-cart-empty">
          <div className="storefront-cart-empty-icon" aria-hidden="true">
            <ShoppingCart size={28} />
          </div>
          <h4>Your cart is empty.</h4>
          <p>Add a listing to reserve it before checkout.</p>
        </div>
      )}

      <div className="storefront-cart-list">
        {items.map((item) => {
          const displayStatus = resolveStorefrontDisplayStatus({
            status: item.listingStatus,
            purchaseState: item.purchaseState,
          });
          const holdExpiry = item.reservationExpiresAt
            ? new Date(item.reservationExpiresAt)
            : null;
          const statusLabel =
            item.status === "pending"
              ? "Checkout in progress"
              : displayStatus === "pending"
              ? "Reserved"
              : displayStatus === "sold"
              ? "Sold"
              : "Available";
          return (
            <article key={item.id} className="storefront-cart-card">
              <div className="storefront-cart-body">
                <div className="storefront-cart-card-top">
                  <div>
                    <p className="storefront-panel-eyebrow">StoreFront item</p>
                    <h3>{item.listingTitle}</h3>
                  </div>
                  <div className="storefront-cart-status-stack">
                    <span className="storefront-cart-status-pill">{statusLabel}</span>
                    <strong>{formatCurrency(item.amount, item.currency)}</strong>
                  </div>
                </div>
                <div className="storefront-cart-meta">
                  <span>
                    <ShieldCheck size={14} aria-hidden="true" />
                    Reserved for you
                  </span>
                  {holdExpiry && item.status === "cart" && (
                    <span>
                      <Clock3 size={14} aria-hidden="true" />
                      Reserved until {holdExpiry.toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="storefront-fee-row">
                  <span>Seller receives</span>
                  <strong>{formatCurrency(item.net, item.currency)}</strong>
                </div>
                <div className="storefront-cart-actions">
                  {item.listingId && (
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => handleOpenListing(item)}
                    >
                      View listing
                    </button>
                  )}
                  <button
                    className="btn primary"
                    type="button"
                    disabled={actionId === item.id || displayStatus === "sold"}
                    onClick={() => void handleCheckout(item)}
                  >
                    {actionId === item.id
                      ? "Connecting..."
                      : item.status === "pending"
                      ? "Continue checkout"
                      : "Checkout with PayPal"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={actionId === item.id}
                    onClick={() => void handleRemove(item)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </PopupModal>
  );
}
