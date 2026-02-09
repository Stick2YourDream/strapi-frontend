import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/storefront-payment-methods.css";
import Sidebar from "../components/Sidebar";
import api from "../api/strapi";
import { usePageMeta } from "../hooks/usePageMeta";
import { useUserPreferences } from "../context/UserPreferencesContext";

type PaymentMethodId = "paypal" | "venmo" | "cashapp";

type PaymentMethodOption = {
  id: PaymentMethodId;
  name: string;
  icon: string;
  helper: string;
  hint: string;
  inputLabel?: string;
  placeholder?: string;
  websiteUrl?: string;
  websiteLabel?: string;
};

const PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    id: "paypal",
    name: "PayPal",
    icon: "PP",
    helper: "Connect your PayPal business account for payouts.",
    hint: "We’ll redirect you to PayPal to connect and confirm your account.",
  },
  {
    id: "venmo",
    name: "Venmo",
    icon: "V",
    inputLabel: "Venmo handle",
    placeholder: "@yourhandle",
    helper: "Send payouts to your Venmo handle.",
    hint: "Use the handle shown on your Venmo profile.",
    websiteUrl: "https://venmo.com",
    websiteLabel: "Open Venmo",
  },
  {
    id: "cashapp",
    name: "Cash App",
    icon: "CA",
    inputLabel: "Cash App Cashtag",
    placeholder: "$yourname",
    helper: "Send payouts to your Cash App Cashtag.",
    hint: "Cashtags start with a $ symbol.",
    websiteUrl: "https://cash.app",
    websiteLabel: "Open Cash App",
  },
];

const normalizeHandle = (method: PaymentMethodId, value: string) => {
  const trimmed = value.trim();
  if (method === "paypal") return trimmed;
  if (!trimmed) return trimmed;
  if (method === "venmo" && !trimmed.startsWith("@")) {
    return `@${trimmed}`;
  }
  if (method === "cashapp" && !trimmed.startsWith("$")) {
    return `$${trimmed}`;
  }
  return trimmed;
};

const validateHandle = (method: PaymentMethodId, value: string) => {
  const trimmed = value.trim();
  if (method === "paypal") {
    return null;
  }
  if (!trimmed) {
    return "Please enter your handle.";
  }
  if (method === "venmo" && trimmed.replace("@", "").length < 2) {
    return "Enter a valid Venmo handle.";
  }
  if (method === "cashapp" && trimmed.replace("$", "").length < 2) {
    return "Enter a valid Cash App Cashtag.";
  }
  return null;
};

export default function StorefrontPaymentMethods(): JSX.Element {
  const { getBackgroundStyle } = useUserPreferences();
  const navigate = useNavigate();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodId>("paypal");
  const [details, setDetails] = useState<Record<PaymentMethodId, string>>({
    paypal: "",
    venmo: "",
    cashapp: "",
  });
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  usePageMeta({
    title: "Payment Methods | Your Social Place",
    description: "Choose how you want to receive StoreFront payouts.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const methodMap = useMemo(
    () =>
      PAYMENT_METHODS.reduce<Record<PaymentMethodId, PaymentMethodOption>>(
        (acc, method) => {
          acc[method.id] = method;
          return acc;
        },
        {} as Record<PaymentMethodId, PaymentMethodOption>
      ),
    []
  );

  const activeMethod = methodMap[selectedMethod];
  const activeValue = details[selectedMethod];

  useEffect(() => {
    let mounted = true;
    const loadVerification = async () => {
      setLoading(true);
      try {
        const res = await api.get("/marketplace-verifications/me");
        const entry = res.data?.data ?? null;
        const payoutProvider = String(entry?.payoutProvider || "").toLowerCase();
        const payoutEmail = String(entry?.payoutEmail || "");
        const merchantId = String(entry?.paypalMerchantIdInPayPal || "");
        const consentStatus = Boolean(entry?.paypalConsentStatus);
        const permissionsGranted = Boolean(entry?.paypalPermissionsGranted);
        const accountStatus = String(entry?.paypalAccountStatus || "");
        const returnMessage = String(entry?.paypalReturnMessage || "");
        if (!mounted) return;
        if (merchantId) {
          setPaypalMerchantId(merchantId);
          setPaypalStatus("connected");
          setSavedProvider("paypal");
        }
        if (accountStatus) setPaypalAccountStatus(accountStatus);
        if (returnMessage) setPaypalReturnMessage(returnMessage);
        if (payoutProvider) {
          setSavedProvider((prev) => prev || payoutProvider);
        }
        if (
          payoutProvider === "paypal" ||
          payoutProvider === "venmo" ||
          payoutProvider === "cashapp"
        ) {
          setSelectedMethod(payoutProvider);
          if (payoutEmail) {
            setDetails((prev) => ({ ...prev, [payoutProvider]: payoutEmail }));
          }
        } else if (payoutEmail) {
          setDetails((prev) => ({ ...prev, paypal: payoutEmail }));
        }
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

  useEffect(() => {
    if (saveState !== "saved") return;
    const timeout = window.setTimeout(() => {
      setSaveState("idle");
    }, 2200);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  const handleSaveManual = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedMethod === "paypal") return;
    const normalized = normalizeHandle(selectedMethod, activeValue);
    const validationError = validateHandle(selectedMethod, normalized);
    if (validationError) {
      setSaveError(validationError);
      setSaveState("error");
      return;
    }
    setSaveError(null);
    setSaveState("saving");
    try {
      await api.put("/marketplace-verifications/me", {
        data: {
          payoutProvider: selectedMethod,
          payoutEmail: normalized,
          sellerPayoutStatus: "pending",
        },
      });
      setDetails((prev) => ({ ...prev, [selectedMethod]: normalized }));
      setSavedProvider(selectedMethod);
      setSaveState("saved");
    } catch {
      setSaveState("error");
      setSaveError("Unable to save payment method. Please try again.");
    }
  };

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
    } catch {
      setPaypalStatus("error");
      setPaypalError("Unable to start PayPal onboarding.");
    }
  };

  const pageBackground = getBackgroundStyle("storefront") || getBackgroundStyle("dashboard");
  const paypalConnected = Boolean(paypalMerchantId);
  const savedLabel = paypalConnected
    ? "PayPal"
    : savedProvider && methodMap[savedProvider as PaymentMethodId]
      ? methodMap[savedProvider as PaymentMethodId].name
      : savedProvider;

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
                  Add a payout method so you can receive StoreFront earnings.
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
              <strong>3% platform fee</strong>
              <p>
                Sellers receive the listing price minus the 3% platform fee. Online
                payments are processed through the platform&apos;s PayPal business
                account.
              </p>
            </div>

            <div className="storefront-payment-grid">
              {PAYMENT_METHODS.map((method) => {
                const isActive = selectedMethod === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    className={`storefront-payment-card${isActive ? " is-active" : ""}`}
                    onClick={() => {
                      setSelectedMethod(method.id);
                      setSaveError(null);
                      setSaveState("idle");
                      setPaypalError(null);
                      setPaypalNotice(null);
                    }}
                  >
                    <span
                      className={`storefront-payment-icon ${method.id}`}
                      aria-hidden="true"
                    >
                      {method.icon}
                    </span>
                    <div>
                      <strong>{method.name}</strong>
                      <p className="storefront-payment-desc">{method.helper}</p>
                    </div>
                    {(method.id === "paypal" ? paypalConnected : savedProvider === method.id) && (
                      <span className="storefront-payment-tag">Saved</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="storefront-payment-details">
              <div className="storefront-payment-details-header">
                <div>
                  <h3>{activeMethod.name} details</h3>
                  <p>{activeMethod.hint}</p>
                </div>
                {savedLabel && (
                  <span className="storefront-payment-current">
                    Current: {savedLabel}
                  </span>
                )}
              </div>
              {selectedMethod === "paypal" ? (
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
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveManual}>
                  <label className="storefront-field">
                    <span>{activeMethod.inputLabel}</span>
                    <input
                      type="text"
                      value={activeValue}
                      onChange={(event) => {
                        setDetails((prev) => ({
                          ...prev,
                          [selectedMethod]: event.target.value,
                        }));
                        if (saveError) setSaveError(null);
                        if (saveState !== "idle") setSaveState("idle");
                      }}
                      placeholder={activeMethod.placeholder}
                    />
                  </label>
                  <p className="storefront-field-hint">{activeMethod.helper}</p>
                  {activeMethod.websiteUrl && activeMethod.websiteLabel && (
                    <a
                      className="storefront-payment-link"
                      href={activeMethod.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {activeMethod.websiteLabel}
                    </a>
                  )}
                  {saveError && <p className="storefront-form-error">{saveError}</p>}
                  <div className="storefront-payment-actions">
                    <button
                      className="btn primary"
                      type="submit"
                      disabled={saveState === "saving" || loading}
                    >
                      {saveState === "saving" ? "Saving..." : "Save payment method"}
                    </button>
                    {saveState === "saved" && (
                      <span className="storefront-payment-saved">Saved.</span>
                    )}
                    {loading && (
                      <span className="storefront-payment-loading">Syncing...</span>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
