import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import {
  type FaceLandmarker,
  type FaceLandmarkerOptions,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { loadTasksVision } from "../utils/tasksVisionLoader";
import "./CameraShared.css";
import "./LivenessModule.css";

const AGE_VERIFY_LOG_LABEL = "%c[age-verify]";
const AGE_VERIFY_LOG_STYLE = "color:#3ea8ff;font-weight:700;";
const ageVerifyError = (...args: any[]) => {
  // eslint-disable-next-line no-console
  console.error(AGE_VERIFY_LOG_LABEL, AGE_VERIFY_LOG_STYLE, ...args);
};

export type LivenessResult = {
  selfies: File[];
  motionFrames: File[];
  livenessPrompts: string[];
  livenessStartedAt: string | null;
};

export const LIVENESS_SELFIE_TOTAL = 3;

type LivenessModuleProps = {
  initialValue?: Partial<LivenessResult>;
  onChange?: (data: LivenessResult) => void;
  onComplete?: (data: LivenessResult) => void;
  autoStart?: boolean;
  allowAutoCaptureWithoutMotion?: boolean;
  debug?: boolean;
  className?: string;
};

const DEFAULT_DATA: LivenessResult = {
  selfies: [],
  motionFrames: [],
  livenessPrompts: [],
  livenessStartedAt: null,
};

const LIVENESS_PROMPTS = [
  "Look straight ahead.",
  "Look left.",
  "Look right.",
] as const;

const SELFIE_COUNTDOWN_SECONDS = 0;
const PREP_DURATION_SECONDS = 10;
const LIVENESS_VIDEO_CONSTRAINTS = {
  width: { ideal: 1920, max: 2560 },
  height: { ideal: 1080, max: 1440 },
  frameRate: { ideal: 30, max: 60 },
} as const;
const LIVENESS_SELFIE_QUALITY = 0.96;
const LIVENESS_MOTION_QUALITY = 0.95;
const LIVENESS_ADVANCED_CONSTRAINTS: any[] = [
  { focusMode: "continuous" },
  { exposureMode: "continuous" },
  { whiteBalanceMode: "continuous" },
];

const ENV_FACE_MODEL_URL = String(import.meta.env.VITE_FACE_MODEL_URL || "").trim();
const ENV_VISION_WASM_URL = String(import.meta.env.VITE_VISION_WASM_URL || "").trim();
const TASKS_VISION_VERSION = "0.10.32";
const resolveAssetUrl = (path: string) => {
  const cleaned = path.replace(/^\/+/, "");
  const base = String(import.meta.env.BASE_URL || "/");
  if (typeof window === "undefined") return `/${cleaned}`;
  const join = (prefix: string) => `${prefix.replace(/\/+$/, "")}/${cleaned}`;
  if (/^https?:\/\//i.test(base) || base.startsWith("file:")) {
    return join(base);
  }
  const origin =
    window.location.origin && window.location.origin !== "null"
      ? window.location.origin
      : window.location.href;
  return new URL(join(base), origin).toString();
};
const LOCAL_VISION_WASM_URL = resolveAssetUrl("mediapipe/wasm");
const LOCAL_FACE_MODEL_URL = resolveAssetUrl("mediapipe/models/face_landmarker.task");
const ROOT_FACE_MODEL_URL = resolveAssetUrl("face_landmarker.task");
const CLOUD_FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const FACE_MODEL_URLS = [
  ENV_FACE_MODEL_URL,
  LOCAL_FACE_MODEL_URL,
  ROOT_FACE_MODEL_URL,
  CLOUD_FACE_MODEL_URL,
].filter(Boolean);
const VISION_WASM_URLS = [
  ENV_VISION_WASM_URL,
  LOCAL_VISION_WASM_URL,
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`,
  `https://unpkg.com/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`,
].filter(Boolean);

const LANDMARK_INDEX = {
  NOSE_TIP: 1,
  LEFT_EYE_OUTER: 33,
  LEFT_EYE_INNER: 133,
  RIGHT_EYE_INNER: 362,
  RIGHT_EYE_OUTER: 263,
  LEFT_EYE_UPPER: 159,
  LEFT_EYE_LOWER: 145,
  RIGHT_EYE_UPPER: 386,
  RIGHT_EYE_LOWER: 374,
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
  MOUTH_UPPER: 13,
  MOUTH_LOWER: 14,
  CHIN: 152,
} as const;

const getPromptSequence = (prompts: readonly string[]) => [...prompts];

const hasPromptOrder = (prompts: readonly string[]) =>
  prompts.length === LIVENESS_PROMPTS.length &&
  LIVENESS_PROMPTS.every((prompt, index) => prompts[index] === prompt);

const restoreDocumentInteractivity = () => {
  if (typeof document === "undefined") return;
  document.body.style.overflow = "";
  document.body.style.touchAction = "";
  document.documentElement.style.overflow = "";
  document.documentElement.style.touchAction = "";
};

const usePreviewUrl = (file: File | null) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
};

const buildInitialData = (initialValue?: Partial<LivenessResult>): LivenessResult => ({
  ...DEFAULT_DATA,
  ...initialValue,
  selfies: initialValue?.selfies ?? [],
  motionFrames: initialValue?.motionFrames ?? [],
  livenessPrompts: initialValue?.livenessPrompts ?? [],
});

export default function LivenessModule({
  initialValue,
  onChange,
  onComplete,
  autoStart = false,
  allowAutoCaptureWithoutMotion = false,
  debug = false,
  className,
}: LivenessModuleProps) {
  const [data, setData] = useState<LivenessResult>(() => buildInitialData(initialValue));
  const [motionStatus, setMotionStatus] = useState<"idle" | "capturing" | "done" | "error">(
    "idle"
  );
  const [motionError, setMotionError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<
    "granted" | "denied" | "prompt" | "unknown"
  >("unknown");
  const [manualOverride, setManualOverride] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [visionStatus, setVisionStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [visionAttempt, setVisionAttempt] = useState<{
    wasmUrl: string;
    modelUrl: string;
  } | null>(null);
  const [visionAttemptIndex, setVisionAttemptIndex] = useState(0);
  const [visionAttemptTotal, setVisionAttemptTotal] = useState(0);
  const [visionDelegate, setVisionDelegate] = useState<"GPU" | "CPU" | null>(null);
  const [cameraDeviceLabel, setCameraDeviceLabel] = useState<string | null>(null);
  const [promptSatisfied, setPromptSatisfied] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceAligned, setFaceAligned] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownProgress, setCountdownProgress] = useState(1);
  const [countdownTarget, setCountdownTarget] = useState<"selfie" | null>(null);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [useFrontCamera, setUseFrontCamera] = useState(true);
  const [pendingSelfieTarget, setPendingSelfieTarget] = useState<number | null>(null);
  const [completionNotice, setCompletionNotice] = useState<{
    message: string;
    token: number;
  } | null>(null);
  const [prepActive, setPrepActive] = useState(false);
  const [prepCountdown, setPrepCountdown] = useState(PREP_DURATION_SECONDS);
  const [prepProgress, setPrepProgress] = useState(1);
  const promptSatisfiedRef = useRef(false);
  const promptRef = useRef<string | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const visionReadyRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentDeviceIdRef = useRef<string | null>(null);
  const startStreamTokenRef = useRef(0);
  const activeInitRef = useRef(false);
  const faceDetectedRef = useRef(false);
  const faceAlignedRef = useRef(false);
  const faceDetectorRef = useRef<any>(null);
  const faceDetectPendingRef = useRef(false);
  const faceDetectResultRef = useRef<
    | { minX: number; minY: number; maxX: number; maxY: number }
    | null
  >(null);
  const supportsImageOptionsRef = useRef<boolean | null>(null);
  const lastFaceSeenRef = useRef<number | null>(null);
  const lastYawRef = useRef<number | null>(null);
  const lastPitchRef = useRef<number | null>(null);
  const promptCaptureLatchRef = useRef(false);
  const countdownTimerRef = useRef<number | null>(null);
  const countdownTargetRef = useRef<"selfie" | null>(null);
  const countdownRafRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const completionTimerRef = useRef<number | null>(null);
  const pendingCompletionRef = useRef<string | null>(null);
  const selfieCloseTimerRef = useRef<number | null>(null);
  const selfieCountRef = useRef(0);
  const completionTriggeredRef = useRef(false);
  const prepTimerRef = useRef<number | null>(null);
  const prepRafRef = useRef<number | null>(null);
  const prepHasRunRef = useRef(false);
  const prepStartRef = useRef<number | null>(null);
  const lastTouchActionRef = useRef(0);
  const [debugInfo, setDebugInfo] = useState({
    detector: "none",
    faceDetected: false,
    faceDetectorAvailable: false,
    mediapipeReady: false,
    flip: false,
    cameraReady: false,
    permission: "unknown",
    lastSeenMs: null as number | null,
    imageOptions: "unknown",
    visionError: null as string | null,
  });
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightResults, setPreflightResults] = useState<
    {
      url: string;
      ok: boolean;
      status?: number;
      contentType?: string | null;
      contentLength?: string | null;
      error?: string | null;
    }[]
  >([]);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflightAt, setPreflightAt] = useState<string | null>(null);

  useEffect(() => {
    onChange?.(data);
  }, [data, onChange]);

  useEffect(() => {
    selfieCountRef.current = data.selfies.length;
  }, [data.selfies.length]);

  useEffect(() => {
    if (!initialValue) return;
    setData(buildInitialData(initialValue));
  }, [
    initialValue?.selfies,
    initialValue?.livenessPrompts,
    initialValue?.livenessStartedAt,
    initialValue?.motionFrames,
  ]);

  const updateData = useCallback(
    (updater: (prev: LivenessResult) => LivenessResult) => {
      setData((prev) => updater(prev));
    },
    []
  );

  const { selfies, motionFrames, livenessPrompts, livenessStartedAt } = data;

  const hasMotionProof = motionFrames.length >= 2;
  const selfieTotal = LIVENESS_PROMPTS.length;
  const selfieCount = selfies.length;
  const selfieStep = selfieCount >= selfieTotal ? "done" : "in-progress";
  const displaySelfieCount =
    pendingSelfieTarget && pendingSelfieTarget > selfieCount
      ? pendingSelfieTarget
      : selfieCount;
  const promptIndex = Math.min(
    displaySelfieCount,
    Math.max(0, selfieTotal - 1)
  );
  const activeSelfiePrompt =
    selfieStep === "done" ? null : livenessPrompts[promptIndex] || null;
  const selfiePreview1 = usePreviewUrl(selfies[0] ?? null);
  const selfiePreview2 = usePreviewUrl(selfies[1] ?? null);
  const selfiePreview3 = usePreviewUrl(selfies[2] ?? null);
  const selfiePreviews = [selfiePreview1, selfiePreview2, selfiePreview3];
  const promptDirection = useMemo(() => {
    const prompt = (activeSelfiePrompt || "").toLowerCase();
    if (prompt.includes("look left") || prompt.includes("head left")) return "left";
    if (prompt.includes("look right") || prompt.includes("head right")) return "right";
    return null;
  }, [activeSelfiePrompt]);
  const displayPromptDirection = useMemo(() => {
    if (!promptDirection) return null;
    if (!useFrontCamera) return promptDirection;
    if (promptDirection === "left") return "right";
    if (promptDirection === "right") return "left";
    return promptDirection;
  }, [promptDirection, useFrontCamera]);
  const promptDescriptor = useMemo(() => {
    const raw = (activeSelfiePrompt || livenessPrompts[0] || "").trim();
    const lower = raw.toLowerCase();
    let action = raw || "Follow the prompt below.";
    let key: "straight" | "left" | "right" | null = null;
    if (lower.includes("straight") || lower.includes("ahead")) {
      action = "Look straight ahead.";
      key = "straight";
    } else if (lower.includes("look left") || lower.includes("head left")) {
      action = "Look left.";
      key = "left";
    } else if (lower.includes("look right") || lower.includes("head right")) {
      action = "Look right.";
      key = "right";
    }
    return { raw, action, key };
  }, [activeSelfiePrompt, livenessPrompts]);
  const promptActionText = activeSelfiePrompt
    ? promptDescriptor.action
    : "Preparing liveness prompt...";
  const livenessButtonLabel =
    selfieCount >= selfieTotal ? "Retake" : selfieCount > 0 ? "Capture next" : "START";

  const supportsWebGL2 = typeof WebGL2RenderingContext !== "undefined";
  const supportsWasm = typeof WebAssembly !== "undefined";
  const showCameraEnable = !cameraReady && !cameraStarting;
  const cameraCtaLabel = cameraPermission === "granted" ? "Start camera" : "Enable camera";
  const cameraCtaHint =
    cameraPermission === "granted"
      ? "Camera access is allowed. Tap below to start the stream."
      : "We need camera access to continue. Tap below to allow access.";

  const formatVisionUrl = (value: string) => {
    if (!value) return "";
    const trimmed = value.replace(/^https?:\/\//i, "").replace(/^file:\/\//i, "file://");
    if (trimmed.length <= 46) return trimmed;
    return `${trimmed.slice(0, 24)}...${trimmed.slice(-14)}`;
  };
  const formatPreflightLine = (entry: { url: string; ok: boolean; status?: number }) => {
    const status = entry.status ? String(entry.status) : entry.ok ? "ok" : "fail";
    return `${status} ${formatVisionUrl(entry.url)}`;
  };

  const withTouchAction = useCallback(
    (action: () => void) => ({
      onClick: () => {
        if (Date.now() - lastTouchActionRef.current < 500) return;
        action();
      },
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerType !== "touch") return;
        event.preventDefault();
        event.stopPropagation();
        lastTouchActionRef.current = Date.now();
        action();
      },
      onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => {
        if (Date.now() - lastTouchActionRef.current < 500) return;
        event.preventDefault();
        event.stopPropagation();
        lastTouchActionRef.current = Date.now();
        action();
      },
    }),
    []
  );

  const stopStream = useCallback((invalidate = true) => {
    if (invalidate) {
      startStreamTokenRef.current += 1;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    currentDeviceIdRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setCameraDeviceLabel(null);
  }, []);

  const startStream = useCallback(async () => {
    if (!active) return;
    const token = startStreamTokenRef.current + 1;
    startStreamTokenRef.current = token;
    const isCurrent = () => startStreamTokenRef.current === token;
    setCameraError(null);
    stopStream(false);
    setCameraStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const secureHint = window.isSecureContext
          ? "Camera API is unavailable in this browser."
          : "Camera access requires HTTPS.";
        throw new Error(`${secureHint} Try Safari/Chrome (not an in-app browser).`);
      }
      const pickPreferredDeviceId = async (preferFront: boolean) => {
        if (!navigator.mediaDevices?.enumerateDevices) return null;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((device) => device.kind === "videoinput");
        if (!videoInputs.length) return null;
        const frontMatch = videoInputs.find((device) =>
          /front|user|face/i.test(device.label || "")
        );
        const backMatch = videoInputs.find((device) =>
          /back|rear|environment/i.test(device.label || "")
        );
        if (preferFront) {
          const picked = frontMatch || videoInputs[0];
          return picked?.deviceId || null;
        }
        if (backMatch?.deviceId) return backMatch.deviceId;
        const currentId = currentDeviceIdRef.current;
        if (currentId && videoInputs.length > 1) {
          const alternate = videoInputs.find((device) => device.deviceId !== currentId);
          if (alternate?.deviceId) return alternate.deviceId;
        }
        return videoInputs[videoInputs.length - 1]?.deviceId || null;
      };
      const preferredFacingMode = useFrontCamera ? "user" : "environment";
      const preferredDeviceId = await pickPreferredDeviceId(useFrontCamera);
      const baseVideo: any = {
        ...LIVENESS_VIDEO_CONSTRAINTS,
        advanced: LIVENESS_ADVANCED_CONSTRAINTS,
      };
      const attempts: MediaStreamConstraints[] = [
        ...(preferredDeviceId
          ? [
              {
                video: {
                  ...baseVideo,
                  deviceId: { exact: preferredDeviceId },
                },
                audio: false,
              },
            ]
          : []),
        {
          video: {
            ...baseVideo,
            facingMode: { exact: preferredFacingMode },
          },
          audio: false,
        },
        {
          video: {
            ...baseVideo,
            facingMode: preferredFacingMode,
          },
          audio: false,
        },
        { video: { facingMode: preferredFacingMode }, audio: false },
        ...(useFrontCamera ? [{ video: true, audio: false }] : []),
      ];

      const waitForVideo = async () => {
        if (!videoRef.current) return false;
        const start = Date.now();
        const timeout = useFrontCamera ? 1600 : 2800;
        while (Date.now() - start < timeout) {
          if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
            return true;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
        return false;
      };

      let lastError: unknown;
      for (const constraints of attempts) {
        if (!isCurrent()) return;
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (!isCurrent()) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          streamRef.current = stream;
          const track = stream.getVideoTracks()[0];
          const trackLabel = track?.label;
          const settingsDeviceId = track?.getSettings?.().deviceId || null;
          currentDeviceIdRef.current = settingsDeviceId;
          setCameraDeviceLabel(trackLabel || null);
          if (track?.applyConstraints) {
            try {
              await track.applyConstraints({ advanced: LIVENESS_ADVANCED_CONSTRAINTS } as any);
            } catch {
              // ignore unsupported constraint errors
            }
          }
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.muted = true;
            videoRef.current.autoplay = true;
            videoRef.current.playsInline = true;
            videoRef.current.setAttribute("playsinline", "true");
            videoRef.current.setAttribute("webkit-playsinline", "true");
            videoRef.current.onloadedmetadata = () => {
              if (videoRef.current?.videoWidth) {
                setCameraReady(true);
                setCameraStarting(false);
              }
            };
            videoRef.current.onplaying = () => {
              setCameraReady(true);
              setCameraStarting(false);
            };
            try {
              await videoRef.current.play();
            } catch {
              // ignore autoplay errors; we check dimensions below
            }
          }
          const ready = await waitForVideo();
          if (!isCurrent()) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          if (ready) {
            setCameraReady(true);
            setCameraStarting(false);
            return;
          }
          lastError = new Error("Camera stream started but no frames were delivered.");
          stopStream();
        } catch (err) {
          lastError = err;
          if (isCurrent()) {
            stopStream();
          }
        }
      }

      throw lastError || new Error("Unable to start the camera.");
    } catch (err: any) {
      if (!isCurrent()) return;
      setCameraError(err?.message || "Camera access was denied.");
      setCameraStarting(false);
      stopStream();
    }
  }, [active, stopStream, useFrontCamera]);

  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (countdownRafRef.current) {
      window.cancelAnimationFrame(countdownRafRef.current);
      countdownRafRef.current = null;
    }
    countdownTargetRef.current = null;
    setCountdownTarget(null);
    setCountdown(null);
    setCountdownProgress(1);
  }, []);

  const triggerCaptureFlash = useCallback(() => {
    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setCaptureFlash(true);
    flashTimerRef.current = window.setTimeout(() => {
      setCaptureFlash(false);
      flashTimerRef.current = null;
    }, 1000);
  }, []);

  const triggerCompletionNotice = useCallback((message: string, durationMs = 1200) => {
    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    setCompletionNotice({ message, token: Date.now() });
    completionTimerRef.current = window.setTimeout(() => {
      setCompletionNotice(null);
      completionTimerRef.current = null;
    }, durationMs);
  }, []);
  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (selfieCount >= selfieTotal) return;
    const currentCount = selfieCountRef.current;
    const nextCount = Math.min(currentCount + 1, selfieTotal);
    setPendingSelfieTarget(nextCount);
    const pendingMessage = pendingCompletionRef.current;
    pendingCompletionRef.current = null;
    if (!pendingMessage) {
      triggerCaptureFlash();
    }
    const canvas = document.createElement("canvas");
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", LIVENESS_SELFIE_QUALITY)
    );
    if (!blob) return;
    const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
    const startedAt = livenessStartedAt || new Date().toISOString();
    updateData((prev) => {
      if (prev.selfies.length >= selfieTotal) return prev;
      const mergedPrompts = hasPromptOrder(prev.livenessPrompts)
        ? prev.livenessPrompts
        : getPromptSequence(LIVENESS_PROMPTS);
      return {
        ...prev,
        selfies: [...prev.selfies, file],
        livenessPrompts: mergedPrompts,
        livenessStartedAt: prev.livenessStartedAt || startedAt,
      };
    });
  }, [
    livenessStartedAt,
    selfieCount,
    selfieTotal,
    triggerCaptureFlash,
    updateData,
  ]);

  const startCountdown = useCallback(() => {
    if (countdownTimerRef.current && countdownTargetRef.current === "selfie") {
      return;
    }
    cancelCountdown();
    countdownTargetRef.current = "selfie";
    setCountdownTarget("selfie");
    const durationSeconds = SELFIE_COUNTDOWN_SECONDS;
    const startAt = performance.now();
    setCountdown(durationSeconds);
    setCountdownProgress(1);
    const currentCount = selfieCountRef.current;
    const tick = (now: number) => {
      const elapsed = now - startAt;
      const remainingMs = Math.max(0, durationSeconds * 1000 - elapsed);
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const withinSecond = remainingMs % 1000;
      setCountdown(remainingSeconds === 0 ? 0 : remainingSeconds);
      const perSecondProgress =
        withinSecond === 0 && remainingMs > 0 ? 1 : withinSecond / 1000;
      setCountdownProgress(perSecondProgress);
      if (remainingMs <= 0) {
        cancelCountdown();
        if (active) {
          if (currentCount < selfieTotal) {
            const nextCount = Math.min(currentCount + 1, selfieTotal);
            setPendingSelfieTarget(nextCount);
            triggerCaptureFlash();
            void captureFrame();
          }
        }
        return;
      }
      countdownRafRef.current = window.requestAnimationFrame(tick);
    };
    countdownRafRef.current = window.requestAnimationFrame(tick);
  }, [
    active,
    cancelCountdown,
    captureFrame,
    selfieTotal,
    triggerCaptureFlash,
  ]);

  const captureMotionProof = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setMotionStatus("capturing");
    setMotionError(null);
    const frames: File[] = [];
    const captureSnapshot = async (index: number) => {
      const canvas = document.createElement("canvas");
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", LIVENESS_MOTION_QUALITY)
      );
      if (!blob) return;
      frames.push(
        new File([blob], `selfieMotion${index + 1}.jpg`, { type: "image/jpeg" })
      );
    };

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await captureSnapshot(i);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }

    if (frames.length >= 2) {
      updateData((prev) => ({ ...prev, motionFrames: frames }));
      setMotionStatus("done");
      setMotionError(null);
    } else {
      updateData((prev) => ({ ...prev, motionFrames: [] }));
      setMotionStatus("error");
      setMotionError("Unable to capture motion proof. Please try again.");
    }
  }, [updateData]);

  const runPreflight = useCallback(async () => {
    if (preflightRunning) return;
    setPreflightRunning(true);
    setPreflightError(null);
    const results: {
      url: string;
      ok: boolean;
      status?: number;
      contentType?: string | null;
      contentLength?: string | null;
      error?: string | null;
    }[] = [];
    const fetchInfo = async (url: string) => {
      try {
        let res: Response | null = null;
        try {
          res = await fetch(url, { method: "HEAD", cache: "no-store" });
        } catch {
          res = null;
        }
        if (!res || !res.ok) {
          try {
            res = await fetch(url, {
              method: "GET",
              headers: { Range: "bytes=0-0" },
              cache: "no-store",
            });
          } catch (err: any) {
            results.push({ url, ok: false, error: err?.message || "Fetch failed" });
            return;
          }
        }
        results.push({
          url,
          ok: res.ok,
          status: res.status,
          contentType: res.headers.get("content-type"),
          contentLength: res.headers.get("content-length"),
        });
      } catch (err: any) {
        results.push({ url, ok: false, error: err?.message || "Fetch failed" });
      }
    };
    try {
      const wasmBase = visionAttempt?.wasmUrl || VISION_WASM_URLS.find(Boolean) || "";
      const modelUrl = visionAttempt?.modelUrl || FACE_MODEL_URLS.find(Boolean) || "";
      const urls = new Set<string>();
      const baseTrimmed = String(wasmBase || "").trim().replace(/\/+$/, "");
      if (baseTrimmed) {
        if (/\.(js|wasm)$/i.test(baseTrimmed)) {
          urls.add(baseTrimmed);
        } else {
          [
            "vision_wasm_internal.js",
            "vision_wasm_internal.wasm",
            "vision_wasm_nosimd_internal.js",
            "vision_wasm_nosimd_internal.wasm",
          ].forEach((name) => urls.add(`${baseTrimmed}/${name}`));
        }
      }
      if (modelUrl) urls.add(modelUrl);
      for (const url of urls) {
        // eslint-disable-next-line no-await-in-loop
        await fetchInfo(url);
      }
      setPreflightResults(results);
      setPreflightAt(new Date().toISOString());
    } catch (err: any) {
      setPreflightError(err?.message || "Preflight failed");
      setPreflightResults(results);
    } finally {
      setPreflightRunning(false);
    }
  }, [preflightRunning, visionAttempt]);

  const startLivenessImmediate = useCallback(() => {
    setCompletionNotice(null);
    updateData((prev) => {
      const prompts = hasPromptOrder(prev.livenessPrompts)
        ? prev.livenessPrompts
        : getPromptSequence(LIVENESS_PROMPTS);
      return {
        ...prev,
        livenessPrompts: prompts,
        livenessStartedAt: prev.livenessStartedAt || new Date().toISOString(),
      };
    });
    setActive(true);
  }, [updateData]);

  const cancelPrep = useCallback(() => {
    if (prepTimerRef.current) {
      window.clearInterval(prepTimerRef.current);
      prepTimerRef.current = null;
    }
    if (prepRafRef.current) {
      window.cancelAnimationFrame(prepRafRef.current);
      prepRafRef.current = null;
    }
    prepStartRef.current = null;
    setPrepActive(false);
    setPrepCountdown(PREP_DURATION_SECONDS);
    setPrepProgress(1);
  }, []);

  const startPrep = useCallback(() => {
    cancelPrep();
    setPrepActive(true);
    setPrepCountdown(PREP_DURATION_SECONDS);
    setPrepProgress(1);
    const durationMs = PREP_DURATION_SECONDS * 1000;
    const start = performance.now();
    prepStartRef.current = start;
    const tick = (now: number) => {
      const elapsed = now - start;
      const remaining = Math.max(0, durationMs - elapsed);
      const remainingSeconds = Math.ceil(remaining / 1000);
      setPrepCountdown(remainingSeconds);
      setPrepProgress(Math.max(0, remaining / durationMs));
      if (remaining <= 0) {
        prepHasRunRef.current = true;
        setPrepActive(false);
        startLivenessImmediate();
        return;
      }
      prepRafRef.current = window.requestAnimationFrame(tick);
    };
    prepRafRef.current = window.requestAnimationFrame(tick);
  }, [cancelPrep, startLivenessImmediate]);

  const resetLiveness = useCallback(() => {
    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    if (selfieCloseTimerRef.current) {
      window.clearTimeout(selfieCloseTimerRef.current);
      selfieCloseTimerRef.current = null;
    }
    cancelCountdown();
    cancelPrep();
    setPendingSelfieTarget(null);
    setCompletionNotice(null);
    completionTriggeredRef.current = false;
    prepHasRunRef.current = false;
    updateData(() => ({ ...DEFAULT_DATA }));
    setMotionStatus("idle");
    setMotionError(null);
    setManualOverride(false);
    setPromptSatisfied(false);
    promptSatisfiedRef.current = false;
    setFaceDetected(false);
    setFaceAligned(false);
  }, [cancelCountdown, cancelPrep, updateData]);

  const startLiveness = useCallback(() => {
    if (selfieCountRef.current >= selfieTotal) {
      resetLiveness();
    }
    if (prepActive) return;
    if (prepHasRunRef.current || selfieCountRef.current > 0) {
      startLivenessImmediate();
      return;
    }
    startPrep();
  }, [prepActive, resetLiveness, selfieTotal, startLivenessImmediate, startPrep]);
  useEffect(() => {
    if (!autoStart) return;
    if (active || prepActive) return;
    if (selfieCountRef.current > 0) return;
    if (livenessStartedAt) return;
    startPrep();
  }, [active, autoStart, livenessStartedAt, prepActive, startPrep]);

  useEffect(() => {
    promptRef.current = activeSelfiePrompt || null;
    promptSatisfiedRef.current = false;
    promptCaptureLatchRef.current = false;
    setPromptSatisfied(false);
    setFaceAligned(false);
  }, [activeSelfiePrompt]);

  useEffect(() => {
    if (active && prepActive) {
      setPrepActive(false);
    }
  }, [active, prepActive]);

  useEffect(() => {
    faceDetectedRef.current = faceDetected;
    faceAlignedRef.current = faceAligned;
  }, [faceDetected, faceAligned]);

  useEffect(() => {
    if (!active) {
      activeInitRef.current = false;
      setCameraStarting(false);
      setPendingSelfieTarget(null);
      stopStream();
      return;
    }
    const wasActive = activeInitRef.current;
    activeInitRef.current = true;
    setCameraReady(false);
    setManualOverride(false);
    if (!wasActive) {
      setUseFrontCamera(true);
    }
    void startStream();
    return () => stopStream();
  }, [active, startStream, stopStream]);

  useEffect(() => {
    if (!active) return;
    if (hasPromptOrder(livenessPrompts)) return;
    updateData((prev) => ({
      ...prev,
      livenessPrompts: getPromptSequence(LIVENESS_PROMPTS),
      livenessStartedAt: prev.livenessStartedAt || new Date().toISOString(),
    }));
  }, [active, livenessPrompts, updateData]);

  useEffect(() => {
    if (pendingSelfieTarget === null) return;
    if (selfieCount >= pendingSelfieTarget) {
      setPendingSelfieTarget(null);
    }
  }, [pendingSelfieTarget, selfieCount]);

  useEffect(() => {
    if (!active) {
      completionTriggeredRef.current = false;
      return;
    }
    if (completionTriggeredRef.current) return;
    if (selfies.length < selfieTotal) return;
    completionTriggeredRef.current = true;
    setPendingSelfieTarget(null);
    const duration = 1500;
    triggerCompletionNotice("Congratulations", duration);
    if (selfieCloseTimerRef.current) {
      window.clearTimeout(selfieCloseTimerRef.current);
      selfieCloseTimerRef.current = null;
    }
    selfieCloseTimerRef.current = window.setTimeout(() => {
      selfieCloseTimerRef.current = null;
      restoreDocumentInteractivity();
      setActive(false);
    }, 900);
    onComplete?.(data);
  }, [active, data, onComplete, selfieTotal, selfies.length, triggerCompletionNotice]);

  useEffect(() => {
    if (!active) return;
    if (!navigator.permissions?.query) {
      setCameraPermission("unknown");
      return;
    }
    let cancelled = false;
    const queryPermission = async () => {
      try {
        const status = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        if (cancelled) return;
        setCameraPermission(status.state as any);
        if (status.state === "granted") {
          void startStream();
        }
        status.onchange = () => {
          if (cancelled) return;
          setCameraPermission(status.state as any);
          if (status.state === "granted") {
            void startStream();
          }
        };
      } catch {
        setCameraPermission("unknown");
      }
    };
    void queryPermission();
    return () => {
      cancelled = true;
    };
  }, [active, startStream]);

  useEffect(() => {
    if (!active) return;
    if (cameraPermission === "granted" && !cameraReady) {
      void startStream();
      return;
    }
    if (!cameraReady) {
      window.setTimeout(() => {
        if (!cameraReady) {
          void startStream();
        }
      }, 250);
    }
  }, [active, cameraPermission, cameraReady, startStream]);


  useEffect(() => {
    return () => cancelCountdown();
  }, [cancelCountdown]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
      if (completionTimerRef.current) {
        window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      if (selfieCloseTimerRef.current) {
        window.clearTimeout(selfieCloseTimerRef.current);
        selfieCloseTimerRef.current = null;
      }
      cancelPrep();
      restoreDocumentInteractivity();
    };
  }, [cancelPrep]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const VISION_TIMEOUT_MS = 12000;
    const withTimeout = async <T,>(promise: Promise<T>, label: string) => {
      let timer: number | null = null;
      try {
        const timeout = new Promise<T>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error(`${label} timed out after ${VISION_TIMEOUT_MS}ms.`)),
            VISION_TIMEOUT_MS
          );
        });
        return await Promise.race([promise, timeout]);
      } finally {
        if (timer) window.clearTimeout(timer);
      }
    };
    const initVision = async () => {
      if (visionReadyRef.current || landmarkerRef.current) {
        setVisionStatus("ready");
        return;
      }
      try {
        const vision = await loadTasksVision();
        setVisionStatus("loading");
        setVisionError(null);
        setVisionAttemptIndex(0);
        setVisionAttemptTotal(VISION_WASM_URLS.length * FACE_MODEL_URLS.length);
        setVisionDelegate(null);
        let landmarker: FaceLandmarker | null = null;
        let lastError: unknown;
        let attempt = 0;
        const preferredDelegate: "GPU" | "CPU" = supportsWebGL2 ? "GPU" : "CPU";
        for (const wasmUrl of VISION_WASM_URLS) {
          for (const modelUrl of FACE_MODEL_URLS) {
            try {
              attempt += 1;
              setVisionAttempt({ wasmUrl, modelUrl });
              setVisionAttemptIndex(attempt);
              const resolver = await withTimeout(
                vision.FilesetResolver.forVisionTasks(wasmUrl),
                `WASM init (${wasmUrl})`
              );
              const buildOptions = (
                delegate: "GPU" | "CPU"
              ): FaceLandmarkerOptions => ({
                baseOptions: { modelAssetPath: modelUrl, delegate },
                runningMode: "VIDEO",
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: false,
                numFaces: 1,
                minFaceDetectionConfidence: 0.1,
                minFacePresenceConfidence: 0.1,
                minTrackingConfidence: 0.1,
              });
              try {
                landmarker = await withTimeout(
                  vision.FaceLandmarker.createFromOptions(
                    resolver,
                    buildOptions(preferredDelegate)
                  ),
                  `Model load (${modelUrl}) [${preferredDelegate}]`
                );
                setVisionDelegate(preferredDelegate);
              } catch (err) {
                lastError = err;
                if (preferredDelegate === "GPU") {
                  landmarker = await withTimeout(
                    vision.FaceLandmarker.createFromOptions(
                      resolver,
                      buildOptions("CPU")
                    ),
                    `Model load (${modelUrl}) [CPU]`
                  );
                  setVisionDelegate("CPU");
                } else {
                  throw err;
                }
              }
              break;
            } catch (err) {
              lastError = err;
            }
          }
          if (landmarker) break;
        }
        if (!landmarker) {
          throw lastError || new Error("Unable to load face model.");
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        visionReadyRef.current = true;
        setVisionStatus("ready");
      } catch (err: any) {
        const message = err?.message || "Unable to start liveness detection.";
        setVisionError(
          `${message} Tried models: ${FACE_MODEL_URLS.join(" | ")} | WASM: ${VISION_WASM_URLS.join(
            " | "
          )}`
        );
        setVisionStatus("error");
        // eslint-disable-next-line no-console
        ageVerifyError("face model load failed", err);
      }
    };
    void initVision();
    return () => {
      cancelled = true;
    };
  }, [active, supportsWebGL2]);

  useEffect(() => {
    if (!active) {
      setFaceDetected(false);
      return;
    }
    let raf = 0;
    const analyze = () => {
      const landmarker = landmarkerRef.current;
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || video.readyState < 2) {
        raf = window.requestAnimationFrame(analyze);
        return;
      }
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      if (faceDetectorRef.current && !faceDetectPendingRef.current) {
        faceDetectPendingRef.current = true;
        faceDetectorRef.current
          .detect(video)
          .then((faces: any[]) => {
            const face = faces?.[0];
            const box = face?.boundingBox;
            if (box) {
              faceDetectResultRef.current = {
                minX: Math.max(0, box.x / w),
                minY: Math.max(0, box.y / h),
                maxX: Math.min(1, (box.x + box.width) / w),
                maxY: Math.min(1, (box.y + box.height) / h),
              };
            } else {
              faceDetectResultRef.current = null;
            }
          })
          .catch(() => {
            faceDetectResultRef.current = null;
          })
          .finally(() => {
            faceDetectPendingRef.current = false;
          });
      }
      if (overlay) {
        const ctx = overlay.getContext("2d");
        if (overlay.width !== w) overlay.width = w;
        if (overlay.height !== h) overlay.height = h;
        if (ctx) ctx.clearRect(0, 0, w, h);
      }
      if (!landmarker) {
        const fallbackBox = faceDetectResultRef.current;
        const hasFallback = Boolean(fallbackBox);
        if (faceDetectedRef.current !== hasFallback) {
          setFaceDetected(hasFallback);
        }
        if (fallbackBox) {
          if (!faceAlignedRef.current) setFaceAligned(true);
        } else if (faceAlignedRef.current) {
          setFaceAligned(false);
        }
        raf = window.requestAnimationFrame(analyze);
        return;
      }
      const now = performance.now();
      let result: FaceLandmarkerResult | null = null;
      try {
        if (supportsImageOptionsRef.current !== false) {
          try {
            result = (landmarker as any).detectForVideo(video, now, {
              imageProcessingOptions: {
                rotationDegrees: 0,
                flipHorizontal: useFrontCamera,
              },
            });
            if (supportsImageOptionsRef.current === null) {
              supportsImageOptionsRef.current = true;
            }
          } catch {
            supportsImageOptionsRef.current = false;
            result = landmarker.detectForVideo(video, now);
          }
        } else {
          result = landmarker.detectForVideo(video, now);
        }
      } catch {
        result = null;
      }
      const landmarks = result?.faceLandmarks?.[0];
      const fallbackBox = faceDetectResultRef.current;
      let yaw = 0;
      let pitch = 0;

      let faceBox = null as
        | { minX: number; minY: number; maxX: number; maxY: number }
        | null;
      if (landmarks) {
        let minX = 1;
        let minY = 1;
        let maxX = 0;
        let maxY = 0;
        for (const point of landmarks) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
        faceBox = { minX, minY, maxX, maxY };

        const leftEye = landmarks[LANDMARK_INDEX.LEFT_EYE_OUTER];
        const rightEye = landmarks[LANDMARK_INDEX.RIGHT_EYE_OUTER];
        const nose = landmarks[LANDMARK_INDEX.NOSE_TIP];
        const eyeMidX = (leftEye.x + rightEye.x) / 2;
        const eyeMidY = (leftEye.y + rightEye.y) / 2;
        const eyeWidth = Math.max(0.0001, rightEye.x - leftEye.x);
        yaw = (nose.x - eyeMidX) / eyeWidth;
        const chin = landmarks[LANDMARK_INDEX.CHIN] || landmarks[LANDMARK_INDEX.MOUTH_LOWER];
        const verticalSpan = Math.max(0.0001, (chin?.y ?? 0) - eyeMidY);
        pitch = (nose.y - eyeMidY) / verticalSpan;

      }
      if (!landmarks && fallbackBox) {
        faceBox = fallbackBox;
      }

      const hasFace = Boolean((landmarks && landmarks.length) || faceBox);
      const isFaceFramed = (box: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      }) => {
        const margin = 0.08;
        const width = box.maxX - box.minX;
        const height = box.maxY - box.minY;
        return (
          box.minX >= margin &&
          box.minY >= margin &&
          box.maxX <= 1 - margin &&
          box.maxY <= 1 - margin &&
          width >= 0.22 &&
          height >= 0.28
        );
      };
      const framedFace = Boolean(faceBox && isFaceFramed(faceBox));
      const faceActive = hasFace && framedFace;
      setFaceDetected(faceActive);
      if (faceActive) {
        lastFaceSeenRef.current = Date.now();
      }

      if (faceAligned !== faceActive) {
        setFaceAligned(faceActive);
      }

      if (!faceActive) {
        lastYawRef.current = null;
        lastPitchRef.current = null;
      }

      const prompt = (promptRef.current || "").toLowerCase();
      // Rear camera feed is not mirrored either, so we invert yaw for both cameras
      // to map user-left/right to prompt-left/right.
      const yawForPrompt = -yaw;
      let satisfied = false;
      if (prompt.includes("straight") || prompt.includes("ahead")) {
        satisfied = Math.abs(yawForPrompt) < 0.05 && pitch > 0.35 && pitch < 0.58;
      } else if (prompt.includes("look left") || prompt.includes("head left")) {
        satisfied = yawForPrompt < -0.08;
      } else if (prompt.includes("look right") || prompt.includes("head right")) {
        satisfied = yawForPrompt > 0.08;
      }

      if (promptSatisfiedRef.current !== satisfied) {
        promptSatisfiedRef.current = satisfied;
        setPromptSatisfied(satisfied);
      }

      const canAutoCapture =
        selfieStep !== "done" &&
        (allowAutoCaptureWithoutMotion ||
          hasMotionProof ||
          motionStatus === "idle" ||
          motionStatus === "capturing" ||
          motionStatus === "done") &&
        faceActive &&
        satisfied;
      if (canAutoCapture && !promptCaptureLatchRef.current) {
        promptCaptureLatchRef.current = true;
        startCountdown();
      } else if (!canAutoCapture && countdownTargetRef.current === "selfie") {
        cancelCountdown();
      }
      if (!satisfied) {
        promptCaptureLatchRef.current = false;
      }

      if (faceActive) {
        const lastYaw = lastYawRef.current;
        const lastPitch = lastPitchRef.current;
        if (lastYaw !== null && lastPitch !== null) {
          const moved =
            Math.abs(yaw - lastYaw) > 0.08 || Math.abs(pitch - lastPitch) > 0.08;
          if (moved) {
            // reserved for future motion detection
          }
        }
        lastYawRef.current = yaw;
        lastPitchRef.current = pitch;
      }
      raf = window.requestAnimationFrame(analyze);
    };
    raf = window.requestAnimationFrame(analyze);
    return () => window.cancelAnimationFrame(raf);
  }, [
    active,
    allowAutoCaptureWithoutMotion,
    cancelCountdown,
    faceAligned,
    hasMotionProof,
    motionStatus,
    selfieStep,
    startCountdown,
    useFrontCamera,
  ]);

  useEffect(() => {
    if (!active) {
      faceDetectorRef.current = null;
      faceDetectPendingRef.current = false;
      faceDetectResultRef.current = null;
      return;
    }
    const DetectorCtor = (window as any).FaceDetector;
    if (!DetectorCtor) {
      faceDetectorRef.current = null;
      return;
    }
    try {
      faceDetectorRef.current = new DetectorCtor({
        fastMode: true,
        maxDetectedFaces: 1,
      });
    } catch {
      faceDetectorRef.current = null;
    }
    return () => {
      faceDetectorRef.current = null;
      faceDetectPendingRef.current = false;
      faceDetectResultRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!debug) return;
    if (!active) return;
    const update = () => {
      const detector = visionReadyRef.current
        ? "mediapipe"
        : faceDetectorRef.current
        ? "face-detector"
        : "none";
      setDebugInfo({
        detector,
        faceDetected,
        faceDetectorAvailable: Boolean(faceDetectorRef.current),
        mediapipeReady: Boolean(visionReadyRef.current),
        flip: useFrontCamera,
        cameraReady,
        permission: cameraPermission,
        lastSeenMs: lastFaceSeenRef.current,
        imageOptions:
          supportsImageOptionsRef.current === null
            ? "unknown"
            : supportsImageOptionsRef.current
            ? "yes"
            : "no",
        visionError: visionError ? visionError.slice(0, 140) : null,
      });
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [
    active,
    cameraReady,
    cameraPermission,
    debug,
    faceDetected,
    useFrontCamera,
    visionError,
  ]);

  useEffect(() => {
    if (!active) return;
    if (motionStatus !== "idle" || hasMotionProof) return;
    if (!cameraReady) return;
    const timer = window.setTimeout(() => {
      void captureMotionProof();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [active, motionStatus, hasMotionProof, cameraReady, captureMotionProof]);

  const completionIsFinal = completionNotice?.message === "Congratulations";
  const confettiPieces = useMemo(() => {
    if (!completionNotice) return [];
    const isFinal = completionNotice.message === "Congratulations";
    const count = isFinal ? 130 : 50;
    const spread = isFinal ? 320 : 200;
    const colors = [
      "#38bdf8",
      "#22c55e",
      "#f97316",
      "#f59e0b",
      "#a855f7",
      "#ef4444",
      "#14b8a6",
      "#eab308",
      "#fb7185",
      "#7c3aed",
    ];
    return Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const distance = spread * (0.45 + Math.random() * 0.65);
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const rotation = Math.random() * 720 - 360;
      const delay = Math.random() * (isFinal ? 100 : 140);
      const duration = isFinal ? 1800 + Math.random() * 250 : 1500 + Math.random() * 250;
      const size = 6 + Math.random() * (isFinal ? 10 : 6);
      const height = size * (1.4 + Math.random() * 1.1);
      const scale = 0.95 + Math.random() * (isFinal ? 0.9 : 0.6);
      const color = colors[Math.floor(Math.random() * colors.length)];
      return {
        style: {
          "--x": `${x.toFixed(1)}px`,
          "--y": `${y.toFixed(1)}px`,
          "--rot": `${rotation.toFixed(1)}deg`,
          "--delay": `${delay.toFixed(0)}ms`,
          "--dur": `${duration.toFixed(0)}ms`,
          "--w": `${size.toFixed(1)}px`,
          "--h": `${height.toFixed(1)}px`,
          "--scale": `${scale.toFixed(2)}`,
          "--color": color,
        } as CSSProperties,
      };
    });
  }, [completionNotice?.message, completionNotice?.token]);

  return (
    <div className={`liveness-module${className ? ` ${className}` : ""}`}>
      <div className="capture-grid">
        <div className="capture-card">
          <div>
            <strong>Human Detection</strong>
            <p>Records Live Motion to Verify Validity</p>
          </div>
          <div className="capture-dual">
            {selfiePreviews.map((preview, index) =>
              preview ? (
                <img
                  className="capture-preview"
                  src={preview}
                  alt={`Selfie ${index + 1}`}
                  key={index}
                />
              ) : (
                <div className="capture-placeholder" key={index}>
                  Selfie {index + 1}
                </div>
              )
            )}
          </div>
          <div className="capture-actions">
            <button className="btn ghost" type="button" onClick={startLiveness}>
              {livenessButtonLabel}
            </button>
            {selfieCount > 0 && (
              <button className="btn ghost" type="button" onClick={resetLiveness}>
                Clear
              </button>
            )}
          </div>
          <div className="liveness-status">
            <span>
              Human Detection:{" "}
              {motionStatus === "done"
                ? "Captured"
                : motionStatus === "capturing"
                ? "Capturing..."
                : motionStatus === "error"
                ? "Failed"
                : "Not started"}
            </span>
            {!hasMotionProof && (
              <span className="liveness-note">
                Uses Your Camera to Record Motion.
              </span>
            )}
          </div>
          {activeSelfiePrompt && selfieStep !== "done" && (
            <p className="liveness-hint">
              Prompt {Math.min(displaySelfieCount + 1, selfieTotal)} of {selfieTotal}:{" "}
              {activeSelfiePrompt}
            </p>
          )}
          {motionError && <p className="error">{motionError}</p>}
        </div>
      </div>

      {prepActive && !active && (
        <div className="prep-screen" role="dialog" aria-modal="true">
          <div className="prep-card">
            <div className="prep-glow" aria-hidden="true" />
            <p className="prep-eyebrow">Warm up</p>
            <div className="prep-emoji" aria-hidden="true">
              😄
            </div>
            <h2 className="prep-title">Get Ready To Smile</h2>
            <p className="prep-sub">
              Setting up the camera and liveness checks. Hold steady for the countdown.
            </p>
            <div
              className="prep-ring"
              style={{ "--progress": prepProgress } as CSSProperties}
            >
              <div className="prep-countdown">{prepCountdown}</div>
            </div>
            <div className="prep-tip">We’ll start automatically.</div>
          </div>
        </div>
      )}

      {active && (
        <div className="camera-overlay fullscreen" role="dialog" aria-modal="true">
          <div className="camera-panel camera-modal">
            {captureFlash && <div className="capture-flash" aria-hidden="true" />}
            <div className={`camera-frame ${cameraReady ? "ready" : ""}`}>
              <video ref={videoRef} playsInline muted autoPlay className="camera-video" />
              <canvas ref={overlayRef} className="camera-overlay-canvas" />
              {countdown !== null && countdownTarget === "selfie" && (
                <div
                  className="countdown-ring"
                  style={{ "--progress": countdownProgress } as CSSProperties}
                >
                  <div className="countdown-ring-inner">{countdown}</div>
                </div>
              )}
              {completionNotice && (
                <div
                  className={`completion-burst ${
                    completionIsFinal ? "completion-final" : "completion-complete"
                  }`}
                  key={completionNotice.token}
                >
                  <div className="completion-ring">
                    <div className="completion-ring-inner">
                      {completionIsFinal ? (
                        <span className="completion-final-label">
                        <span className="completion-emoji">👍</span>
                        </span>
                      ) : (
                        completionNotice.message
                      )}
                    </div>
                  </div>
                  <div className={`confetti${completionIsFinal ? " confetti-explosion" : ""}`}>
                    {confettiPieces.map((piece, index) => (
                      <span className="confetti-piece" key={index} style={piece.style} />
                    ))}
                  </div>
                </div>
              )}
              {motionStatus !== "done" && displayPromptDirection && (
                <div className={`prompt-arrow ${displayPromptDirection}`}>
                  {displayPromptDirection === "left" && "←"}
                  {displayPromptDirection === "right" && "→"}
                </div>
              )}
            </div>

            <div className="liveness-prompt-ui">
              <div className="motion-panel">
                <span
                  className={
                    manualOverride
                      ? "face-override"
                      : faceDetected
                      ? "face-ok"
                      : "face-miss"
                  }
                >
                  {manualOverride
                    ? "Manual override enabled"
                    : faceDetected
                    ? "Face Detected"
                    : "Face Not Detected"}
                </span>
              </div>
              <div className="prompt-banner liveness">
                <div className="prompt-title">Liveness prompt</div>
                {selfieStep !== "done" && (
                  <div className="prompt-progress">
                    Prompt {Math.min(displaySelfieCount + 1, selfieTotal)} of {selfieTotal}
                  </div>
                )}
                <div className="prompt-action">{promptActionText}</div>
                <div
                  className={`prompt-status ${
                    faceDetected && promptSatisfied ? "prompt-ok" : "prompt-wait"
                  }`}
                >
                  {!faceDetected
                    ? "Center your face in the frame."
                    : promptSatisfied
                    ? "Prompt satisfied"
                    : "Waiting for action"}
                </div>
              </div>
            </div>

            {debug && (
              <div className="debug-badge dev-debug-output">
                <div>Detector: {debugInfo.detector}</div>
                <div>Face: {debugInfo.faceDetected ? "yes" : "no"}</div>
                <div>MediaPipe ready: {debugInfo.mediapipeReady ? "yes" : "no"}</div>
                <div>FaceDetector: {debugInfo.faceDetectorAvailable ? "yes" : "no"}</div>
                <div>Flip: {debugInfo.flip ? "front" : "rear"}</div>
                <div>Camera: {debugInfo.cameraReady ? "ready" : "not ready"}</div>
                <div>Permission: {debugInfo.permission}</div>
                <div>Vision: {visionStatus}</div>
                {visionAttemptTotal > 0 && (
                  <div>
                    Vision attempt: {Math.min(visionAttemptIndex, visionAttemptTotal)}/
                    {visionAttemptTotal}
                  </div>
                )}
                {visionDelegate && <div>Delegate: {visionDelegate}</div>}
                <div>WebGL2: {supportsWebGL2 ? "yes" : "no"}</div>
                <div>WASM: {supportsWasm ? "yes" : "no"}</div>
                {visionAttempt && (
                  <div>
                    Vision try: {formatVisionUrl(visionAttempt.wasmUrl)} |{" "}
                    {formatVisionUrl(visionAttempt.modelUrl)}
                  </div>
                )}
                <div className="debug-actions">
                  <button
                    className="debug-button"
                    type="button"
                    onClick={runPreflight}
                    disabled={preflightRunning}
                  >
                    {preflightRunning ? "Preflight..." : "Preflight check"}
                  </button>
                  {preflightAt && (
                    <span className="debug-meta">
                      {new Date(preflightAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {preflightError && <div>Preflight error: {preflightError}</div>}
                {preflightResults.length > 0 && (
                  <div className="debug-preflight">
                    {preflightResults.map((entry, index) => (
                      <div key={`${entry.url}-${index}`}>
                        {formatPreflightLine(entry)}
                        {entry.contentType ? ` (${entry.contentType})` : ""}
                        {entry.error ? ` - ${entry.error}` : ""}
                      </div>
                    ))}
                  </div>
                )}
                <div>Camera device: {cameraDeviceLabel || "unknown"}</div>
                <div>
                  Last seen:{" "}
                  {debugInfo.lastSeenMs
                    ? `${Math.max(0, Date.now() - debugInfo.lastSeenMs)}ms ago`
                    : "never"}
                </div>
                <div>Image opts: {debugInfo.imageOptions}</div>
                {debugInfo.visionError && <div>Vision error: {debugInfo.visionError}</div>}
              </div>
            )}

            {showCameraEnable && (
              <div className="camera-permission">
                <div className="camera-permission-card">
                  <strong>{cameraCtaLabel}</strong>
                  <p>{cameraCtaHint}</p>
                  {cameraError && <p className="error">{cameraError}</p>}
                  <button
                    className="btn primary"
                    type="button"
                    onClick={startStream}
                    disabled={cameraStarting}
                  >
                    {cameraStarting ? "Starting camera..." : cameraCtaLabel}
                  </button>
                </div>
              </div>
            )}
            {cameraError && <p className="error">{cameraError}</p>}
            {visionError && <p className="error">{visionError}</p>}

            <div className="camera-actions floating icon-controls icon-bar">
              <button
                className="icon-button icon-switch"
                type="button"
                {...withTouchAction(() => setUseFrontCamera((prev) => !prev))}
              >
                <span className="icon">📷</span>
                <span className="icon-label">Switch Camera</span>
              </button>
              <button
                className="icon-button icon-cancel"
                type="button"
                {...withTouchAction(() => {
                  if (selfieCloseTimerRef.current) {
                    window.clearTimeout(selfieCloseTimerRef.current);
                    selfieCloseTimerRef.current = null;
                  }
                  setCompletionNotice(null);
                  restoreDocumentInteractivity();
                  setActive(false);
                })}
              >
                <span className="icon">✖</span>
                <span className="icon-label">Cancel</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
