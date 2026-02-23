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
        const res = await api.get("/marketplace-verifications/me");
        const entry = res.data?.data ?? null;
        const payoutProvider = String(entry?.payoutProvider || "").toLowerCase();
        const merchantId = String(entry?.paypalMerchantIdInPayPal || "");
        const consentStatus = Boolean(entry?.paypalConsentStatus);
        const permissionsGranted = Boolean(entry?.paypalPermissionsGranted);
        const accountStatus = String(entry?.paypalAccountStatus || "");
        const returnMessage = String(entry?.paypalReturnMessage || "");
        if (!mounted) return;

        if (payoutProvider) {
          setSavedProvider(payoutProvider);
        }

        if (merchantId) {
          setPaypalMerchantId(merchantId);
          setPaypalStatus("connected");
          setSavedProvider("paypal");
        }

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
        const entry = res.data?.data ?? null;
        const merchant = String(entry?.paypalMerchantIdInPayPal || merchantIdInPayPal || "");
        if (merchant) {
          setPaypalMerchantId(merchant);
          setPaypalStatus("connected");
          setSavedProvider("paypal");
          setPaypalNotice("PayPal connected successfully.");
        } else {
          setPaypalStatus("error");
          setPaypalNotice(null);
          setPaypalError("PayPal connection was not completed.");
        }
        const accountStatus = String(entry?.paypalAccountStatus || "");
        const returnMessage = String(entry?.paypalReturnMessage || "");
        if (accountStatus) setPaypalAccountStatus(accountStatus);
        if (returnMessage) setPaypalReturnMessage(returnMessage);
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
      setPaypalError(apiMessage || "Unable to start PayPal onboarding.");
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
                  Connect your PayPal account to receive payouts instantly.
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
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
