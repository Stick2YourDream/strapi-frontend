import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/storefront-payment-methods.css";
import Sidebar from "../components/Sidebar";
import api from "../api/strapi";
import { usePageMeta } from "../hooks/usePageMeta";
import { useUserPreferences } from "../context/UserPreferencesContext";

const PAYMENT_METHOD = {
  name: "PayPal",
  helper: "Connect your PayPal business account for payouts.",
  hint: "We'll redirect you to PayPal to connect and confirm your account.",
} as const;

const PAYPAL_DISCONNECT_DISCLAIMER =
  "Disconnecting your PayPal account will prevent you from offering PayPal services and products on your website. Do you wish to continue?";

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

const isAttentionMessage = (value: string | null) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("attention:");

const isTechnicalStatusMessage = (value: string | null) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || isAttentionMessage(value)) return false;
  return (
    normalized.includes("authorization_error") ||
    normalized.includes("not authorized") ||
    normalized.includes("merchant integration") ||
    normalized.includes("debug_id")
  );
};

const isPendingValidationMessage = (value: string | null) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .includes("account status validation");

const isPaymentsReceivableAttention = (value: string | null) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .includes("cannot receive payments due to restriction");

const isPrimaryEmailAttention = (value: string | null) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .includes("confirm your email address");

const PAYPAL_MESSAGE_URL_PATTERN =
  /https:\/\/www\.paypal\.com(?:\/businessprofile\/settings)?/g;

const renderLinkedPayPalMessage = (message: string | null) => {
  const source = String(message || "");
  if (!source) return null;

  const matches = Array.from(source.matchAll(PAYPAL_MESSAGE_URL_PATTERN));
  if (!matches.length) return source;

  const segments: Array<string | JSX.Element> = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push(source.slice(cursor, start));
    }
    segments.push(
      <a
        key={`${url}-${index}`}
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        {url.replace(/^https?:\/\//, "")}
      </a>
    );
    cursor = start + url.length;
  });

  if (cursor < source.length) {
    segments.push(source.slice(cursor));
  }

  return segments;
};

const PayPalWordmark = () => (
  <svg
    className="storefront-payment-wordmark"
    viewBox="0 0 122 32"
    role="img"
    aria-label="PayPal"
  >
    <rect x="0" y="0" width="122" height="32" rx="10" fill="#ffffff" />
    <path
      d="M18.4 6.5h7.3c4 0 6.3 2 6.3 5.2 0 3.8-2.8 6.3-7.2 6.3h-2.5l-1 6H17l3.6-17.5Zm5.9 8.1c2.2 0 3.5-1 3.5-2.6 0-1.3-.9-2-2.8-2h-2.6l-1 4.6h3Z"
      fill="#003087"
    />
    <path
      d="M24.6 8.8h5.9c3.5 0 5.5 1.7 5.5 4.5 0 3.5-2.6 5.8-6.5 5.8h-2.2l-.9 4.9h-3.7l2.9-15.2Zm4.8 7c2 0 3.1-.9 3.1-2.3 0-1.1-.8-1.7-2.5-1.7h-2l-.8 4h2.2Z"
      fill="#009cde"
      opacity="0.9"
    />
    <text
      x="42"
      y="21.5"
      fontFamily="Arial, Helvetica, sans-serif"
      fontSize="17"
      fontWeight="700"
      letterSpacing="-0.2"
    >
      <tspan fill="#003087">Pay</tspan>
      <tspan fill="#009cde">Pal</tspan>
    </text>
  </svg>
);

export default function StorefrontPaymentMethods(): JSX.Element {
  const { getBackgroundStyle } = useUserPreferences();
  const navigate = useNavigate();
  const [savedProvider, setSavedProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paypalMerchantId, setPaypalMerchantId] = useState("");
  const [paypalDirectConnected, setPaypalDirectConnected] = useState(false);
  const [paypalConsentStatus, setPaypalConsentStatus] = useState(false);
  const [paypalPermissionsGranted, setPaypalPermissionsGranted] = useState(false);
  const [paypalEmailConfirmed, setPaypalEmailConfirmed] = useState(false);
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
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  const handleOpenStorefrontMessages = useCallback(() => {
    navigate("/storefront/seller?messages=1");
  }, [navigate]);

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
        const emailConfirmed = getFlag(entry, ["paypalEmailConfirmed", "paypal_email_confirmed"]);
        const accountStatus = getText(entry, ["paypalAccountStatus", "paypal_account_status"]);
        const returnMessage = getText(entry, ["paypalReturnMessage", "paypal_return_message"]);
        const directConnected =
          Boolean(merchantId) && consentStatus && permissionsGranted && emailConfirmed;
        if (!mounted) return;

        if (payoutProvider) {
          setSavedProvider(payoutProvider);
        }

        if (merchantId) {
          setPaypalMerchantId(merchantId);
          setMerchantIdInput(merchantId);
          setPaypalConsentStatus(consentStatus);
          setPaypalPermissionsGranted(permissionsGranted);
          setPaypalEmailConfirmed(emailConfirmed);
          setPaypalDirectConnected(directConnected);
          setPaypalStatus(directConnected ? "connected" : returnMessage ? "error" : "idle");
          setSavedProvider("paypal");
        } else {
          setPaypalMerchantId("");
          setMerchantIdInput("");
          setPaypalConsentStatus(false);
          setPaypalPermissionsGranted(false);
          setPaypalEmailConfirmed(false);
          setPaypalDirectConnected(false);
          setPaypalAccountStatus(null);
          setPaypalReturnMessage(null);
          setPaypalStatus("idle");
        }
        setPayoutEmailInput(payoutEmail);

        setPaypalAccountStatus(merchantId ? accountStatus || null : null);
        setPaypalReturnMessage(merchantId ? returnMessage || null : null);

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
        const consentStatus = getFlag(entry, ["paypalConsentStatus", "paypal_consent_status"]);
        const permissionsGranted = getFlag(entry, [
          "paypalPermissionsGranted",
          "paypal_permissions_granted",
        ]);
        const emailConfirmed = getFlag(entry, ["paypalEmailConfirmed", "paypal_email_confirmed"]);
        const directConnected =
          Boolean(merchant) && consentStatus && permissionsGranted && emailConfirmed;
        const payoutEmail = getText(entry, ["payoutEmail", "payout_email"]);
        const accountStatus = getText(entry, ["paypalAccountStatus", "paypal_account_status"]);
        const returnMessage = getText(entry, ["paypalReturnMessage", "paypal_return_message"]);
        if (merchant) {
          setPaypalMerchantId(merchant);
          setMerchantIdInput(merchant);
          setPaypalConsentStatus(consentStatus);
          setPaypalPermissionsGranted(permissionsGranted);
          setPaypalEmailConfirmed(emailConfirmed);
          setPaypalDirectConnected(directConnected);
          setPaypalStatus(directConnected ? "connected" : "error");
          setSavedProvider("paypal");
          setPaypalNotice(
            directConnected
              ? "PayPal connected successfully."
              : returnMessage
                ? null
                : "PayPal merchant ID saved, but partner permissions are still pending."
          );
        } else {
          setPaypalDirectConnected(false);
          setPaypalStatus("error");
          setPaypalNotice(null);
          setPaypalError("PayPal connection was not completed.");
        }
        setPaypalAccountStatus(accountStatus || null);
        setPaypalReturnMessage(returnMessage || null);
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
      const consentStatus = getFlag(entry, ["paypalConsentStatus", "paypal_consent_status"]);
      const permissionsGranted = getFlag(entry, [
        "paypalPermissionsGranted",
        "paypal_permissions_granted",
      ]);
      const emailConfirmed = getFlag(entry, ["paypalEmailConfirmed", "paypal_email_confirmed"]);
      const directConnected =
        Boolean(savedMerchantId) && consentStatus && permissionsGranted && emailConfirmed;

      setSavedProvider("paypal");
      setPayoutEmailInput(savedPayoutEmail);
      setPaypalMerchantId(savedMerchantId);
      setMerchantIdInput(savedMerchantId);
      setPaypalConsentStatus(consentStatus);
      setPaypalPermissionsGranted(permissionsGranted);
      setPaypalEmailConfirmed(emailConfirmed);
      setPaypalDirectConnected(directConnected);
      setPaypalStatus(directConnected ? "connected" : "idle");
      setPayoutNotice(
        savedMerchantId && !directConnected
          ? "Payout method saved. Complete PayPal Connect to enable split payouts."
          : "Payout method saved."
      );
    } catch (err) {
      const apiMessage =
        (err as any)?.response?.data?.error?.message ||
        (err as any)?.response?.data?.message;
      setPayoutError(apiMessage || "Unable to save payout method.");
    } finally {
      setSavingPayout(false);
    }
  };

  const handleRequestClearMerchantId = () => {
    if (savingPayout || !merchantIdInput.trim()) return;
    setPayoutError(null);
    setPayoutNotice(null);
    setDisconnectConfirmOpen(true);
  };

  const handleClearMerchantId = async () => {
    if (savingPayout) return;
    setPayoutError(null);
    setPayoutNotice(null);
    setSavingPayout(true);
    try {
      await api.put("/marketplace-verifications/me", {
        data: {
          payoutProvider: "paypal",
          payoutEmail: null,
          paypalMerchantIdInPayPal: null,
        },
      });
      setPayoutEmailInput("");
      setMerchantIdInput("");
      setPaypalMerchantId("");
      setPaypalConsentStatus(false);
      setPaypalPermissionsGranted(false);
      setPaypalEmailConfirmed(false);
      setPaypalDirectConnected(false);
      setPaypalStatus("idle");
      setDisconnectConfirmOpen(false);
      setPaypalAccountStatus(null);
      setPaypalReturnMessage(null);
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
  const paypalConnected = paypalDirectConnected;
  const paypalSaved = Boolean(paypalMerchantId || savedProvider === "paypal");
  const paypalTechnicalStatusBlocked =
    paypalConnected && isTechnicalStatusMessage(paypalReturnMessage);
  const visiblePaypalReturnMessage =
    !paypalMerchantId || paypalTechnicalStatusBlocked ? null : paypalReturnMessage;
  const canUnlinkPaypal = Boolean(merchantIdInput.trim());
  const showManualPayoutEditor = !paypalConnected;
  const paypalValidationPending =
    Boolean(paypalMerchantId) &&
    !paypalConnected &&
    isPendingValidationMessage(visiblePaypalReturnMessage);
  const paymentsReceivableAttention = isPaymentsReceivableAttention(visiblePaypalReturnMessage);
  const primaryEmailAttention = isPrimaryEmailAttention(visiblePaypalReturnMessage);
  const paypalNeedsAttention =
    (Boolean(visiblePaypalReturnMessage) && !paypalValidationPending) ||
    (Boolean(paypalMerchantId) &&
      (!paypalConsentStatus || !paypalPermissionsGranted || !paypalEmailConfirmed));
  const savedLabel = paypalConnected
    ? "PayPal"
    : savedProvider
      ? savedProvider
      : null;

  return (
    <div className="dashboard-shell storefront-shell" style={pageBackground}>
      <Sidebar
        active="storefront"
        onMobileMessagesOpen={handleOpenStorefrontMessages}
        mobileMessagesFallbackText="Storefront buyer messages"
        mobileMessagesEmptyTitle="No new storefront messages"
        mobileMessagesEmptySubtitle="Open storefront inbox"
      />
      <div className="main-content storefront-page storefront-payment-methods-page">
        <section className="storefront-layout storefront-layout--payment storefront-payment-methods-layout">
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
              <button
                className="storefront-payment-card storefront-payment-card-button is-active"
                type="button"
                onClick={handleStartPaypalOnboarding}
                disabled={paypalStatus === "connecting" || confirmingPaypal}
                aria-label={
                  paypalConnected ? "Reconnect PayPal" : "Connect PayPal"
                }
              >
                <span className="storefront-payment-icon paypal" aria-hidden="true">
                  <PayPalWordmark />
                </span>
                <div>
                  <strong>{PAYMENT_METHOD.name}</strong>
                  <p className="storefront-payment-desc">{PAYMENT_METHOD.helper}</p>
                </div>
                {paypalConnected ? (
                  <span className="storefront-payment-tag">Connected</span>
                ) : paypalValidationPending ? (
                  <span className="storefront-payment-tag is-pending">Pending validation</span>
                ) : paypalNeedsAttention ? (
                  <span className="storefront-payment-tag is-warning">Needs attention</span>
                ) : paypalSaved ? (
                  <span className="storefront-payment-tag">Saved</span>
                ) : null}
              </button>
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
                <div className="storefront-payment-health-grid">
                  <div
                    className={`storefront-payment-health-card${
                      paypalPermissionsGranted
                        ? " is-ready"
                        : paymentsReceivableAttention
                          ? " is-warning"
                          : paypalValidationPending
                            ? " is-pending"
                            : paypalMerchantId
                              ? " is-warning"
                              : ""
                    }`}
                  >
                    <span>Payments receivable</span>
                    <strong>
                      {paypalPermissionsGranted
                        ? "Ready"
                        : paymentsReceivableAttention
                          ? "Needs attention"
                          : paypalValidationPending
                            ? "Pending validation"
                            : paypalMerchantId
                              ? "Needs attention"
                              : "Not checked"}
                    </strong>
                  </div>
                  <div
                    className={`storefront-payment-health-card${
                      paypalEmailConfirmed
                        ? " is-ready"
                        : primaryEmailAttention
                          ? " is-warning"
                          : paypalValidationPending
                            ? " is-pending"
                            : paypalMerchantId
                              ? " is-warning"
                              : ""
                    }`}
                  >
                    <span>Primary email confirmed</span>
                    <strong>
                      {paypalEmailConfirmed
                        ? "Confirmed"
                        : primaryEmailAttention
                          ? "Needs confirmation"
                          : paypalValidationPending
                            ? "Pending validation"
                            : paypalMerchantId
                              ? "Needs confirmation"
                              : "Not checked"}
                    </strong>
                  </div>
                </div>
                {paypalMerchantId && (
                  <div className="storefront-payment-status">
                    <strong>
                      {paypalConnected
                        ? "Connected PayPal ID"
                        : "Saved PayPal merchant ID"}
                    </strong>
                    <span>{paypalMerchantId}</span>
                  </div>
                )}
                {paypalMerchantId && !paypalConnected && (
                  <p className="storefront-payment-note">
                    Partner split payouts are not active for this merchant ID yet. Complete
                    PayPal Connect to send checkout funds directly to this PayPal account.
                  </p>
                )}
                {paypalAccountStatus && (
                  <p className="storefront-payment-note">
                    Account status: {paypalAccountStatus}
                  </p>
                )}
                {visiblePaypalReturnMessage && (
                  <div
                    className={`storefront-payment-alert ${
                      isAttentionMessage(visiblePaypalReturnMessage) ? "is-warning" : "is-info"
                    }`}
                    role={isAttentionMessage(visiblePaypalReturnMessage) ? "alert" : "status"}
                  >
                    <strong>
                      {isAttentionMessage(visiblePaypalReturnMessage)
                        ? "Action required"
                        : "PayPal status"}
                    </strong>
                    <p>{renderLinkedPayPalMessage(visiblePaypalReturnMessage)}</p>
                  </div>
                )}
                {paypalTechnicalStatusBlocked && (
                  <div className="storefront-payment-alert is-info" role="status">
                    <strong>PayPal connected</strong>
                    <p>
                      PayPal connected successfully. Additional merchant-status verification
                      from PayPal is unavailable for this app right now.
                    </p>
                  </div>
                )}
                {paypalNotice && (
                  <div className="storefront-payment-alert is-info" role="status">
                    <strong>{paypalConnected ? "PayPal connected" : "PayPal update"}</strong>
                    <p>{paypalNotice}</p>
                  </div>
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
                  {canUnlinkPaypal && (
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={savingPayout}
                      onClick={handleRequestClearMerchantId}
                    >
                      Unlink PayPal account
                    </button>
                  )}
                  {confirmingPaypal && (
                    <span className="storefront-payment-loading">Confirming...</span>
                  )}
                  {loading && <span className="storefront-payment-loading">Syncing...</span>}
                </div>
                {disconnectConfirmOpen && (
                  <div className="storefront-payment-alert is-danger" role="alert">
                    <strong>Disconnect PayPal</strong>
                    <p>{PAYPAL_DISCONNECT_DISCLAIMER}</p>
                    <div className="storefront-payment-actions">
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setDisconnectConfirmOpen(false)}
                      >
                        Keep PayPal connected
                      </button>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={savingPayout}
                        onClick={handleClearMerchantId}
                      >
                        {savingPayout ? "Disconnecting..." : "Disconnect PayPal"}
                      </button>
                    </div>
                  </div>
                )}

                {showManualPayoutEditor && (
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
                    </div>
                  </div>
                )}

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
                        className="btn ghost small storefront-payment-tool-button"
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
                        className="btn ghost small storefront-payment-tool-button"
                        type="button"
                        onClick={() => navigate("/storefront/seller?dashboard=orders")}
                      >
                        Open orders & refunds
                      </button>
                    </div>
                    <div className="storefront-payment-tool-card">
                      <strong>Unlink account</strong>
                      <p>Disconnect the current PayPal merchant link and switch payout settings.</p>
                        <button
                          className="btn ghost small storefront-payment-tool-button"
                          type="button"
                          disabled={savingPayout || !merchantIdInput.trim()}
                          onClick={handleRequestClearMerchantId}
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
