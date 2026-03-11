import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/storefront-payment-methods.css";
import Sidebar from "../components/Sidebar";
import api from "../api/strapi";
import { usePageMeta } from "../hooks/usePageMeta";
import { useUserPreferences } from "../context/UserPreferencesContext";

const PAYMENT_METHOD = {
  id: "paypal",
  name: "PayPal",
  icon: "PP",
  helper: "Connect your PayPal business account for payouts.",
  hint: "We'll redirect you to PayPal to connect and confirm your account.",
} as const;

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};

const getField = (entry: any, keys: string[]) => {
  for (const key of keys) {
    const value = entry?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const getText = (entry: any, keys: string[]) => String(getField(entry, keys) || "").trim();

const getFlag = (entry: any, keys: string[]) => {
  const value = getField(entry, keys);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return ["1", "true", "yes", "y"].includes(normalized);
};

const normalizePayPalMerchantId = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  const direct = upper.replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z0-9]{13}$/.test(direct)) return direct;
  const tokens = upper.match(/[A-Z0-9]{10,20}/g) || [];
  const exact = tokens.find((token) => token.length === 13);
  if (exact) return exact;
  return direct;
};

export default function StorefrontPaymentMethods(): JSX.Element {
  const { getBackgroundStyle } = useUserPreferences();
  const navigate = useNavigate();
  const [savedProvider, setSavedProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paypalMerchantId, setPaypalMerchantId] = useState("");
  const [paypalAccountStatus, setPaypalAccountStatus] = useState<string | null>(null);
  const [paypalReturnMessage, setPaypalReturnMessage] = useState<string | null>(null);
  const [paypalStatus, setPaypalStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >("idle");
  const [paypalNotice, setPaypalNotice] = useState<string | null>(null);
  const [paypalError, setPaypalError] = useState<string | null>(null);
  const [confirmingPaypal, setConfirmingPaypal] = useState(false);
  const [payoutEmailInput, setPayoutEmailInput] = useState("");
  const [merchantIdInput, setMerchantIdInput] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);
  const [payoutNotice, setPayoutNotice] = useState<string | null>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);

  usePageMeta({
    title: "Payment Methods | Your Social Place",
    description: "Connect your PayPal payout account for StoreFront earnings.",
    type: "website",
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    let mounted = true;
    const loadVerification = async () => {
      setLoading(true);
      try {
        const res = await api.get("/marketplace-verifications/me", {
          params: { _: Date.now() },
        });
        const entry = normalize(res.data?.data ?? null);
        const payoutProvider = getText(entry, ["payoutProvider", "payout_provider"]).toLowerCase();
        const merchantId = normalizePayPalMerchantId(
          getText(entry, ["paypalMerchantIdInPayPal", "paypal_merchant_id_in_pay_pal"])
        );
        const payoutEmail = getText(entry, ["payoutEmail", "payout_email"]);
        const consentStatus = getFlag(entry, ["paypalConsentStatus", "paypal_consent_status"]);
        const permissionsGranted = getFlag(entry, [
          "paypalPermissionsGranted",
          "paypal_permissions_granted",
        ]);
        const accountStatus = getText(entry, ["paypalAccountStatus", "paypal_account_status"]);
        const returnMessage = getText(entry, ["paypalReturnMessage", "paypal_return_message"]);
        if (!mounted) return;

        if (payoutProvider) {
          setSavedProvider(payoutProvider);
        }

        if (merchantId) {
          setPaypalMerchantId(merchantId);
          setMerchantIdInput(merchantId);
          setPaypalStatus("connected");
          setSavedProvider("paypal");
        }
        setPayoutEmailInput(payoutEmail);

        if (accountStatus) setPaypalAccountStatus(accountStatus);
        if (returnMessage) setPaypalReturnMessage(returnMessage);

        if (!merchantId && (consentStatus || permissionsGranted)) {
          setPaypalStatus("idle");
        }
      } catch {
        if (mounted) {
          setSavedProvider(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void loadVerification();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const merchantIdInPayPal = params.get("merchantIdInPayPal");
    const paypalReturn = params.get("paypal");
    if (!merchantIdInPayPal && paypalReturn !== "return") return;
    if (confirmingPaypal) return;

    const payload = {
      merchantId: params.get("merchantId") || undefined,
      merchantIdInPayPal: merchantIdInPayPal || undefined,
      permissionsGranted: params.get("permissionsGranted") || undefined,
      consentStatus: params.get("consentStatus") || undefined,
      accountStatus: params.get("accountStatus") || undefined,
      productIntentId: params.get("productIntentID") || undefined,
      isEmailConfirmed: params.get("isEmailConfirmed") || undefined,
      returnMessage: params.get("returnMessage") || undefined,
      riskStatus: params.get("riskStatus") || undefined,
      partnerReferralId: params.get("partnerReferralId") || undefined,
      trackingId: params.get("trackingId") || undefined,
    };

    setConfirmingPaypal(true);
    setPaypalError(null);
    setPaypalNotice("Confirming PayPal connection...");
    api
      .post("/marketplace-verifications/paypal/confirm", { data: payload })
      .then((res) => {
        const entry = normalize(res.data?.data ?? null);
        const merchant = normalizePayPalMerchantId(
          getText(entry, ["paypalMerchantIdInPayPal", "paypal_merchant_id_in_pay_pal"]) ||
            String(merchantIdInPayPal || "")
        );
        const payoutEmail = getText(entry, ["payoutEmail", "payout_email"]);
        if (merchant) {
          setPaypalMerchantId(merchant);
          setMerchantIdInput(merchant);
          setPaypalStatus("connected");
          setSavedProvider("paypal");
          setPaypalNotice("PayPal connected successfully.");
        } else {
          setPaypalStatus("error");
          setPaypalNotice(null);
          setPaypalError("PayPal connection was not completed.");
        }
        const accountStatus = getText(entry, ["paypalAccountStatus", "paypal_account_status"]);
        const returnMessage = getText(entry, ["paypalReturnMessage", "paypal_return_message"]);
        if (accountStatus) setPaypalAccountStatus(accountStatus);
        if (returnMessage) setPaypalReturnMessage(returnMessage);
        if (payoutEmail) setPayoutEmailInput(payoutEmail);
      })
      .catch(() => {
        setPaypalStatus("error");
        setPaypalNotice(null);
        setPaypalError("Unable to confirm PayPal connection.");
      })
      .finally(() => {
        setConfirmingPaypal(false);
        const nextParams = new URLSearchParams(window.location.search);
        [
          "paypal",
          "merchantId",
          "merchantIdInPayPal",
          "permissionsGranted",
          "consentStatus",
          "accountStatus",
          "productIntentID",
          "isEmailConfirmed",
          "returnMessage",
          "riskStatus",
          "partnerReferralId",
          "trackingId",
        ].forEach((key) => nextParams.delete(key));
        navigate(
          {
            pathname: window.location.pathname,
            search: nextParams.toString() ? `?${nextParams.toString()}` : "",
          },
          { replace: true }
        );
      });
  }, [confirmingPaypal, navigate]);

  const handleStartPaypalOnboarding = async () => {
    setPaypalError(null);
    setPaypalNotice("Redirecting to PayPal...");
    setPaypalStatus("connecting");
    try {
      const res = await api.post("/marketplace-verifications/paypal/onboard");
      const actionUrl = res.data?.data?.actionUrl || res.data?.actionUrl;
      if (actionUrl && typeof window !== "undefined") {
        window.location.assign(actionUrl);
        return;
      }
      setPaypalStatus("error");
      setPaypalError("PayPal onboarding link not available.");
    } catch (err) {
      setPaypalStatus("error");
      const apiMessage =
        (err as any)?.response?.data?.error?.message ||
        (err as any)?.response?.data?.message;
      const normalized = String(apiMessage || "").toLowerCase();
      if (normalized.includes("direct paypal onboarding is not configured")) {
        setPaypalError(
          "Direct PayPal connect is not enabled right now. Use 'Edit payout method' below to save your payout email."
        );
      } else {
        setPaypalError(apiMessage || "Unable to start PayPal onboarding.");
      }
    }
  };

  const handleSavePayoutMethod = async () => {
    if (savingPayout) return;
    const payoutEmail = payoutEmailInput.trim().toLowerCase();
    const merchantId = normalizePayPalMerchantId(merchantIdInput);
    if (!payoutEmail) {
      setPayoutError("Payout email is required.");
      return;
    }

    setPayoutError(null);
    setPayoutNotice(null);
    setSavingPayout(true);
    try {
      const res = await api.put("/marketplace-verifications/me", {
        data: {
          payoutProvider: "paypal",
          payoutEmail,
          paypalMerchantIdInPayPal: merchantId || null,
        },
      });
      const entry = normalize(res.data?.data ?? null);
      const savedPayoutEmail =
        getText(entry, ["payoutEmail", "payout_email"]) || payoutEmail;
      const savedMerchantId =
        normalizePayPalMerchantId(
          getText(entry, ["paypalMerchantIdInPayPal", "paypal_merchant_id_in_pay_pal"])
        ) || merchantId;

      setSavedProvider("paypal");
      setPayoutEmailInput(savedPayoutEmail);
      setPaypalMerchantId(savedMerchantId);
      setMerchantIdInput(savedMerchantId);
      setPaypalStatus(savedMerchantId ? "connected" : "idle");
      setPayoutNotice("Payout method saved.");
    } catch (err) {
      const apiMessage =
        (err as any)?.response?.data?.error?.message ||
        (err as any)?.response?.data?.message;
      setPayoutError(apiMessage || "Unable to save payout method.");
    } finally {
      setSavingPayout(false);
    }
  };

  const handleClearMerchantId = async () => {
    if (savingPayout) return;
    const payoutEmail = payoutEmailInput.trim().toLowerCase();
    if (!payoutEmail) {
      setPayoutError("Payout email is required.");
      return;
    }
    setPayoutError(null);
    setPayoutNotice(null);
    setSavingPayout(true);
    try {
      const res = await api.put("/marketplace-verifications/me", {
        data: {
          payoutProvider: "paypal",
          payoutEmail,
          paypalMerchantIdInPayPal: null,
        },
      });
      const entry = normalize(res.data?.data ?? null);
      setMerchantIdInput("");
      setPaypalMerchantId("");
      setPaypalStatus("idle");
      const savedPayoutEmail = getText(entry, ["payoutEmail", "payout_email"]);
      if (savedPayoutEmail) {
        setPayoutEmailInput(savedPayoutEmail);
      }
      setPayoutNotice("PayPal account unlinked. You can reconnect anytime.");
    } catch (err) {
      const apiMessage =
        (err as any)?.response?.data?.error?.message ||
        (err as any)?.response?.data?.message;
      setPayoutError(apiMessage || "Unable to unlink PayPal account.");
    } finally {
      setSavingPayout(false);
    }
  };

  const pageBackground = getBackgroundStyle("storefront") || getBackgroundStyle("dashboard");
  const paypalConnected = Boolean(paypalMerchantId);
  const savedLabel = paypalConnected
    ? "PayPal"
    : savedProvider
      ? savedProvider
      : null;

  return (
    <div className="dashboard-shell storefront-shell" style={pageBackground}>
      <Sidebar active="storefront" />
      <div className="main-content storefront-page">
        <section className="storefront-layout storefront-layout--payment">
          <div className="storefront-panel storefront-payment-panel">
            <div className="storefront-panel-header storefront-payment-header">
              <div>
                <p className="storefront-panel-eyebrow">Account settings</p>
                <h2>Payment methods</h2>
                <p className="storefront-payment-sub">
                  StoreFront checkout is PayPal-only. Connect PayPal to receive seller payouts.
                </p>
              </div>
              <button
                className="btn ghost small"
                type="button"
                onClick={() => navigate("/storefront/seller")}
              >
                Back to dashboard
              </button>
            </div>

            <div className="storefront-payment-banner">
              <strong>2% verified fee / 4% standard fee</strong>
              <p>
                Buyers pay through PayPal checkout. Verified sellers are charged a 2% platform fee;
                non-verified sellers are charged 4%.
              </p>
            </div>

            <div className="storefront-payment-grid">
              <div className="storefront-payment-card is-active">
                <span
                  className={`storefront-payment-icon ${PAYMENT_METHOD.id}`}
                  aria-hidden="true"
                >
                  {PAYMENT_METHOD.icon}
                </span>
                <div>
                  <strong>{PAYMENT_METHOD.name}</strong>
                  <p className="storefront-payment-desc">{PAYMENT_METHOD.helper}</p>
                </div>
                {paypalConnected && <span className="storefront-payment-tag">Saved</span>}
              </div>
            </div>

            <div className="storefront-payment-details">
              <div className="storefront-payment-details-header">
                <div>
                  <h3>PayPal details</h3>
                  <p>{PAYMENT_METHOD.hint}</p>
                </div>
                {savedLabel && (
                  <span className="storefront-payment-current">
                    Current: {savedLabel}
                  </span>
                )}
              </div>

              <div className="storefront-payment-paypal">
                <p className="storefront-payment-note">
                  Connect your PayPal account for live seller payouts, or set payout email for
                  platform-managed payouts.
                </p>
                {paypalMerchantId && (
                  <div className="storefront-payment-status">
                    <strong>Connected PayPal ID</strong>
                    <span>{paypalMerchantId}</span>
                  </div>
                )}
                {paypalAccountStatus && (
                  <p className="storefront-payment-note">
                    Account status: {paypalAccountStatus}
                  </p>
                )}
                {paypalReturnMessage && (
                  <p className="storefront-payment-note">{paypalReturnMessage}</p>
                )}
                {paypalNotice && (
                  <p className="storefront-payment-note is-info">{paypalNotice}</p>
                )}
                {paypalError && <p className="storefront-form-error">{paypalError}</p>}
                <div className="storefront-payment-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={handleStartPaypalOnboarding}
                    disabled={paypalStatus === "connecting" || confirmingPaypal}
                  >
                    {paypalStatus === "connecting"
                      ? "Redirecting..."
                      : paypalConnected
                        ? "Reconnect PayPal"
                        : "Connect PayPal"}
                  </button>
                  {confirmingPaypal && (
                    <span className="storefront-payment-loading">Confirming...</span>
                  )}
                  {loading && <span className="storefront-payment-loading">Syncing...</span>}
                </div>

                <div className="storefront-payment-manual">
                  <h4>Edit payout method</h4>
                  <p className="storefront-payment-note">
                    Sellers can change payout email at any time. Merchant ID is optional for
                    partner split payouts.
                  </p>
                  <div className="storefront-payment-manual-grid">
                    <label className="storefront-field">
                      Payout email
                      <input
                        type="email"
                        value={payoutEmailInput}
                        onChange={(event) => setPayoutEmailInput(event.target.value)}
                        placeholder="seller@paypal.com"
                        autoComplete="email"
                      />
                    </label>
                    <label className="storefront-field">
                      PayPal merchant ID (optional)
                      <input
                        type="text"
                        value={merchantIdInput}
                        onChange={(event) => setMerchantIdInput(event.target.value)}
                        placeholder="ABCD1234EFGH"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                  {payoutNotice && (
                    <p className="storefront-payment-note is-info">{payoutNotice}</p>
                  )}
                  {payoutError && <p className="storefront-form-error">{payoutError}</p>}
                  <div className="storefront-payment-actions">
                    <button
                      className="btn primary"
                      type="button"
                      disabled={savingPayout}
                      onClick={handleSavePayoutMethod}
                    >
                      {savingPayout ? "Saving..." : "Save payout method"}
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={savingPayout || !merchantIdInput.trim()}
                      onClick={handleClearMerchantId}
                    >
                      Unlink PayPal account
                    </button>
                  </div>
                </div>

                <div className="storefront-payment-tools">
                  <h4>Seller tools</h4>
                  <p className="storefront-payment-note">
                    Use these tools for transaction history, refund handling, and payout account management.
                  </p>
                  <div className="storefront-payment-tool-grid">
                    <div className="storefront-payment-tool-card">
                      <strong>Transaction dashboard</strong>
                      <p>Review buyer payments, order status, and payout progress from your seller dashboard.</p>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => navigate("/storefront/seller")}
                      >
                        Open seller dashboard
                      </button>
                    </div>
                    <div className="storefront-payment-tool-card">
                      <strong>Refund management</strong>
                      <p>Open recent orders and issue PayPal refunds when needed.</p>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => navigate("/storefront/seller")}
                      >
                        Open orders & refunds
                      </button>
                    </div>
                    <div className="storefront-payment-tool-card">
                      <strong>Unlink account</strong>
                      <p>Disconnect the current PayPal merchant link and switch payout settings.</p>
                      <button
                        className="btn ghost small"
                        type="button"
                        disabled={savingPayout || !merchantIdInput.trim()}
                        onClick={handleClearMerchantId}
                      >
                        Unlink PayPal
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
