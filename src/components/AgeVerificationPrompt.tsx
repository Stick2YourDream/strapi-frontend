import { QRCodeCanvas } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { AGE_VERIFY_API_BASE, AGE_VERIFY_PUBLIC_URL } from "../utils/age-verify";
import "../css/age-verification.css";

const PROMPT_KEY_PREFIX = "age-verification:prompt";
const AUTO_OPEN_PARAM = "ageVerify";
const AGE_VERIFY_CLIENT_KEY = String(import.meta.env.VITE_AGE_VERIFY_CLIENT_KEY || "").trim();
const AGE_VERIFY_LOG_LABEL = "%c[age-verify]";
const AGE_VERIFY_LOG_STYLE = "color:#3ea8ff;font-weight:700;";

const ageVerifyError = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.error(AGE_VERIFY_LOG_LABEL, AGE_VERIFY_LOG_STYLE, ...args);
};

const ageVerifyHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (AGE_VERIFY_CLIENT_KEY) {
    headers["x-verify-api-key"] = AGE_VERIFY_CLIENT_KEY;
  }
  return headers;
};

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const getDaysRemaining = (dueAt?: string | null) => {
  if (!dueAt) return null;
  const dueMs = new Date(dueAt).getTime();
  if (!Number.isFinite(dueMs)) return null;
  return Math.max(0, Math.ceil((dueMs - Date.now()) / 86400000));
};

export default function AgeVerificationPrompt() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const needsVerification = Boolean(user && user.ageVerified !== true);
  const dueAt = user?.ageVerificationDueAt ?? null;
  const daysRemaining =
    user?.ageVerificationDaysRemaining ?? getDaysRemaining(dueAt);
  const overdue =
    user?.ageVerificationOverdue ??
    (dueAt ? new Date(dueAt).getTime() < Date.now() : false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [ageModalOpen, setAgeModalOpen] = useState(false);
  const [ageSessionId, setAgeSessionId] = useState<string | null>(null);
  const [ageQrUrl, setAgeQrUrl] = useState<string | null>(null);
  const [ageMobileUrl, setAgeMobileUrl] = useState<string | null>(null);
  const [ageSessionStatus, setAgeSessionStatus] = useState<string>("idle");
  const [ageSessionError, setAgeSessionError] = useState<string | null>(null);
  const [ageSessionErrorDetail, setAgeSessionErrorDetail] = useState<Record<string, unknown> | null>(
    null
  );
  const [ageSessionLoading, setAgeSessionLoading] = useState(false);
  const [ageToken, setAgeToken] = useState<string | null>(null);
  const [ageVerifyApplied, setAgeVerifyApplied] = useState(false);

  const promptKey = useMemo(() => {
    if (!user?.id) return null;
    return `${PROMPT_KEY_PREFIX}:${user.id}`;
  }, [user?.id]);

  useEffect(() => {
    if (!needsVerification || !promptKey || typeof window === "undefined") {
      setPromptOpen(false);
      return;
    }
    const last = window.localStorage.getItem(promptKey);
    const today = getTodayKey();
    if (last !== today) {
      setPromptOpen(true);
    }
  }, [needsVerification, promptKey]);

  useEffect(() => {
    if (!needsVerification) return;
    const params = new URLSearchParams(location.search);
    if (params.get(AUTO_OPEN_PARAM) !== "1") return;
    setPromptOpen(false);
    setAgeModalOpen(true);
    if (!ageSessionId && !ageSessionLoading) {
      void createAgeSession();
    }
    params.delete(AUTO_OPEN_PARAM);
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : "",
      },
      { replace: true }
    );
  }, [ageSessionId, ageSessionLoading, location.pathname, location.search, needsVerification, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tokenFromUrl = params.get("ageVerificationToken");
    if (!tokenFromUrl) return;
    setAgeToken(tokenFromUrl);
    setAgeSessionStatus("verified");
    params.delete("ageVerificationToken");
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : "",
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const markPromptSeen = () => {
    if (!promptKey || typeof window === "undefined") return;
    window.localStorage.setItem(promptKey, getTodayKey());
  };

  const handleLater = () => {
    markPromptSeen();
    setPromptOpen(false);
  };

  const handleVerifyNow = () => {
    markPromptSeen();
    setPromptOpen(false);
    setAgeModalOpen(true);
    if (!ageSessionId && !ageSessionLoading) {
      void createAgeSession();
    }
  };

  const createAgeSession = async () => {
    setAgeSessionError(null);
    setAgeSessionErrorDetail(null);
    setAgeSessionLoading(true);
    try {
      const returnUrl = `${window.location.origin}${location.pathname}`;
      const url = `${AGE_VERIFY_API_BASE}/session`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ageVerifyHeaders() },
        body: JSON.stringify({
          returnUrl,
          publicBaseUrl: AGE_VERIFY_PUBLIC_URL || undefined,
          userId: user?.id ? String(user.id) : undefined,
        }),
      });
      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
          ? await res.json()
          : await res.text();
        const message =
          (payload as any)?.error ||
          (payload as any)?.message ||
          (typeof payload === "string" && payload.trim()) ||
          "Unable to start age verification.";
        setAgeSessionErrorDetail({
          url,
          status: res.status,
          statusText: res.statusText,
          requestId: (payload as any)?.requestId || res.headers.get("x-request-id"),
          payload,
        });
        throw new Error(message);
      }
      const data = await res.json();
      const sessionId = data?.data?.sessionId || null;
      const serverQrUrl = data?.data?.qrUrl || null;
      const serverMobileUrl = data?.data?.mobileUrl || null;
      const computedMobile =
        AGE_VERIFY_PUBLIC_URL && sessionId
          ? `${AGE_VERIFY_PUBLIC_URL}/session/${sessionId}?mode=mobile`
          : null;
      const nextMobileUrl = computedMobile || serverMobileUrl;
      setAgeSessionId(sessionId);
      setAgeMobileUrl(nextMobileUrl);
      setAgeQrUrl(computedMobile || serverQrUrl || nextMobileUrl);
      setAgeSessionStatus("pending");
    } catch (err: any) {
      setAgeSessionError(err?.message || "Unable to start age verification.");
      ageVerifyError("create session failed", err);
    } finally {
      setAgeSessionLoading(false);
    }
  };

  useEffect(() => {
    if (!ageSessionId || ageToken || !ageModalOpen) return;
    let active = true;
    const poll = async () => {
      try {
        const url = `${AGE_VERIFY_API_BASE}/session/${ageSessionId}`;
        const res = await fetch(url, { headers: ageVerifyHeaders() });
        if (!res.ok) {
          const contentType = res.headers.get("content-type") || "";
          const payload = contentType.includes("application/json")
            ? await res.json()
            : await res.text();
          setAgeSessionErrorDetail({
            url,
            status: res.status,
            statusText: res.statusText,
            requestId: (payload as any)?.requestId || res.headers.get("x-request-id"),
            payload,
          });
          throw new Error(
            (payload as any)?.error ||
              (payload as any)?.message ||
              (typeof payload === "string" && payload.trim()) ||
              "Unable to check status."
          );
        }
        const data = await res.json();
        if (!active) return;
        const status = data?.data?.status || "pending";
        setAgeSessionStatus(status);
        if (status === "verified" && data?.data?.token) {
          setAgeToken(data.data.token);
          setAgeSessionStatus("verified");
        }
        if (status === "failed" || status === "denied") {
          setAgeSessionError(data?.data?.reason || "Verification failed.");
        }
      } catch (err: any) {
        if (active) {
          setAgeSessionError(err?.message || "Unable to check status.");
          ageVerifyError("status poll failed", err);
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ageModalOpen, ageSessionId, ageToken]);

  useEffect(() => {
    if (!ageToken || ageVerifyApplied) return;
    let active = true;
    const applyToken = async () => {
      try {
        const res = await api.post("/auth/age/verify", { token: ageToken });
        if (!active) return;
        setAgeVerifyApplied(true);
        if (user) {
          updateUser({
            ...user,
            ageVerified: true,
            ageVerifiedAt: res.data?.verifiedAt || new Date().toISOString(),
            ageVerificationRequired: false,
            ageVerificationOverdue: false,
            ageVerificationDaysRemaining: null,
          });
        }
        setAgeModalOpen(false);
        setPromptOpen(false);
      } catch (err: any) {
        const message =
          err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err?.message ||
          "Unable to apply age verification.";
        if (active) setAgeSessionError(message);
        if (active) {
          setAgeSessionErrorDetail({
            url: "/auth/age/verify",
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            requestId: err?.response?.data?.requestId,
            payload: err?.response?.data,
          });
        }
        ageVerifyError("apply token failed", err);
      }
    };
    void applyToken();
    return () => {
      active = false;
    };
  }, [ageModalOpen, ageToken, ageVerifyApplied, updateUser]);

  if (!needsVerification) {
    return null;
  }

  return (
    <>
      {promptOpen && (
        <div className="age-prompt-overlay" role="dialog" aria-modal="true">
          <div className="age-prompt-modal">
            <div className="age-prompt-header">
              <h3>Age verification required</h3>
            </div>
            <div className="age-prompt-body">
              <p>
                Please verify your age to keep your account active.
                {daysRemaining !== null && !overdue && (
                  <>
                    {" "}
                    You have {daysRemaining} day{daysRemaining === 1 ? "" : "s"} left.
                  </>
                )}
              </p>
              {dueAt && !overdue && (
                <p className="age-prompt-muted">Due by {new Date(dueAt).toLocaleDateString()}.</p>
              )}
              {overdue && (
                <p className="age-prompt-warning">
                  Your account will be locked until you verify.
                </p>
              )}
              <p className="age-prompt-muted">
                Find this under Profile → Settings → Account &amp; Security.
              </p>
            </div>
            <div className="age-prompt-actions">
              <button className="btn ghost" type="button" onClick={handleLater}>
                Later
              </button>
              <button className="btn primary" type="button" onClick={handleVerifyNow}>
                Verify now
              </button>
            </div>
          </div>
        </div>
      )}

      {ageModalOpen && (
        <div className="age-verify-overlay" role="dialog" aria-modal="true">
          <div className="age-verify-modal">
            <div className="age-verify-header">
              <div>
                <h3>Verify your age</h3>
                <p className="muted">Live ID scan + liveness selfie required.</p>
              </div>
              <button
                type="button"
                className="age-verify-close"
                onClick={() => setAgeModalOpen(false)}
              >
                X
              </button>
            </div>
            <div className="age-verify-body">
              <div className="age-verify-card">
                <div className="age-verify-info">
                  <p className="age-verify-copy">
                    Scan the QR code with your phone to take live photos. File uploads are
                    blocked.
                  </p>
                  <div
                    className={`age-verify-status ${
                      ageToken
                        ? "verified"
                        : ageSessionStatus === "failed" || ageSessionStatus === "denied"
                        ? "failed"
                        : ageSessionStatus !== "idle"
                        ? "pending"
                        : ""
                    }`}
                  >
                    {ageToken
                      ? "Verified"
                      : ageSessionStatus === "processing"
                      ? "Processing…"
                      : ageSessionStatus === "pending"
                      ? "Pending"
                      : ageSessionStatus === "failed"
                      ? "Failed"
                      : ageSessionStatus === "denied"
                      ? "Denied"
                      : "Not started"}
                  </div>
                  <div className="age-verify-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => createAgeSession()}
                      disabled={ageSessionLoading}
                    >
                      {ageSessionLoading ? "Starting…" : ageToken ? "Re-verify" : "Start verification"}
                    </button>
                    {ageMobileUrl && (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(ageMobileUrl);
                        }}
                      >
                        Copy link
                      </button>
                    )}
                  </div>
                  {ageMobileUrl && (
                    <div className="age-verify-link">
                      <span>Mobile link</span>
                      <a href={ageMobileUrl} target="_blank" rel="noreferrer">
                        {ageMobileUrl}
                      </a>
                    </div>
                  )}
                  {ageSessionError && (
                    <>
                      <p className="auth-message error">{ageSessionError}</p>
                      {ageSessionErrorDetail && (
                        <details className="age-verify-error-details">
                          <summary>Show details</summary>
                          <pre>{JSON.stringify(ageSessionErrorDetail, null, 2)}</pre>
                        </details>
                      )}
                    </>
                  )}
                  {ageToken && !ageSessionError && (
                    <p className="auth-message info">
                      {ageVerifyApplied
                        ? "Age verification complete."
                        : "Verification captured. Applying to your account..."}
                    </p>
                  )}
                </div>
                {ageQrUrl && (
                  <div className="age-verify-qr">
                    <QRCodeCanvas value={ageQrUrl} size={160} includeMargin />
                    <span>Scan to continue</span>
                  </div>
                )}
              </div>
            </div>
            <div className="age-verify-footer">
              <button type="button" className="btn ghost" onClick={() => setAgeModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
