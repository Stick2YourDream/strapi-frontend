import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import IdCaptureModule from "./components/IdCaptureModule";
import LivenessModule, { type LivenessResult } from "./components/LivenessModule";
import SetupTutorial from "./components/SetupTutorial";
import SetupSettings from "./components/SetupSettings";
import { usePageMeta } from "../../hooks/usePageMeta";
import { computeFaceMatch, warmupFaceMatchModel } from "./utils/faceMatch";
import "./styles.css";
import { AGE_VERIFY_BASE_PATH } from "./constants";

type RuntimeOverrides = {
  applyToRuntime?: boolean;
  frontend?: {
    apiBaseUrl?: string;
    publicBaseUrl?: string;
    clientKey?: string;
    debug?: boolean;
    skipFaceMatch?: boolean;
    faceMatchTimeoutMs?: string;
  };
};

const SETTINGS_KEY = "ageVerifySettings.v1";
const SETTINGS_EVENT = "ageVerifySettingsUpdated";

type RuntimeSettings = {
  apiBase: string;
  publicBase: string;
  clientKey: string;
  showDebug: boolean;
  skipFaceMatch: boolean;
  faceMatchTimeoutMs: number;
};

const readRuntimeOverrides = (): RuntimeOverrides | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.applyToRuntime) return null;
    return parsed as RuntimeOverrides;
  } catch {
    return null;
  }
};

const resolveApiBase = (override?: RuntimeOverrides | null) => {
  const overrideValue = override?.frontend?.apiBaseUrl?.trim();
  const envValue = String(
    import.meta.env.VITE_AGE_VERIFY_API_URL ||
      import.meta.env.VITE_VERIFY_API_URL ||
      ""
  ).trim();
  const rawValue = overrideValue || envValue;
  if (typeof window === "undefined") {
    return rawValue || "http://localhost:1337/api/age-verify";
  }
  const host = window.location.hostname;
  if (!rawValue) {
    return `${window.location.origin}/api/age-verify`;
  }
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    if (rawValue.includes("localhost")) {
      return rawValue.replace("localhost", host);
    }
    if (rawValue.includes("127.0.0.1")) {
      return rawValue.replace("127.0.0.1", host);
    }
  }
  return rawValue;
};

const resolvePublicBase = (override?: RuntimeOverrides | null) => {
  const overrideValue = override?.frontend?.publicBaseUrl?.trim();
  if (overrideValue) return overrideValue.replace(/\/+$/, "");
  const envValue = String(
    import.meta.env.VITE_AGE_VERIFY_PUBLIC_URL ||
      import.meta.env.VITE_VERIFY_PUBLIC_URL ||
      ""
  ).trim();
  if (envValue) {
    const cleaned = envValue.replace(/\/+$/, "");
    if (cleaned.startsWith("/") && typeof window !== "undefined") {
      return `${window.location.origin}${cleaned}`;
    }
    try {
      const parsed = new URL(cleaned);
      const host = typeof window !== "undefined" ? window.location.hostname : "";
      const isLocalHost =
        parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      const isCurrentLocal =
        host === "localhost" || host === "127.0.0.1" || host === "";
      if (!isCurrentLocal && isLocalHost && typeof window !== "undefined") {
        parsed.protocol = window.location.protocol;
        parsed.hostname = window.location.hostname;
        parsed.port = window.location.port;
      }
      return parsed.toString();
    } catch {
      return cleaned;
    }
  }
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${AGE_VERIFY_BASE_PATH}`;
};

const resolveClientKey = (override?: RuntimeOverrides | null) => {
  const overrideValue = override?.frontend?.clientKey?.trim();
  if (overrideValue) return overrideValue;
  return String(
    import.meta.env.VITE_AGE_VERIFY_CLIENT_KEY ||
      import.meta.env.VITE_VERIFY_CLIENT_KEY ||
      ""
  ).trim();
};

const resolveShowDebug = (override?: RuntimeOverrides | null) => {
  if (typeof override?.frontend?.debug === "boolean") return override.frontend.debug;
  return (
    String(
      import.meta.env.VITE_AGE_VERIFY_DEBUG ||
        import.meta.env.VITE_VERIFY_DEBUG ||
        "true"
    ).toLowerCase() !== "false"
  );
};

const resolveSkipFaceMatch = (override?: RuntimeOverrides | null) => {
  if (typeof override?.frontend?.skipFaceMatch === "boolean") {
    return override.frontend.skipFaceMatch;
  }
  return (
    String(
      import.meta.env.VITE_AGE_VERIFY_SKIP_FACE_MATCH ||
        import.meta.env.VITE_SKIP_FACE_MATCH ||
        ""
    ).toLowerCase() === "true"
  );
};

const resolveFaceMatchTimeout = (override?: RuntimeOverrides | null) => {
  const value = override?.frontend?.faceMatchTimeoutMs?.trim();
  if (value && Number.isFinite(Number(value))) return Number(value);
  return Number(
    import.meta.env.VITE_AGE_VERIFY_FACE_MATCH_TIMEOUT_MS ||
      import.meta.env.VITE_FACE_MATCH_TIMEOUT_MS ||
      "7000"
  );
};

const buildRuntimeSettings = (override?: RuntimeOverrides | null): RuntimeSettings => ({
  apiBase: resolveApiBase(override),
  publicBase: resolvePublicBase(override),
  clientKey: resolveClientKey(override),
  showDebug: resolveShowDebug(override),
  skipFaceMatch: resolveSkipFaceMatch(override),
  faceMatchTimeoutMs: resolveFaceMatchTimeout(override),
});

const RuntimeSettingsContext = createContext<RuntimeSettings | null>(null);

const useRuntimeSettings = () => {
  const ctx = useContext(RuntimeSettingsContext);
  return ctx ?? buildRuntimeSettings(null);
};

const RuntimeSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [overrides, setOverrides] = useState<RuntimeOverrides | null>(() =>
    readRuntimeOverrides()
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUpdate = () => {
      setOverrides(readRuntimeOverrides());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_KEY) {
        handleUpdate();
      }
    };
    window.addEventListener(SETTINGS_EVENT, handleUpdate as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, handleUpdate as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const value = useMemo(() => buildRuntimeSettings(overrides), [overrides]);

  return (
    <RuntimeSettingsContext.Provider value={value}>
      {children}
    </RuntimeSettingsContext.Provider>
  );
};

const isLocalBase = (value: string) =>
  value.includes("localhost") || value.includes("127.0.0.1");
const LIVENESS_ONLY = false;

const buildClientHeaders = (clientKey: string) => {
  const headers: Record<string, string> = {};
  if (clientKey) headers["x-verify-api-key"] = clientKey;
  return headers;
};

const AGE_VERIFY_LOG_LABEL = "%c[age-verify]";
const AGE_VERIFY_LOG_STYLE = "color:#3ea8ff;font-weight:700;";
const FRONTEND_FACE_MATCH_MIN_SCORE = Number(
  import.meta.env.VITE_AGE_VERIFY_FACE_MATCH_MIN_SCORE || "0.2"
);
const FRONTEND_FACE_MATCH_MAX_DISTANCE = Number(
  import.meta.env.VITE_AGE_VERIFY_FACE_MATCH_MAX_DISTANCE || "0.13"
);

const ageVerifyLog = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.log(AGE_VERIFY_LOG_LABEL, AGE_VERIFY_LOG_STYLE, ...args);
};

const ageVerifyWarn = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.warn(AGE_VERIFY_LOG_LABEL, AGE_VERIFY_LOG_STYLE, ...args);
};

const ageVerifyError = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.error(AGE_VERIFY_LOG_LABEL, AGE_VERIFY_LOG_STYLE, ...args);
};

const clampFaceMatchTimeoutMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7000;
  return Math.min(15000, Math.max(3000, Math.round(parsed)));
};

const formatElapsedDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  if (mins > 0) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
};

const parseSelfieLabelIndex = (label: unknown) => {
  if (typeof label !== "string") return null;
  const match = /selfie-(\d+)/i.exec(label);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const getFaceMatchProgressMessage = (
  event: string,
  payload: Record<string, unknown> | undefined,
  selfieTotal: number
) => {
  const safeTotal = Math.max(1, selfieTotal);
  const label = payload?.label;
  const labeledSelfie = parseSelfieLabelIndex(label);
  if (event === "run-start") {
    return { stage: "Running face match", note: "Initializing face model..." };
  }
  if (event === "landmarker-ready" && label === "id-front") {
    return { stage: "Running face match", note: "Face model loaded. Reading ID portrait..." };
  }
  if (event === "extract-start" && label === "id-front") {
    return { stage: "Running face match", note: "Scanning face from ID photo..." };
  }
  if (event === "detect-start" && label === "id-front") {
    return { stage: "Running face match", note: "Detecting face landmarks on ID..." };
  }
  if (event === "extract-start" && labeledSelfie) {
    return {
      stage: "Running face match",
      note: `Analyzing selfie ${Math.min(labeledSelfie, safeTotal)} of ${safeTotal}...`,
    };
  }
  if (event === "candidate-added") {
    const selfieIndex = Number(payload?.selfieIndex);
    const position = Number.isFinite(selfieIndex) ? Math.max(1, selfieIndex + 1) : null;
    if (position) {
      return {
        stage: "Running face match",
        note: `Compared selfie ${Math.min(position, safeTotal)} of ${safeTotal}.`,
      };
    }
  }
  if (event === "run-complete") {
    return { stage: "Running face match", note: "Finalizing match score..." };
  }
  if (event === "run-complete-empty") {
    return { stage: "Running face match", note: "No usable face match found from captured selfies." };
  }
  if (event === "budget-exceeded") {
    return { stage: "Running face match", note: "Face match exceeded the processing budget." };
  }
  return null;
};

type ErrorDetail = {
  url: string;
  status: number;
  statusText: string;
  requestId?: string | null;
  payload?: unknown;
};

const parseErrorResponse = async (res: Response, url: string) => {
  const contentType = res.headers.get("content-type") || "";
  let payload: unknown = null;
  try {
    if (contentType.includes("application/json")) {
      payload = await res.json();
    } else {
      payload = await res.text();
    }
  } catch {
    payload = null;
  }
  const requestId =
    (payload as any)?.requestId || res.headers.get("x-request-id");
  const message =
    (payload as any)?.error ||
    (payload as any)?.message ||
    (typeof payload === "string" && payload.trim()) ||
    res.statusText ||
    "Request failed";
  return {
    message,
    detail: {
      url,
      status: res.status,
      statusText: res.statusText,
      requestId,
      payload,
    } satisfies ErrorDetail,
  };
};

type SessionResponse = {
  id: string;
  status: string;
  createdAt: string;
  verifiedAt?: string | null;
  ageOver18?: boolean | null;
  dobMasked?: string | null;
  reason?: string | null;
  token?: string | null;
  returnUrl?: string | null;
};

type FaceMatchPayload = {
  score: number;
  distance: number;
  selfieIndex: number;
  comparedCount: number;
};

type FaceMatchClientStatus = "pass" | "fail" | "timeout" | "error" | "skipped";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const fetchSession = async (
  apiBase: string,
  clientKey: string,
  sessionId: string
): Promise<SessionResponse | null> => {
  const url = `${apiBase}/session/${sessionId}`;
  const res = await fetch(url, { headers: buildClientHeaders(clientKey) });
  if (!res.ok) {
    const parsed = await parseErrorResponse(res, url);
    throw parsed;
  }
  const data = await res.json();
  return data?.data || null;
};

const recoverUploadResult = async (
  apiBase: string,
  clientKey: string,
  sessionId: string,
  attempts = 8,
  intervalMs = 2500
): Promise<
  | { kind: "verified"; session: SessionResponse }
  | { kind: "final"; session: SessionResponse }
  | null
> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await wait(intervalMs);
    }
    try {
      const session = await fetchSession(apiBase, clientKey, sessionId);
      const status = String(session?.status || "").toLowerCase();
      if (session && status === "verified" && session.token) {
        return { kind: "verified" as const, session };
      }
      if (session && (status === "failed" || status === "denied")) {
        return { kind: "final" as const, session };
      }
    } catch {
      // Keep polling briefly in case the upload response was lost while the backend is still finalizing.
    }
  }
  return null;
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 720px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 720px)");
    const handler = () => setIsMobile(media.matches);
    handler();
    if (media.addEventListener) {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    media.addListener(handler);
    return () => media.removeListener(handler);
  }, []);

  return isMobile;
};

const useSession = (sessionId: string | null) => {
  const { apiBase, clientKey } = useRuntimeSettings();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const sessionData = await fetchSession(apiBase, clientKey, sessionId);
      setSession(sessionData);
      setError(null);
      setErrorDetail(null);
    } catch (err: any) {
      setError(err?.message || "Unable to load session");
      setErrorDetail(err?.detail || null);
      ageVerifyError("load session failed", err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, clientKey, sessionId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  return { session, loading, error, errorDetail };
};

const StartPage = () => {
  const { apiBase, publicBase, clientKey } = useRuntimeSettings();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [mobileUrl, setMobileUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const returnUrl = searchParams.get("returnUrl") || "";
  const userIdParam = searchParams.get("userId") || "";
  const autoReturnParam = searchParams.get("autoReturn") || "";
  const skipIdParam = searchParams.get("skipId");
  const stepParam = searchParams.get("step");

  const applyMobileOverrides = useCallback(
    (url: string | null) => {
      if (!url) return null;
      try {
        const origin =
          typeof window !== "undefined" && window.location.origin !== "null"
            ? window.location.origin
            : "http://localhost";
        const next = new URL(url, origin);
        if (skipIdParam) next.searchParams.set("skipId", skipIdParam);
        if (stepParam) next.searchParams.set("step", stepParam);
        if (autoReturnParam) next.searchParams.set("autoReturn", autoReturnParam);
        return next.toString();
      } catch {
        return url;
      }
    },
    [skipIdParam, stepParam]
  );

  const createSession = async () => {
    setError(null);
    setErrorDetail(null);
    setCopied(false);
    try {
      const url = `${apiBase}/session`;
      const payload: Record<string, string> = {
        returnUrl,
        publicBaseUrl: publicBase,
      };
      if (userIdParam) payload.userId = userIdParam;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildClientHeaders(clientKey),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const parsed = await parseErrorResponse(res, url);
        throw parsed;
      }
      const data = await res.json();
      const nextSessionId = data?.data?.sessionId || null;
      const serverQrUrl = data?.data?.qrUrl || null;
      const serverMobileUrl = data?.data?.mobileUrl || null;
      const canOverride = publicBase && !isLocalBase(publicBase);
      const clientMobileUrl =
        nextSessionId && canOverride
          ? `${publicBase.replace(/\/+$/, "")}/session/${nextSessionId}?mode=mobile`
          : null;
      const nextMobileUrl = applyMobileOverrides(clientMobileUrl || serverMobileUrl);
      setSessionId(nextSessionId);
      setQrUrl(applyMobileOverrides(clientMobileUrl || serverQrUrl || nextMobileUrl));
      setMobileUrl(nextMobileUrl);
      if (isMobile && nextMobileUrl) {
        try {
          const url = new URL(nextMobileUrl, window.location.origin);
          if (url.origin === window.location.origin) {
            navigate(`${url.pathname}${url.search}`, { replace: true });
            return;
          }
        } catch {
          // fall back to hard redirect below
        }
        window.location.assign(nextMobileUrl);
      }
    } catch (err: any) {
      setError(err?.message || "Unable to create session");
      setErrorDetail(err?.detail || null);
      ageVerifyError("create session failed", err);
    }
  };

  const { session } = useSession(sessionId);

  if (LIVENESS_ONLY) {
    const params = new URLSearchParams();
    const skip = skipIdParam || "1";
    if (skip) params.set("skipId", skip);
    if (stepParam) params.set("step", stepParam);
    const target = `${AGE_VERIFY_BASE_PATH}/session/dev?${params.toString()}`;
    return (
      <div className="page">
        <header className="hero small">
          <h1>Selfie liveness test</h1>
          <p className="sub">Debug-only flow. ID capture and submission are disabled.</p>
        </header>
        <div className="hero-actions">
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              if (isMobile) {
                navigate(target, { replace: true });
                return;
              }
              window.location.assign(target);
            }}
          >
            Start liveness test
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Verify your age</p>
        <h1>Secure age verification for Your Social Place</h1>
        <p className="sub">
          Use your phone camera to scan your ID and confirm you are 18 or older.
          No ID images are stored.
        </p>
        <div className="step-list">
          <div className="step">
            <span className="step-number">Step 1</span>
            <span>Start verification to generate a secure QR code.</span>
          </div>
          <div className="step">
            <span className="step-number">Step 2</span>
            <span>Open the mobile link or scan the QR code on your phone.</span>
          </div>
          <div className="step">
            <span className="step-number">Step 3</span>
            <span>Capture your ID and live selfies to complete verification.</span>
          </div>
        </div>
        <div className="hero-actions actions">
          <button className="btn primary" type="button" onClick={createSession}>
            Start verification
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => navigate(`${AGE_VERIFY_BASE_PATH}/tutorial`)}
          >
            Setup tutorial
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => navigate(`${AGE_VERIFY_BASE_PATH}/settings`)}
          >
            Settings
          </button>
        </div>
        {error && (
          <>
            <p className="error">{error}</p>
            {errorDetail && (
              <details className="error-details">
                <summary>Show details</summary>
                <pre>{JSON.stringify(errorDetail, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </header>

      {sessionId && (
        <section className="card">
          <div>
            <h2>Switch to your phone</h2>
            <p>
              Scan the QR code with your phone camera. We’ll guide you through the
              ID scan and selfie steps.
            </p>
            {mobileUrl && (
              <>
                <div className="mobile-link">
                  <a
                    className="btn primary"
                    href={mobileUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open mobile link
                  </a>
                  <span className="mobile-link-preview">{mobileUrl}</span>
                </div>
                <div className="mobile-actions">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => {
                      if (!navigator.clipboard) return;
                      void navigator.clipboard.writeText(mobileUrl).then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2000);
                      });
                    }}
                  >
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                  {navigator.share && (
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        navigator.share({
                          title: "Age verification",
                          text: "Open this link on your phone to verify your age.",
                          url: mobileUrl,
                        })
                      }
                    >
                      Share to phone
                    </button>
                  )}
                </div>
              </>
            )}
            {session && (
              <div className="status">
                <span>Status: {session.status}</span>
                {session.reason && <span>{session.reason}</span>}
              </div>
            )}
          </div>
          {qrUrl && (
            <div className="qr">
              <QRCodeCanvas value={qrUrl} size={200} includeMargin />
              <span>Scan to continue on phone</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const MobileSession = () => {
  const {
    apiBase,
    clientKey,
    showDebug,
    skipFaceMatch: skipFaceMatchDefault,
    faceMatchTimeoutMs,
  } = useRuntimeSettings();
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const skipFaceMatch = useMemo(() => {
    const raw = searchParams.get("skipFaceMatch");
    if (!raw) return skipFaceMatchDefault;
    const normalized = raw.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }, [searchParams, skipFaceMatchDefault]);
  const boundedFaceMatchTimeoutMs = useMemo(
    () => clampFaceMatchTimeoutMs(faceMatchTimeoutMs),
    [faceMatchTimeoutMs]
  );
  useEffect(() => {
    if (boundedFaceMatchTimeoutMs !== faceMatchTimeoutMs) {
      ageVerifyWarn("face match timeout clamped", {
        configured: faceMatchTimeoutMs,
        applied: boundedFaceMatchTimeoutMs,
      });
    }
  }, [faceMatchTimeoutMs, boundedFaceMatchTimeoutMs]);
  const stepStorageKey = useMemo(
    () => `ageVerifyStep:${sessionId || "default"}`,
    [sessionId]
  );
  useEffect(() => {
    warmupStartedRef.current = false;
  }, [sessionId]);
  const readStoredStep = useCallback(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(stepStorageKey);
      const parsed = raw ? Number(raw) : null;
      if (!parsed || !Number.isFinite(parsed)) return null;
      if (parsed < 1 || parsed > 4) return null;
      return Math.floor(parsed);
    } catch {
      return null;
    }
  }, [stepStorageKey]);
  const [mobileStep, setMobileStep] = useState(() => {
    if (LIVENESS_ONLY) return 1;
    return readStoredStep() ?? 1;
  });
  const [idType, setIdType] = useState("driver_license");
  const [idFront, setIdFront] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);
  const [livenessData, setLivenessData] = useState<LivenessResult>({
    motionFrames: [],
    selfies: [],
    livenessPrompts: [],
    livenessStartedAt: null,
  });
  const [status, setStatus] = useState<string>("ready");
  const [verifyStartedAt, setVerifyStartedAt] = useState<number | null>(null);
  const [verifyElapsed, setVerifyElapsed] = useState(0);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [verifyStage, setVerifyStage] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const warmupStartedRef = useRef(false);
  const [uploadDebug, setUploadDebug] = useState<{
    sessionId: string | null;
    apiBase: string;
    startedAt: string;
    sizes: Record<string, number>;
    totalBytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [resultToken, setResultToken] = useState<string | null>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  const skipInfo = useMemo(() => {
    const stepRaw = searchParams.get("step");
    const skipRaw = String(searchParams.get("skipId") || "").trim();
    const wantsSkip =
      skipRaw === "1" || skipRaw.toLowerCase() === "true" || skipRaw === "yes";
    let desiredStep: number | null = null;
    if (stepRaw) {
      const parsed = Number(stepRaw);
      if (Number.isFinite(parsed)) {
        desiredStep = Math.min(4, Math.max(1, Math.floor(parsed)));
      }
    } else if (wantsSkip) {
      desiredStep = 1;
    }
    return { wantsSkip, desiredStep, hasOverride: Boolean(stepRaw || wantsSkip) };
  }, [searchParams]);

  useEffect(() => {
    if (LIVENESS_ONLY) {
      setMobileStep(1);
      return;
    }
    const stored = readStoredStep();
    if (stored) {
      setMobileStep(stored);
      return;
    }
    if (skipInfo.desiredStep) {
      setMobileStep(skipInfo.desiredStep);
      return;
    }
    if (!isMobile && !skipInfo.hasOverride) {
      setMobileStep(1);
    }
  }, [LIVENESS_ONLY, isMobile, readStoredStep, skipInfo.desiredStep, skipInfo.hasOverride]);

  useEffect(() => {
    if (LIVENESS_ONLY) return;
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(stepStorageKey, String(mobileStep));
    } catch {
      // ignore storage failures
    }
  }, [LIVENESS_ONLY, mobileStep, stepStorageKey]);

  const hasMotionProof = livenessData.motionFrames.length >= 2;
  const livenessComplete =
    livenessData.selfies.length >= 4 && hasMotionProof;
  const step1Complete = livenessComplete;
  const step2Complete = Boolean(idType);
  const requiresBackCapture = idType !== "passport";
  const hasReadableIdInputs = requiresBackCapture
    ? Boolean(idFront) && Boolean(idBack)
    : Boolean(idFront);
  const step3Complete = hasReadableIdInputs;
  const shouldAutoStartLiveness =
    skipInfo.wantsSkip ||
    LIVENESS_ONLY ||
    (mobileStep === 1 && livenessData.selfies.length === 0);
  const canSubmit = useMemo(
    () => hasReadableIdInputs && livenessComplete,
    [hasReadableIdInputs, livenessComplete]
  );
  const showStepHeader = !LIVENESS_ONLY;
  const showStep1 = LIVENESS_ONLY || mobileStep === 1;
  const showStep2 = !LIVENESS_ONLY && mobileStep === 2;
  const showStep3 = !LIVENESS_ONLY && mobileStep === 3;
  const showStep4 = !LIVENESS_ONLY && mobileStep === 4;

  useEffect(() => {
    if (idType === "passport" && idBack) {
      setIdBack(null);
      ageVerifyLog("passport selected; clearing back-ID capture");
    }
  }, [idType, idBack]);

  useEffect(() => {
    const shouldWarm =
      Boolean(idFront) &&
      livenessData.selfies.length > 0 &&
      (LIVENESS_ONLY || mobileStep >= 3);
    if (!shouldWarm || warmupStartedRef.current) return;
    warmupStartedRef.current = true;
    ageVerifyLog("face match warmup start", {
      sessionId,
      mobileStep,
      livenessSelfies: livenessData.selfies.length,
    });
    void warmupFaceMatchModel({
      log: (event, payload) => {
        ageVerifyLog(`face-match warmup ${event}`, payload || {});
      },
    })
      .then(() => {
        ageVerifyLog("face match warmup complete", { sessionId });
      })
      .catch((error) => {
        ageVerifyWarn("face match warmup failed", error);
      });
  }, [idFront, livenessData.selfies.length, mobileStep, sessionId]);

  const handleSubmit = async () => {
    if (!sessionId) return;
    setStatus("uploading");
    setError(null);
    setErrorDetail(null);
    const startedAt = Date.now();
    setVerifyStartedAt(startedAt);
    setVerifyElapsed(0);
    setVerifyNote(null);
    setVerifyStage("Preparing upload");
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
    }
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const form = new FormData();
    const {
      motionFrames,
      selfies,
      livenessPrompts,
      livenessStartedAt,
    } = livenessData;
    const sizes = {
      idFront: idFront?.size || 0,
      idBack: idBack?.size || 0,
      selfie1: selfies[0]?.size || 0,
      selfie2: selfies[1]?.size || 0,
      selfie3: selfies[2]?.size || 0,
      selfie4: selfies[3]?.size || 0,
      motion1: motionFrames[0]?.size || 0,
      motion2: motionFrames[1]?.size || 0,
      motion3: motionFrames[2]?.size || 0,
    };
    const totalBytes = Object.values(sizes).reduce((sum, value) => sum + value, 0);
    ageVerifyLog("submit verification clicked", {
      sessionId,
      idType,
      requiresBackCapture,
      livenessSelfies: selfies.length,
      livenessMotionFrames: motionFrames.length,
      faceMatchTimeoutMsConfigured: faceMatchTimeoutMs,
      faceMatchTimeoutMsUsed: boundedFaceMatchTimeoutMs,
      totalBytes,
    });
    setUploadDebug({
      sessionId: sessionId || null,
      apiBase,
      startedAt: new Date(startedAt).toISOString(),
      sizes,
      totalBytes,
    });
    const [selfie, selfieAlt, selfieThird, selfieFourth] = selfies;
    const idFrontFile = idFront;
    if (!idFrontFile) {
      setStatus("error");
      setError("Capture the front of your ID before submitting.");
      setVerifyStage("Missing ID evidence");
      uploadAbortRef.current = null;
      return;
    }
    let faceMatchResult: FaceMatchPayload | null = null;
    let faceMatchClientStatus: FaceMatchClientStatus = "skipped";
    let useServerFaceMatchFallback = false;
    const hasRequiredIdEvidence =
      (idType !== "passport" && Boolean(idBack)) ||
      (idType === "passport" && Boolean(idFront));
    if (!hasRequiredIdEvidence) {
      setStatus("error");
      setError(
        idType === "passport"
          ? "Capture the passport photo page."
          : "Capture both the front and back of your ID before submitting."
      );
      setVerifyStage("Missing ID evidence");
      uploadAbortRef.current = null;
      return;
    }
    try {
      if (skipFaceMatch) {
        setVerifyNote("Face match skip override is ignored for live verification.");
      }
      setVerifyStage("Running face match");
      const faceMatchSelfieCount = Math.max(
        1,
        Math.min(3, selfies.filter(Boolean).length)
      );
      setVerifyNote(`Running face match on ID + ${faceMatchSelfieCount} selfie(s)...`);
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      const faceMatchStartedAt = Date.now();
      let timeoutHandle: number | null = null;
      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutHandle = window.setTimeout(() => {
          ageVerifyWarn("face match timeout reached", {
            sessionId,
            timeoutMs: boundedFaceMatchTimeoutMs,
          });
          resolve(null);
        }, boundedFaceMatchTimeoutMs);
      });
      ageVerifyLog("face match start", {
        sessionId,
        timeoutMs: boundedFaceMatchTimeoutMs,
        idFrontBytes: idFrontFile.size,
        selfieCount: selfies.filter(Boolean).length,
      });
      faceMatchResult = await Promise.race([
        computeFaceMatch(idFrontFile, selfies, {
          maxSelfies: faceMatchSelfieCount,
          budgetMs: Math.max(4000, boundedFaceMatchTimeoutMs + 1500),
          log: (event, payload) => {
            ageVerifyLog(`face-match ${event}`, payload || {});
            const progress = getFaceMatchProgressMessage(
              event,
              payload as Record<string, unknown> | undefined,
              faceMatchSelfieCount
            );
            if (progress) {
              setVerifyStage(progress.stage);
              setVerifyNote(progress.note);
            }
            setVerifyElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
          },
        }),
        timeoutPromise,
      ]);
      if (timeoutHandle) {
        window.clearTimeout(timeoutHandle);
      }
      ageVerifyLog("face match finished", {
        sessionId,
        elapsedMs: Date.now() - faceMatchStartedAt,
        hasResult: Boolean(faceMatchResult),
      });
    } catch (err) {
      ageVerifyWarn("face match failed", err);
      faceMatchClientStatus = "error";
      useServerFaceMatchFallback = true;
      setVerifyStage("Running server face match fallback");
      setVerifyNote("Client face match errored. Uploading now and matching on the server...");
    }
    if (!faceMatchResult) {
      if (faceMatchClientStatus === "skipped") {
        faceMatchClientStatus = "timeout";
      }
      useServerFaceMatchFallback = true;
      setVerifyStage("Running server face match fallback");
      setVerifyNote(
        "Client face match timed out. Uploading now and completing face match on the server..."
      );
    }
    const resolvedFaceMatch = faceMatchResult;
    if (resolvedFaceMatch) {
      const faceMatchPass =
        resolvedFaceMatch.distance <= FRONTEND_FACE_MATCH_MAX_DISTANCE &&
        resolvedFaceMatch.score >= FRONTEND_FACE_MATCH_MIN_SCORE;
      if (!faceMatchPass) {
        faceMatchClientStatus = "fail";
        useServerFaceMatchFallback = true;
        setVerifyStage("Running server face match fallback");
        setVerifyNote(
          `Client face match score ${resolvedFaceMatch.score.toFixed(2)} (distance ${resolvedFaceMatch.distance.toFixed(3)}). Uploading for server-side fallback...`
        );
        ageVerifyWarn("face match below threshold", {
          score: resolvedFaceMatch.score,
          distance: resolvedFaceMatch.distance,
          minScore: FRONTEND_FACE_MATCH_MIN_SCORE,
          maxDistance: FRONTEND_FACE_MATCH_MAX_DISTANCE,
        });
      } else {
        faceMatchClientStatus = "pass";
        ageVerifyLog("face match pass", {
          score: resolvedFaceMatch.score,
          distance: resolvedFaceMatch.distance,
          comparedCount: resolvedFaceMatch.comparedCount,
          selfieIndex: resolvedFaceMatch.selfieIndex,
        });
      }
    }
    setVerifyStage("Preparing upload");
    setVerifyNote(
      useServerFaceMatchFallback
        ? "Client face match deferred to server fallback."
        : null
    );
    form.append("idFront", idFrontFile);
    if (idBack) form.append("idBack", idBack);
    if (selfie) form.append("selfie", selfie);
    if (selfieAlt) form.append("selfieAlt", selfieAlt);
    if (selfieThird) form.append("selfieThird", selfieThird);
    if (selfieFourth) form.append("selfieFourth", selfieFourth);
    form.append("faceMatchClientStatus", faceMatchClientStatus);
    if (useServerFaceMatchFallback) {
      form.append("faceMatchFallback", "1");
    }
    if (resolvedFaceMatch) {
      form.append("faceMatchScore", resolvedFaceMatch.score.toFixed(4));
      form.append("faceMatchDistance", resolvedFaceMatch.distance.toFixed(4));
      form.append("faceMatchSelfieIndex", String(resolvedFaceMatch.selfieIndex));
      form.append("faceMatchCompared", String(resolvedFaceMatch.comparedCount));
    }
    motionFrames.slice(0, 3).forEach((frame, index) => {
      form.append(`selfieMotion${index + 1}`, frame);
    });
    form.append("idType", idType);
    form.append("captureSource", "camera");
    form.append("captureMode", "live");
    form.append("captureTimestamp", new Date().toISOString());
    if (livenessPrompts[0]) form.append("livenessPrompt", livenessPrompts[0]);
    if (livenessPrompts[1]) form.append("livenessPromptAlt", livenessPrompts[1]);
    if (livenessPrompts[2]) form.append("livenessPromptThird", livenessPrompts[2]);
    if (livenessPrompts[3]) form.append("livenessPromptFourth", livenessPrompts[3]);
    if (livenessStartedAt) form.append("livenessStartedAt", livenessStartedAt);
    ageVerifyLog("upload started", {
      sessionId,
      idFront: Boolean(idFront),
      idBack: Boolean(idBack),
      selfies: selfies.length,
      motionFrames: motionFrames.length,
      faceMatchClientStatus,
      faceMatchFallback: useServerFaceMatchFallback,
    });
    try {
      const url = `${apiBase}/session/${sessionId}/upload`;
      setVerifyStage(
        useServerFaceMatchFallback
          ? "Uploading evidence for server face match"
          : "Uploading to server"
      );
      if (useServerFaceMatchFallback) {
        setVerifyNote("Server is now running face match + document verification...");
      }
      ageVerifyLog("upload request start", { url, sessionId });
      const res = await fetch(url, {
        method: "POST",
        headers: buildClientHeaders(clientKey),
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const parsed = await parseErrorResponse(res, url);
        throw parsed;
      }
      setVerifyStage("Processing response");
      const data = await res.json();
      const responseStatus = String(data?.data?.status || "").toLowerCase();
      const responseToken = data?.data?.token || null;
      ageVerifyLog("upload response received", {
        sessionId,
        httpStatus: res.status,
        responseStatus,
        hasToken: Boolean(responseToken),
      });
      if (responseStatus !== "verified" || !responseToken) {
        const message =
          data?.data?.reason ||
          (responseStatus === "denied"
            ? "Age verification denied."
            : "Age verification did not complete.");
        const verificationError: any = new Error(message);
        verificationError.detail = {
          sessionStatus: responseStatus || "unknown",
          payload: data?.data || null,
        };
        throw verificationError;
      }
      setStatus("done");
      setResultToken(responseToken);
      setReturnUrl(data?.data?.returnUrl || null);
      setVerifyStage(null);
      uploadAbortRef.current = null;
      setUploadDebug(null);
      ageVerifyLog("upload completed", {
        sessionId,
        ms: Date.now() - startedAt,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setStatus("ready");
        setVerifyStage("Verification canceled");
        return;
      }
      const isNetworkFailure =
        !err?.detail &&
        /failed to fetch|load failed|networkerror|network request failed/i.test(
          String(err?.message || "")
        );
      if (isNetworkFailure) {
        setVerifyStage("Recovering verification");
        setVerifyNote("Upload finished. Checking the server for the final verification result...");
        const recovered = await recoverUploadResult(apiBase, clientKey, sessionId);
        if (recovered?.kind === "verified") {
          setStatus("done");
          setResultToken(recovered.session.token || null);
          setReturnUrl(recovered.session.returnUrl || null);
          setVerifyStage(null);
          setVerifyNote(null);
          uploadAbortRef.current = null;
          setUploadDebug(null);
          ageVerifyLog("upload recovered via session poll", {
            sessionId,
            status: recovered.session.status,
          });
          return;
        }
        if (recovered?.kind === "final") {
          const recoveredStatus = String(recovered.session.status || "").toLowerCase();
          const recoveredMessage =
            recovered.session.reason ||
            (recoveredStatus === "denied"
              ? "Age verification denied."
              : "Age verification did not complete.");
          setStatus("error");
          setError(recoveredMessage);
          setErrorDetail({
            url: `${apiBase}/session/${sessionId}`,
            status: 200,
            statusText: "Recovered from upload network failure",
            payload: recovered.session,
          });
          setVerifyStage("Failed to verify");
          setUploadDebug((prev) => (prev ? { ...prev } : null));
          ageVerifyWarn("upload network error recovered to final session status", {
            sessionId,
            status: recovered.session.status,
          });
          return;
        }
      }
      setStatus("error");
      setError(err?.message || "Verification failed");
      setErrorDetail(err?.detail || null);
      setVerifyStage("Failed to verify");
      setUploadDebug((prev) => (prev ? { ...prev } : null));
      ageVerifyError("upload failed", err);
    }
  };

  const cancelVerification = useCallback(() => {
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      uploadAbortRef.current = null;
    }
    setStatus("ready");
    setVerifyStartedAt(null);
    setVerifyElapsed(0);
    setVerifyNote(null);
    setVerifyStage(null);
  }, []);

  useEffect(() => {
    if (status !== "uploading" || !verifyStartedAt) {
      return;
    }
    const updateElapsed = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - verifyStartedAt) / 1000));
      setVerifyElapsed((prev) => (prev === elapsed ? prev : elapsed));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [status, verifyStartedAt]);

  useEffect(() => {
    if (status !== "uploading") {
      setVerifyStage(null);
      return;
    }
    if (!verifyStartedAt) {
      setVerifyStartedAt(Date.now());
    }
  }, [status, verifyStartedAt]);

  const verifyElapsedLabel = useMemo(
    () => formatElapsedDuration(verifyElapsed),
    [verifyElapsed]
  );

  const verifyLongRunningHint = useMemo(() => {
    if (status !== "uploading") return null;
    if (verifyElapsed >= 120) {
      return "This is taking longer than expected. Keep this tab open while verification finishes.";
    }
    if (verifyElapsed >= 60) {
      return "Still processing. OCR/barcode and server checks can take extra time.";
    }
    return null;
  }, [status, verifyElapsed]);

  const goNextStep = () => {
    setMobileStep((prev) => Math.min(4, prev + 1));
  };

  const goPrevStep = () => {
    setMobileStep((prev) => Math.max(1, prev - 1));
  };

  const resolveReturnTarget = () => {
    if (!returnUrl || !resultToken) return null;
    try {
      const url = new URL(returnUrl);
      url.searchParams.set("ageVerificationToken", resultToken);
      return url.toString();
    } catch {
      return `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}ageVerificationToken=${encodeURIComponent(
        resultToken
      )}`;
    }
  };

  const autoReturnEnabled = useMemo(() => {
    const raw = searchParams.get("autoReturn");
    if (!raw) return false;
    const normalized = raw.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }, [searchParams]);

  useEffect(() => {
    if (status !== "done" || !autoReturnEnabled) return;
    const target = resolveReturnTarget();
    if (target) {
      window.location.assign(target);
    }
  }, [autoReturnEnabled, returnUrl, resultToken, status]);

  return (
    <div className="page">
      <header className="hero small">
        <h1>Age verification</h1>
      </header>
      <section className={`card ${isMobile ? "mobile-step-card" : ""}`}>
        {showStepHeader && (
          <div className="mobile-step-header">
            <span className="mobile-step-count">Step {mobileStep} of 4</span>
            <div className="mobile-step-title">
              {mobileStep === 1 && "Complete selfie liveness"}
              {mobileStep === 2 && "Choose your ID type"}
              {mobileStep === 3 && "Capture ID photo"}
              {mobileStep === 4 && "Submit for verification"}
            </div>
          </div>
        )}
        {showStep1 && (
          <div className={`mobile-step ${isMobile ? "active" : ""}`}>
            <LivenessModule
              initialValue={livenessData}
              onChange={setLivenessData}
              onComplete={setLivenessData}
              autoStart={shouldAutoStartLiveness}
              allowAutoCaptureWithoutMotion={LIVENESS_ONLY}
              debug={showDebug}
            />
          </div>
        )}

        {showStep2 && (
          <div className={`mobile-step step-id ${isMobile ? "active" : ""}`}>
            <label className="field centered">
              <span>ID Type (Step 2)</span>
              <div className="select-wrap">
                <select value={idType} onChange={(e) => setIdType(e.target.value)}>
                  <option value="driver_license">Driver’s license</option>
                  <option value="state_id">State ID</option>
                  <option value="passport">Passport</option>
                  <option value="military_id">Military ID</option>
                </select>
              </div>
            </label>
          </div>
        )}

        {showStep3 && (
          <div className={`mobile-step ${isMobile ? "active" : ""}`}>
            <IdCaptureModule
              idFront={idFront}
              idBack={idBack}
              idType={idType}
              onFrontChange={setIdFront}
              onBackChange={setIdBack}
            />
          </div>
        )}

        {showStep4 && (
          <div className={`mobile-step ${isMobile ? "active" : ""}`}>
            <div className="actions">
              <button className="btn primary" disabled={!canSubmit} onClick={handleSubmit}>
                {status === "uploading" ? "Verifying..." : "Verify age"}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  if (status === "uploading") {
                    cancelVerification();
                  }
                  navigate(AGE_VERIFY_BASE_PATH);
                }}
              >
                Start over
              </button>
            </div>
            {status === "uploading" && (
              <div className="status">
                <span>Verifying... {verifyElapsedLabel}</span>
                <span>Active step: {verifyStage || "Starting verification pipeline"}</span>
                {verifyNote && <span>{verifyNote}</span>}
                {verifyLongRunningHint && <span>{verifyLongRunningHint}</span>}
                {showDebug && uploadDebug && (
                  <>
                    <span>Session: {uploadDebug.sessionId || "unknown"}</span>
                    <span>API: {uploadDebug.apiBase}</span>
                    <span>Started: {uploadDebug.startedAt}</span>
                    <span>
                      Upload size: {(uploadDebug.totalBytes / 1024 / 1024).toFixed(2)} MB
                    </span>
                    {errorDetail?.requestId && (
                      <span>Request ID: {errorDetail.requestId}</span>
                    )}
                  </>
                )}
              </div>
            )}
            {error && (
              <>
                <p className="error">{error}</p>
                {errorDetail && (
                  <details className="error-details">
                    <summary>Show details</summary>
                    <pre>{JSON.stringify(errorDetail, null, 2)}</pre>
                  </details>
                )}
              </>
            )}
            {status === "done" && (
              <div className="success">
                <strong>Verification complete.</strong>
                {resultToken && (
                  <p>
                    Return to Your Social Place and continue registration.
                  </p>
                )}
                {resolveReturnTarget() && (
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => {
                      const target = resolveReturnTarget();
                      if (target) window.location.assign(target);
                    }}
                  >
                    Continue to Your Social Place
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!LIVENESS_ONLY && (
          <div className="mobile-step-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                if (status === "uploading") {
                  cancelVerification();
                }
                goPrevStep();
              }}
              disabled={mobileStep === 1}
            >
              Back
            </button>
            {mobileStep < 4 && (
              <button
                className="btn primary"
                type="button"
                onClick={goNextStep}
                disabled={
                  (mobileStep === 1 && !step1Complete) ||
                  (mobileStep === 2 && !step2Complete) ||
                  (mobileStep === 3 && !step3Complete)
                }
              >
                Next
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default function App() {
  usePageMeta({
    title: "Age Verification | Your Social Place",
    description: "Secure age verification workflow for private account and compliance checks.",
    robots: "noindex, nofollow",
    canonical: "/age-verify",
  });

  return (
    <RuntimeSettingsProvider>
      <div className="age-verify-root">
        <Routes>
          <Route index element={<StartPage />} />
          <Route path="tutorial" element={<SetupTutorial />} />
          <Route path="settings" element={<SetupSettings />} />
          <Route path="session/:sessionId" element={<MobileSession />} />
        </Routes>
      </div>
    </RuntimeSettingsProvider>
  );
}
