import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import "./CameraShared.css";
import "./IdCaptureModule.css";

const ENV_OPENCV_URL = String(import.meta.env.VITE_OPENCV_URL || "").trim();
const MANUAL_ID_CAPTURE_ONLY = true;
const ENABLE_PERSPECTIVE_CAPTURE = false;
const OPENCV_URLS = [
  ENV_OPENCV_URL,
  "https://docs.opencv.org/4.8.0/opencv.js",
  "https://docs.opencv.org/4.x/opencv.js",
  "https://cdn.jsdelivr.net/npm/opencv.js@1.2.1/opencv.js",
].filter(Boolean);
const OPENCV_READY_TIMEOUT_MS = 3500;
const OPENCV_CAPTURE_WAIT_TIMEOUT_MS = 1600;
const ID_COUNTDOWN_SECONDS = 0;
const ID_HIGH_RES_CONSTRAINTS = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 24, max: 30 },
} as const;
const ID_CAPTURE_QUALITY = {
  front: 0.98,
  back: 0.98,
} as const;
const ID_AUTOCAPTURE_STABLE_FRAMES = {
  front: 7,
  back: 4,
} as const;
const ID_MIN_DETECT_QUALITY = 0.7;
const ID_ADVANCED_CONSTRAINTS: any[] = [
  { focusMode: "continuous" },
  { exposureMode: "continuous" },
  { whiteBalanceMode: "continuous" },
];
const BACK_BARCODE_GUIDE_RECT = {
  x: 0.05,
  y: 0.52,
  width: 0.9,
  height: 0.34,
} as const;

type IdCaptureModuleProps = {
  idFront: File | null;
  idBack: File | null;
  idType?: string;
  onFrontChange: (file: File | null) => void;
  onBackChange: (file: File | null) => void;
  className?: string;
};

type CaptureTarget = "front" | "back";
type QualityFailCode =
  | "dark"
  | "overexposed"
  | "low_contrast"
  | "back_blurry"
  | "barcode_unreadable"
  | "front_unclear"
  | "processing";
type QualityCheckResult = {
  ok: boolean;
  message?: string;
  code?: QualityFailCode;
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

const orderQuad = (pts: { x: number; y: number }[]) => {
  if (pts.length !== 4) return pts;
  const sums = pts.map((p) => p.x + p.y);
  const diffs = pts.map((p) => p.y - p.x);
  const tl = pts[sums.indexOf(Math.min(...sums))];
  const br = pts[sums.indexOf(Math.max(...sums))];
  const tr = pts[diffs.indexOf(Math.min(...diffs))];
  const bl = pts[diffs.indexOf(Math.max(...diffs))];
  return [tl, tr, br, bl];
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const isTapCaptureBlockedTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, a, input, select, textarea, label, .camera-actions, .camera-permission"
    )
  );
};

export default function IdCaptureModule({
  idFront,
  idBack,
  idType,
  onFrontChange,
  onBackChange,
  className,
}: IdCaptureModuleProps) {
  const [activeTarget, setActiveTarget] = useState<CaptureTarget | null>(null);
  const active = activeTarget !== null;
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<
    "granted" | "denied" | "prompt" | "unknown"
  >("unknown");
  const [idDetectError, setIdDetectError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownProgress, setCountdownProgress] = useState(1);
  const [countdownTarget, setCountdownTarget] = useState<"front" | "back" | null>(null);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [useFrontCamera, setUseFrontCamera] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const opencvReadyRef = useRef(false);
  const opencvLoadingRef = useRef<Promise<void> | null>(null);
  const idQuadRef = useRef<{
    points: { x: number; y: number }[];
    pointsVideo: { x: number; y: number }[];
    ok: boolean;
    quality: number;
  } | null>(null);
  const lastAutoCaptureAtRef = useRef(0);
  const countdownTargetRef = useRef<"front" | "back" | null>(null);
  const countdownRafRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const lastTouchActionRef = useRef(0);
  const activeTargetStartedAtRef = useRef(0);
  const qualityRejectCountsRef = useRef<Record<CaptureTarget, number>>({
    front: 0,
    back: 0,
  });
  const captureInFlightRef = useRef(false);

  const frontPreviewUrl = usePreviewUrl(idFront);
  const backPreviewUrl = usePreviewUrl(idBack);
  const autoCaptureEnabled = !MANUAL_ID_CAPTURE_ONLY && (activeTarget === "front" || activeTarget === "back");
  const requiresBackCapture = idType !== "passport";

  const showCameraEnable = !cameraReady && !cameraStarting;
  const cameraCtaLabel = cameraPermission === "granted" ? "Start camera" : "Enable camera";
  const cameraCtaHint =
    cameraPermission === "granted"
      ? "Camera access is allowed. Tap below to start the stream."
      : "We need camera access to continue. Tap below to allow access.";
  const showCameraStarting = cameraStarting && !cameraReady;

  const getPromptContent = () => {
    if (!activeTarget) return null;
    const baseTips = [
      "Use bright, even light (near a window works best).",
      "Tilt the card 10–15° to move glare off the text.",
      "Avoid overhead lights reflecting directly on the card.",
    ];
    if (activeTarget === "front") {
      const countdownText =
        countdown !== null && countdownTarget === "front"
          ? `Capturing in ${countdown}…`
          : null;
      return {
        title: "Front of ID",
        body:
          countdownText ||
          "Fill the frame with the entire front. Keep it sharp and centered, then tap anywhere on screen to capture.",
        tips: baseTips,
      };
    }
    if (activeTarget === "back") {
      const countdownText =
        countdown !== null && countdownTarget === "back"
          ? `Capturing in ${countdown}…`
          : null;
      return {
        title: "Back of ID (Barcode)",
        body:
          countdownText ||
          "Align only the barcode inside the guide box, then tap anywhere on screen to capture.",
        tips: baseTips,
      };
    }
    return null;
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

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const startStream = useCallback(async () => {
    if (!active) return;
    setCameraError(null);
    stopStream();
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
        const picked = preferFront
          ? frontMatch || videoInputs[0]
          : backMatch || videoInputs[videoInputs.length - 1];
        return picked?.deviceId || null;
      };
      const preferredFacingMode = useFrontCamera ? "user" : "environment";
      const preferredDeviceId = await pickPreferredDeviceId(useFrontCamera);
      const baseVideo: any = {
        ...ID_HIGH_RES_CONSTRAINTS,
        advanced: ID_ADVANCED_CONSTRAINTS,
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
            facingMode: preferredFacingMode,
          },
          audio: false,
        },
        { video: { facingMode: preferredFacingMode }, audio: false },
        { video: true, audio: false },
      ];

      const waitForVideo = async () => {
        if (!videoRef.current) return false;
        const start = Date.now();
        while (Date.now() - start < 1600) {
          if (videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
            return true;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
        return false;
      };

      let lastError: unknown;
      for (const constraints of attempts) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          streamRef.current = stream;
          const track = stream.getVideoTracks()[0];
          if (track?.applyConstraints) {
            try {
              await track.applyConstraints({ advanced: ID_ADVANCED_CONSTRAINTS } as any);
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
          if (ready) {
            setCameraReady(true);
            setCameraStarting(false);
            return;
          }
          lastError = new Error("Camera stream started but no frames were delivered.");
          stopStream();
        } catch (err) {
          lastError = err;
          stopStream();
        }
      }

      throw lastError || new Error("Unable to start the camera.");
    } catch (err: any) {
      setCameraError(err?.message || "Camera access was denied.");
      setCameraStarting(false);
      stopStream();
    }
  }, [active, stopStream, useFrontCamera]);

  const cancelCountdown = useCallback(() => {
    if (countdownRafRef.current) {
      window.cancelAnimationFrame(countdownRafRef.current);
      countdownRafRef.current = null;
    }
    countdownTargetRef.current = null;
    setCountdownTarget(null);
    setCountdown(null);
    setCountdownProgress(1);
  }, []);

  const openCapture = useCallback(
    (target: CaptureTarget) => {
      setCameraError(null);
      setIdDetectError(null);
      cancelCountdown();
      activeTargetStartedAtRef.current = Date.now();
      setActiveTarget(target);
    },
    [cancelCountdown]
  );

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

  const ensureOpenCv = useCallback(async () => {
    if (opencvReadyRef.current) return;
    if (opencvLoadingRef.current) return opencvLoadingRef.current;

    const isReady = () => {
      const cv = (window as any).cv;
      return Boolean(cv && cv.imread);
    };

    const waitForCv = (src: string) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error(`OpenCV load timed out (${src})`));
        }, OPENCV_READY_TIMEOUT_MS);
        const resolveOnce = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        };
        const rejectOnce = (error: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          reject(error);
        };
        if (isReady()) {
          resolveOnce();
          return;
        }
        const existing = document.querySelector(`script[data-opencv="${src}"]`);
        if (existing) {
          const poll = () => {
            if (isReady()) resolveOnce();
            else if (!settled) window.setTimeout(poll, 50);
          };
          poll();
          return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.opencv = src;
        script.onload = () => {
          const cv = (window as any).cv;
          if (cv && cv.imread) {
            resolveOnce();
            return;
          }
          if (cv) {
            cv.onRuntimeInitialized = () => resolveOnce();
            return;
          }
          rejectOnce(new Error("OpenCV failed to initialize."));
        };
        script.onerror = () => rejectOnce(new Error(`Failed to load ${src}`));
        document.body.appendChild(script);
      });

    opencvLoadingRef.current = (async () => {
      let lastError: unknown;
      for (const src of OPENCV_URLS) {
        try {
          await waitForCv(src);
          opencvReadyRef.current = true;
          setIdDetectError(null);
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error("Unable to load OpenCV.");
    })();

    return opencvLoadingRef.current;
  }, []);

  const tryPerspectiveCapture = useCallback(
    async (
      video: HTMLVideoElement,
      quad: { pointsVideo: { x: number; y: number }[] } | null,
      quality: number,
      enhance: boolean
    ) => {
      const cv = (window as any).cv;
      if (!cv || !quad || quad.pointsVideo.length !== 4) return null;
      const ordered = orderQuad(quad.pointsVideo);
      const [tl, tr, br, bl] = ordered;
      const widthA = Math.hypot(br.x - bl.x, br.y - bl.y);
      const widthB = Math.hypot(tr.x - tl.x, tr.y - tl.y);
      const maxWidth = Math.max(Math.floor(widthA), Math.floor(widthB));
      const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
      const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
      const maxHeight = Math.max(Math.floor(heightA), Math.floor(heightB));
      if (maxWidth < 120 || maxHeight < 80) return null;

      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = video.videoWidth || 1280;
      sourceCanvas.height = video.videoHeight || 720;
      const sctx = sourceCanvas.getContext("2d");
      if (!sctx) return null;
      sctx.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);

      const src = cv.imread(sourceCanvas);
      const dst = new cv.Mat();
      const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        tl.x,
        tl.y,
        tr.x,
        tr.y,
        br.x,
        br.y,
        bl.x,
        bl.y,
      ]);
      const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        maxWidth - 1,
        0,
        maxWidth - 1,
        maxHeight - 1,
        0,
        maxHeight - 1,
      ]);
      const M = cv.getPerspectiveTransform(srcPts, dstPts);
      const dsize = new cv.Size(maxWidth, maxHeight);
      cv.warpPerspective(src, dst, M, dsize);

      const warpedCanvas = document.createElement("canvas");
      warpedCanvas.width = maxWidth;
      warpedCanvas.height = maxHeight;
      cv.imshow(warpedCanvas, dst);

      src.delete();
      dst.delete();
      srcPts.delete();
      dstPts.delete();
      M.delete();

      const postCanvas = document.createElement("canvas");
      postCanvas.width = maxWidth;
      postCanvas.height = maxHeight;
      const pctx = postCanvas.getContext("2d");
      if (!pctx) {
        return new Promise<Blob | null>((resolve) =>
          warpedCanvas.toBlob(resolve, "image/jpeg", quality)
        );
      }
      if (enhance) {
        pctx.filter = "brightness(1.1) contrast(1.22) saturate(1.02)";
        pctx.drawImage(warpedCanvas, 0, 0);
        pctx.filter = "none";
      } else {
        pctx.drawImage(warpedCanvas, 0, 0);
      }
      return new Promise<Blob | null>((resolve) =>
        postCanvas.toBlob(resolve, "image/jpeg", quality)
      );
    },
    []
  );

  const captureRegion = useCallback(
    async (
      video: HTMLVideoElement,
      crop: { x: number; y: number; width: number; height: number },
      quality: number,
      enhance: boolean
    ) => {
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      const cropX = Math.max(0, Math.round(crop.x * width));
      const cropY = Math.max(0, Math.round(crop.y * height));
      const cropW = Math.max(2, Math.round(crop.width * width));
      const cropH = Math.max(2, Math.round(crop.height * height));
      const safeW = Math.min(width - cropX, cropW);
      const safeH = Math.min(height - cropY, cropH);
      if (safeW < 2 || safeH < 2) return null;

      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = safeW;
      cropCanvas.height = safeH;
      const ctx = cropCanvas.getContext("2d");
      if (!ctx) return null;
      if (enhance) {
        ctx.filter = "brightness(1.12) contrast(1.28) saturate(1.05)";
      }
      ctx.drawImage(video, cropX, cropY, safeW, safeH, 0, 0, safeW, safeH);
      ctx.filter = "none";

      let outputCanvas = cropCanvas;
      if (safeW < 1200) {
        const scale = 1200 / safeW;
        const targetH = Math.round(safeH * scale);
        const scaled = document.createElement("canvas");
        scaled.width = 1200;
        scaled.height = Math.max(2, targetH);
        const sctx = scaled.getContext("2d");
        if (sctx) {
          sctx.drawImage(cropCanvas, 0, 0, scaled.width, scaled.height);
          outputCanvas = scaled;
        }
      }

      return new Promise<Blob | null>((resolve) =>
        outputCanvas.toBlob(resolve, "image/jpeg", quality)
      );
    },
    []
  );

  const analyzeCaptureQuality = useCallback(
    async (blob: Blob, target: CaptureTarget): Promise<QualityCheckResult> => {
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const url = URL.createObjectURL(blob);
          const img = new Image();
          const timeout = window.setTimeout(() => {
            URL.revokeObjectURL(url);
            reject(new Error("Image decode timed out"));
          }, 2500);
          img.onload = () => {
            window.clearTimeout(timeout);
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = () => {
            window.clearTimeout(timeout);
            URL.revokeObjectURL(url);
            reject(new Error("Unable to load image"));
          };
          img.src = url;
        });
        const sourceW = image.naturalWidth || image.width || 0;
        const sourceH = image.naturalHeight || image.height || 0;
        if (!sourceW || !sourceH) {
          return { ok: false, message: "Capture failed. Please retake your photo." };
        }

        const maxWidth = target === "back" ? 1400 : 960;
        const scale = Math.min(1, maxWidth / sourceW);
        const width = Math.max(2, Math.round(sourceW * scale));
        const height = Math.max(2, Math.round(sourceH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          return { ok: false, message: "Camera processing unavailable. Please retry." };
        }
        if (target === "back") {
          ctx.filter = "contrast(1.3) brightness(1.04)";
        }
        ctx.drawImage(image, 0, 0, width, height);
        ctx.filter = "none";
        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;
        const gray = new Uint8Array(width * height);
        let mean = 0;
        let sumSq = 0;
        for (let i = 0, px = 0; i < pixels.length; i += 4, px += 1) {
          const value = Math.round(
            0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
          );
          gray[px] = value;
          mean += value;
          sumSq += value * value;
        }
        const total = Math.max(1, width * height);
        mean /= total;
        const variance = Math.max(0, sumSq / total - mean * mean);
        const contrast = Math.sqrt(variance);

        let edgeSum = 0;
        let edgeCount = 0;
        let barcodeEdgeSum = 0;
        let barcodeEdgeCount = 0;
        const barcodeYStart = Math.floor(
          height * (target === "back" ? 0.2 : 0.56)
        );
        const barcodeYEnd = Math.floor(
          height * (target === "back" ? 0.85 : 0.92)
        );
        const barcodeXStart = Math.floor(
          width * (target === "back" ? 0.06 : 0.08)
        );
        const barcodeXEnd = Math.floor(
          width * (target === "back" ? 0.94 : 0.92)
        );
        const sampleStep = target === "back" ? 1 : 2;
        for (let y = sampleStep; y < height; y += sampleStep) {
          const row = y * width;
          const prevRow = (y - 1) * width;
          for (let x = sampleStep; x < width; x += sampleStep) {
            const idx = row + x;
            const gx = Math.abs(gray[idx] - gray[idx - 1]);
            const gy = Math.abs(gray[idx] - gray[prevRow + x]);
            edgeSum += gx + gy;
            edgeCount += 2;
            if (
              target === "back" &&
              y >= barcodeYStart &&
              y <= barcodeYEnd &&
              x >= barcodeXStart &&
              x <= barcodeXEnd
            ) {
              barcodeEdgeSum += gx;
              barcodeEdgeCount += 1;
            }
          }
        }
        const edgeStrength = edgeCount > 0 ? edgeSum / edgeCount : 0;
        const barcodeStrength = barcodeEdgeCount > 0 ? barcodeEdgeSum / barcodeEdgeCount : 0;

        if (mean < 30) {
          return { ok: false, code: "dark", message: "Image is too dark. Move to better light." };
        }
        if (mean > 245) {
          return {
            ok: false,
            code: "overexposed",
            message: "Image is overexposed. Reduce glare and retry.",
          };
        }
        if (contrast < 8.2) {
          return {
            ok: false,
            code: "low_contrast",
            message: "Low contrast. Avoid glare and hold steady.",
          };
        }

        if (target === "back") {
          const backEdgeMin = 4.8;
          const backBarcodeMin = 4.9;
          const backBarcodeStrongPass = 5.6;
          const barcodeSharpEnough = barcodeStrength >= backBarcodeStrongPass;
          if (barcodeSharpEnough && edgeStrength >= backEdgeMin * 0.9) {
            return { ok: true };
          }
          if (barcodeStrength < backBarcodeMin) {
            return {
              ok: false,
              code: "barcode_unreadable",
              message: "Barcode is not readable yet. Align it inside the guide box and retake.",
            };
          }
          if (edgeStrength < backEdgeMin) {
            return {
              ok: false,
              code: "back_blurry",
              message: "Back of ID is blurry. Keep the barcode sharp.",
            };
          }
        } else if (edgeStrength < 4.4 || contrast < 7) {
          return {
            ok: false,
            code: "front_unclear",
            message: "Front of ID is not clear enough. Hold steady and retake.",
          };
        }

        return { ok: true };
      } catch {
        return {
          ok: false,
          code: "processing",
          message: "Capture quality check failed. Please retake your photo.",
        };
      }
    },
    []
  );

  const captureFrame = useCallback(async () => {
    if (captureInFlightRef.current) return;
    captureInFlightRef.current = true;
    setCaptureBusy(true);
    const video = videoRef.current;
    if (!video || !activeTarget) {
      captureInFlightRef.current = false;
      setCaptureBusy(false);
      return;
    }
    const quality =
      activeTarget === "back"
        ? ID_CAPTURE_QUALITY.back
        : ID_CAPTURE_QUALITY.front;
    let blob: Blob | null = null;
    const enhanceCapture = activeTarget !== "back";
    try {
      if (activeTarget === "back") {
        blob = await captureRegion(video, BACK_BARCODE_GUIDE_RECT, quality, true);
      }
      try {
        if (!blob && activeTarget !== "back" && ENABLE_PERSPECTIVE_CAPTURE) {
          await Promise.race([
            ensureOpenCv(),
            new Promise<never>((_, reject) =>
              window.setTimeout(
                () => reject(new Error("OpenCV warmup timed out")),
                OPENCV_CAPTURE_WAIT_TIMEOUT_MS
              )
            ),
          ]);
          blob = await tryPerspectiveCapture(
            video,
            idQuadRef.current,
            quality,
            enhanceCapture
          );
        }
      } catch {
        blob = null;
      }
      if (!blob) {
        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        const frontMaxWidth = 1600;
        const scale =
          activeTarget === "front" && width > frontMaxWidth ? frontMaxWidth / width : 1;
        const outW = Math.max(2, Math.round(width * scale));
        const outH = Math.max(2, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        if (enhanceCapture || activeTarget === "back") {
          ctx.filter =
            activeTarget === "back"
              ? "brightness(1.06) contrast(1.34) saturate(1.02)"
              : "brightness(1.12) contrast(1.22) saturate(1.03)";
        }
        ctx.drawImage(video, 0, 0, outW, outH);
        ctx.filter = "none";
        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality)
        );
      }
      if (!blob) return;
      const qualityResult = await analyzeCaptureQuality(blob, activeTarget);
      if (!qualityResult.ok) {
        const nextRejectCount = (qualityRejectCountsRef.current[activeTarget] || 0) + 1;
        qualityRejectCountsRef.current[activeTarget] = nextRejectCount;
        const softFail =
          qualityResult.code !== "dark" && qualityResult.code !== "overexposed";
        const allowFrontFallback =
          activeTarget === "front" &&
          softFail &&
          nextRejectCount >= 1;
        const allowBackFallback =
          activeTarget === "back" &&
          softFail &&
          nextRejectCount >= 2;
        const allowAnyFallback = nextRejectCount >= 2;
        if (allowFrontFallback || allowBackFallback || allowAnyFallback) {
          qualityRejectCountsRef.current[activeTarget] = 0;
          setIdDetectError(
            "Photo accepted with fallback quality checks. Continue if details are readable."
          );
        } else {
          setIdDetectError(
            qualityResult.message || "Capture is not readable. Please retake your photo."
          );
          lastAutoCaptureAtRef.current = Date.now();
          return;
        }
      }
      qualityRejectCountsRef.current[activeTarget] = 0;
      setIdDetectError(null);
      const targetName =
        activeTarget === "back"
          ? "idBack.jpg"
          : "idFront.jpg";
      const file = new File([blob], targetName, { type: "image/jpeg" });
      if (activeTarget === "back") onBackChange(file);
      else onFrontChange(file);
      setActiveTarget(null);
    } finally {
      captureInFlightRef.current = false;
      setCaptureBusy(false);
    }
  }, [
    activeTarget,
    ensureOpenCv,
    onBackChange,
    onFrontChange,
    analyzeCaptureQuality,
    tryPerspectiveCapture,
  ]);

  const triggerMobileTapCapture = useCallback(() => {
    if (!active || !cameraReady || captureBusy || !activeTarget) return;
    if (activeTarget !== "front" && activeTarget !== "back") return;
    lastAutoCaptureAtRef.current = Date.now();
    triggerCaptureFlash();
    void captureFrame();
  }, [active, activeTarget, cameraReady, captureBusy, captureFrame, triggerCaptureFlash]);

  const handleOverlayPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      if (Date.now() - lastTouchActionRef.current < 500) return;
      if (isTapCaptureBlockedTarget(event.target)) return;
      event.preventDefault();
      lastTouchActionRef.current = Date.now();
      triggerMobileTapCapture();
    },
    [triggerMobileTapCapture]
  );

  const handleOverlayTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (Date.now() - lastTouchActionRef.current < 500) return;
      if (isTapCaptureBlockedTarget(event.target)) return;
      event.preventDefault();
      lastTouchActionRef.current = Date.now();
      triggerMobileTapCapture();
    },
    [triggerMobileTapCapture]
  );

  const startCountdown = useCallback(() => {
    if (activeTarget !== "front" && activeTarget !== "back") return;
    if (countdownTargetRef.current === activeTarget) return;
    cancelCountdown();
    const durationMs = ID_COUNTDOWN_SECONDS * 1000;
    if (durationMs <= 0) {
      countdownTargetRef.current = activeTarget;
      lastAutoCaptureAtRef.current = Date.now();
      triggerCaptureFlash();
      void captureFrame().finally(() => {
        cancelCountdown();
      });
      return;
    }
    countdownTargetRef.current = activeTarget;
    setCountdownTarget(activeTarget);
    const startAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startAt;
      const remaining = Math.max(0, durationMs - elapsed);
      const seconds = Math.ceil(remaining / 1000);
      setCountdown(seconds === 0 ? 0 : seconds);
      setCountdownProgress(remaining / durationMs);
      if (remaining <= 0) {
        cancelCountdown();
        if (active) {
          lastAutoCaptureAtRef.current = Date.now();
          triggerCaptureFlash();
          void captureFrame();
        }
        return;
      }
      countdownRafRef.current = window.requestAnimationFrame(tick);
    };
    countdownRafRef.current = window.requestAnimationFrame(tick);
  }, [active, activeTarget, cancelCountdown, captureFrame, triggerCaptureFlash]);

  useEffect(() => {
    if (!active) {
      setCameraStarting(false);
      stopStream();
      return;
    }
    setCameraReady(false);
    setUseFrontCamera(false);
    void startStream();
    return () => stopStream();
  }, [active, startStream, stopStream]);

  useEffect(() => {
    if (requiresBackCapture) return;
    if (activeTarget === "back") {
      setActiveTarget(null);
    }
  }, [requiresBackCapture, activeTarget]);

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
    setCameraReady(false);
    void startStream();
  }, [active, startStream, useFrontCamera]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setIdDetectError(null);
      if (countdownTargetRef.current) {
        cancelCountdown();
      }
      setCaptureBusy(false);
      return;
    }
    let raf = 0;
    let cancelled = false;
    let stableOkFrames = 0;
    let stableLossAt = 0;
    let lastDetectAt = 0;
    let lastQuad:
      | {
          points: { x: number; y: number }[];
          pointsVideo: { x: number; y: number }[];
          ok: boolean;
          quality: number;
        }
      | null = null;
    const detectCanvas = document.createElement("canvas");
    const detectCtx = detectCanvas.getContext("2d", { willReadFrequently: true });
      const detectionEnabled = autoCaptureEnabled;

    const runDetection = () => {
      const video = videoRef.current;
      const cv = (window as any).cv;
      if (!video || !detectCtx || !cv) return null;
      const videoAspect = (video.videoWidth || 1280) / (video.videoHeight || 720);
      const w = 360;
      const h = Math.max(200, Math.round(w / videoAspect));
      detectCanvas.width = w;
      detectCanvas.height = h;
      detectCtx.drawImage(video, 0, 0, w, h);
      const src = cv.imread(detectCanvas);
      let gray = new cv.Mat();
      try {
        const lab = new cv.Mat();
        cv.cvtColor(src, lab, cv.COLOR_RGBA2Lab);
        const labPlanes = new cv.MatVector();
        cv.split(lab, labPlanes);
        const l = labPlanes.get(0);
        try {
          const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
          clahe.apply(l, l);
          clahe.delete();
        } catch {
          // ignore if CLAHE is unavailable
        }
        labPlanes.set(0, l);
        cv.merge(labPlanes, lab);
        const bgr = new cv.Mat();
        cv.cvtColor(lab, bgr, cv.COLOR_Lab2BGR);
        cv.cvtColor(bgr, gray, cv.COLOR_BGR2GRAY);
        bgr.delete();
        l.delete();
        labPlanes.delete();
        lab.delete();
      } catch {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      }

      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      const edges = new cv.Mat();
      cv.Canny(gray, edges, 40, 120);
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.dilate(edges, edges, kernel);

      if (activeTarget === "back") {
        const bx = clamp(Math.floor(w * BACK_BARCODE_GUIDE_RECT.x), 1, w - 2);
        const by = clamp(Math.floor(h * BACK_BARCODE_GUIDE_RECT.y), 1, h - 2);
        const bw = clamp(Math.floor(w * BACK_BARCODE_GUIDE_RECT.width), 8, w - bx - 1);
        const bh = clamp(Math.floor(h * BACK_BARCODE_GUIDE_RECT.height), 8, h - by - 1);
        const maxX = Math.min(w - 1, bx + bw);
        const maxY = Math.min(h - 1, by + bh);
        const grayData = gray.data as Uint8Array;
        const edgeData = edges.data as Uint8Array;

        let samples = 0;
        let edgeHits = 0;
        let lumSum = 0;
        let lumSqSum = 0;
        let gradXSum = 0;
        let gradYSum = 0;
        for (let y = by; y < maxY; y += 2) {
          const rowOffset = y * w;
          const prevRowOffset = (y - 1) * w;
          for (let x = bx; x < maxX; x += 2) {
            const idx = rowOffset + x;
            const lum = grayData[idx];
            lumSum += lum;
            lumSqSum += lum * lum;
            if (edgeData[idx] > 0) edgeHits += 1;
            gradXSum += Math.abs(lum - grayData[idx - 1]);
            gradYSum += Math.abs(lum - grayData[prevRowOffset + x]);
            samples += 1;
          }
        }

        const safeSamples = Math.max(1, samples);
        const edgeDensity = edgeHits / safeSamples;
        const mean = lumSum / safeSamples;
        const variance = Math.max(0, lumSqSum / safeSamples - mean * mean);
        const contrast = Math.sqrt(variance);
        const verticalStripeBias = gradXSum / Math.max(1, gradYSum);
        const densityScore = clamp(edgeDensity / 0.16, 0, 1);
        const contrastScore = clamp(contrast / 30, 0, 1);
        const stripeScore = clamp((verticalStripeBias - 0.8) / 0.8, 0, 1);
        let quality =
          densityScore * 0.5 + contrastScore * 0.25 + stripeScore * 0.25;
        const ok =
          edgeDensity > 0.08 &&
          contrast > 11 &&
          verticalStripeBias > 1.02 &&
          quality >= 0.58;
        if (ok) {
          quality = Math.max(quality, 0.82);
        }

        src.delete();
        gray.delete();
        edges.delete();
        kernel.delete();

        const points = orderQuad([
          { x: bx / w, y: by / h },
          { x: maxX / w, y: by / h },
          { x: maxX / w, y: maxY / h },
          { x: bx / w, y: maxY / h },
        ]);
        const pointsVideo = points.map((point) => ({
          x: point.x * (video.videoWidth || 1280),
          y: point.y * (video.videoHeight || 720),
        }));
        return { points, pointsVideo, ok, quality };
      }

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let bestApprox: any = null;
      let bestArea = 0;
      let bestContour: any = null;
      for (let i = 0; i < contours.size(); i += 1) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < w * h * 0.12) {
          cnt.delete();
          continue;
        }
        const hull = new cv.Mat();
        cv.convexHull(cnt, hull, false, true);
        const peri = cv.arcLength(hull, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(hull, approx, 0.02 * peri, true);
        if (approx.rows === 4 && area > bestArea) {
          if (bestApprox) bestApprox.delete();
          bestApprox = approx;
          bestArea = area;
          if (bestContour) bestContour.delete();
          bestContour = hull;
        } else {
          approx.delete();
          if (area > bestArea) {
            if (bestContour) bestContour.delete();
            bestContour = hull;
            bestArea = area;
          } else {
            hull.delete();
          }
        }
        cnt.delete();
      }

      src.delete();
      gray.delete();
      edges.delete();
      kernel.delete();
      contours.delete();
      hierarchy.delete();

      let points: { x: number; y: number }[] = [];
      if (bestApprox) {
        const data = bestApprox.data32S;
        for (let i = 0; i < data.length; i += 2) {
          points.push({ x: data[i] / w, y: data[i + 1] / h });
        }
        bestApprox.delete();
      } else if (bestContour) {
        const rect = cv.minAreaRect(bestContour);
        const rectPts = cv.RotatedRect.points(rect);
        points = rectPts.map((p: any) => ({ x: p.x / w, y: p.y / h }));
      }
      if (bestContour) bestContour.delete();

      const ordered = orderQuad(points);
      if (ordered.length !== 4) {
        return null;
      }
      const pointsVideo = ordered.map((point) => ({
        x: point.x * (video.videoWidth || 1280),
        y: point.y * (video.videoHeight || 720),
      }));

      let minX = 1;
      let minY = 1;
      let maxX = 0;
      let maxY = 0;
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      const width = Math.max(0.0001, maxX - minX);
      const height = Math.max(0.0001, maxY - minY);
      const rectAspect = width / height;
      const areaRatio = bestArea / (w * h);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const topEdge = distance(ordered[0], ordered[1]);
      const bottomEdge = distance(ordered[3], ordered[2]);
      const leftEdge = distance(ordered[0], ordered[3]);
      const rightEdge = distance(ordered[1], ordered[2]);
      const widthBalance =
        Math.min(topEdge, bottomEdge) / Math.max(0.0001, Math.max(topEdge, bottomEdge));
      const heightBalance =
        Math.min(leftEdge, rightEdge) / Math.max(0.0001, Math.max(leftEdge, rightEdge));

      const sizeScore = clamp((areaRatio - 0.1) / 0.32, 0, 1) * clamp((0.9 - areaRatio) / 0.28, 0, 1);
      const aspectScore = clamp((rectAspect - 0.95) / 0.35, 0, 1) * clamp((2.55 - rectAspect) / 0.45, 0, 1);
      const centerScore =
        clamp((centerX - 0.1) / 0.18, 0, 1) *
        clamp((0.9 - centerX) / 0.18, 0, 1) *
        clamp((centerY - 0.12) / 0.2, 0, 1) *
        clamp((0.88 - centerY) / 0.2, 0, 1);
      const perspectiveScore =
        clamp((widthBalance - 0.5) / 0.35, 0, 1) * clamp((heightBalance - 0.5) / 0.35, 0, 1);
      const quality =
        sizeScore * 0.33 + aspectScore * 0.24 + centerScore * 0.23 + perspectiveScore * 0.2;

      const sizeOk = areaRatio > 0.1 && areaRatio < 0.9;
      const aspectOk = rectAspect > 0.95 && rectAspect < 2.55;
      const centerOk = centerX > 0.1 && centerX < 0.9 && centerY > 0.12 && centerY < 0.88;
      const perspectiveOk = widthBalance > 0.5 && heightBalance > 0.5;
      const ok = sizeOk && aspectOk && centerOk && perspectiveOk && quality >= ID_MIN_DETECT_QUALITY;

      return { points: ordered, pointsVideo, ok, quality };
    };

    const loop = () => {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || video.readyState < 2) {
        raf = window.requestAnimationFrame(loop);
        return;
      }

      const canDetect = detectionEnabled && opencvReadyRef.current && detectCtx;
      if (canDetect && performance.now() - lastDetectAt > 140) {
        lastDetectAt = performance.now();
        try {
          lastQuad = runDetection();
          if (lastQuad === null) {
            lastQuad = { points: [], pointsVideo: [], ok: false, quality: 0 };
          }
        } catch {
          if (!cancelled) {
            setIdDetectError("ID edge detection failed. Try again.");
          }
          lastQuad = { points: [], pointsVideo: [], ok: false, quality: 0 };
        }
      } else if (!canDetect) {
        lastQuad = null;
      }

      const detectOk = Boolean(lastQuad && lastQuad.ok);
      const detectQuality = lastQuad?.quality ?? 0;
      if (lastQuad) {
        idQuadRef.current = lastQuad;
      } else {
        idQuadRef.current = null;
      }
      const stableThreshold =
        activeTarget === "back"
          ? ID_AUTOCAPTURE_STABLE_FRAMES.back
          : ID_AUTOCAPTURE_STABLE_FRAMES.front;
      stableOkFrames = detectOk ? stableOkFrames + 1 : 0;
      const stableEnough =
        detectionEnabled &&
        detectOk &&
        detectQuality >= ID_MIN_DETECT_QUALITY &&
        stableOkFrames >= stableThreshold;

      if (overlay) {
        const ow = video.videoWidth || 1280;
        const oh = video.videoHeight || 720;
        const ratio = window.devicePixelRatio || 1;
        if (overlay.width !== ow * ratio) overlay.width = ow * ratio;
        if (overlay.height !== oh * ratio) overlay.height = oh * ratio;
        overlay.style.width = `${ow}px`;
        overlay.style.height = `${oh}px`;
        const octx = overlay.getContext("2d");
        if (octx) {
          octx.setTransform(ratio, 0, 0, ratio, 0, 0);
          octx.clearRect(0, 0, ow, oh);
          const guideColor = "rgba(34, 197, 94, 0.9)";
          octx.strokeStyle = guideColor;
          octx.lineWidth = 4;
          octx.lineCap = "round";
          if (activeTarget === "back") {
            const boxX = ow * BACK_BARCODE_GUIDE_RECT.x;
            const boxY = oh * BACK_BARCODE_GUIDE_RECT.y;
            const boxW = ow * BACK_BARCODE_GUIDE_RECT.width;
            const boxH = oh * BACK_BARCODE_GUIDE_RECT.height;
            octx.save();
            octx.setLineDash([12, 8]);
            octx.strokeRect(boxX, boxY, boxW, boxH);
            octx.setLineDash([]);
            octx.fillStyle = "rgba(34, 197, 94, 0.08)";
            octx.fillRect(boxX, boxY, boxW, boxH);
            octx.fillStyle = "rgba(226, 252, 255, 0.9)";
            octx.font = "600 18px Inter, system-ui, sans-serif";
            octx.textAlign = "center";
            octx.textBaseline = "bottom";
            octx.fillText("Align barcode inside box", boxX + boxW / 2, boxY - 8);
            octx.restore();
          } else {
            const guideX = ow * 0.1;
            const guideY = oh * 0.2;
            const guideW = ow * 0.8;
            const guideH = oh * 0.55;
            const cornerSize = Math.min(guideW, guideH) * 0.18;
            const drawCorner = (
              x: number,
              y: number,
              xDir: number,
              yDir: number
            ) => {
              octx.beginPath();
              octx.moveTo(x, y);
              octx.lineTo(x + cornerSize * xDir, y);
              octx.moveTo(x, y);
              octx.lineTo(x, y + cornerSize * yDir);
              octx.stroke();
            };
            drawCorner(guideX, guideY, 1, 1);
            drawCorner(guideX + guideW, guideY, -1, 1);
            drawCorner(guideX, guideY + guideH, 1, -1);
            drawCorner(guideX + guideW, guideY + guideH, -1, -1);
          }
        }
      }

      if (detectionEnabled) {
        if (
          stableEnough &&
          !countdownTargetRef.current &&
          Date.now() - activeTargetStartedAtRef.current > 1400 &&
          Date.now() - lastAutoCaptureAtRef.current > 1800
        ) {
          stableLossAt = 0;
          startCountdown();
        } else if (!stableEnough && countdownTargetRef.current) {
          const now = performance.now();
          if (!stableLossAt) stableLossAt = now;
          if (now - stableLossAt > 600) {
            stableLossAt = 0;
            cancelCountdown();
          }
        } else if (stableEnough && stableLossAt) {
          stableLossAt = 0;
        }
      }

      raf = window.requestAnimationFrame(loop);
    };

    if (detectionEnabled) {
      void ensureOpenCv().catch((err) => {
        if (!cancelled) {
          const message = err?.message || "OpenCV failed to load.";
          setIdDetectError(`${message} Auto-capture may be unavailable.`);
        }
      });
    }

    raf = window.requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      if (countdownTargetRef.current) cancelCountdown();
    };
  }, [
    active,
    activeTarget,
    autoCaptureEnabled,
    cancelCountdown,
    ensureOpenCv,
    startCountdown,
  ]);

  return (
    <div className={`id-capture-module${className ? ` ${className}` : ""}`}>
      <div className="capture-grid">
        <div className="capture-card">
          <div>
            <strong>Step 3: ID Front</strong>
            <p>Use the rear camera. Full card in frame.</p>
          </div>
          {frontPreviewUrl ? (
            <img className="capture-preview" src={frontPreviewUrl} alt="ID front" />
          ) : (
            <div className="capture-placeholder">No photo yet</div>
          )}
          <div className="capture-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                openCapture("front");
              }}
            >
              {idFront ? "Retake" : "Take photo"}
            </button>
            {idFront && (
              <button className="btn ghost" type="button" onClick={() => onFrontChange(null)}>
                Clear
              </button>
            )}
          </div>
        </div>

        {requiresBackCapture && (
          <div className="capture-card">
            <div>
              <strong>ID Back (Barcode)</strong>
              <p>Capture the barcode side for backup verification.</p>
            </div>
            {backPreviewUrl ? (
              <img className="capture-preview" src={backPreviewUrl} alt="ID back" />
            ) : (
              <div className="capture-placeholder">No photo yet</div>
            )}
            <div className="capture-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  openCapture("back");
                }}
              >
                {idBack ? "Retake" : "Take photo"}
              </button>
              {idBack && (
                <button className="btn ghost" type="button" onClick={() => onBackChange(null)}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {active && (
        <div className="camera-overlay fullscreen id-capture-overlay" role="dialog" aria-modal="true">
          <div
            className="camera-panel camera-modal"
            onPointerDown={handleOverlayPointerDown}
            onTouchStart={handleOverlayTouchStart}
          >
            {captureFlash && <div className="capture-flash" aria-hidden="true" />}
            {(() => {
              const prompt = getPromptContent();
              if (!prompt) return null;
              return (
                <div className="id-prompt">
                  <strong>{prompt.title}</strong>
                  <span>{prompt.body}</span>
                  {prompt.tips.map((tip) => (
                    <span key={tip} className="id-tip">
                      {tip}
                    </span>
                  ))}
                </div>
              );
            })()}
            <div className={`camera-frame ${cameraReady ? "ready" : ""}`}>
              <video ref={videoRef} playsInline muted autoPlay className="camera-video" />
              <canvas ref={overlayRef} className="camera-overlay-canvas" />
              {activeTarget === "front" && (
                <div className="id-guide id-guide-front" aria-hidden="true" />
              )}
              {activeTarget === "back" && (
                <div className="id-guide id-guide-barcode" aria-hidden="true">
                  <span>Align barcode inside box</span>
                </div>
              )}
              {countdown !== null && countdownTarget !== null && (
                <div
                  className="countdown-ring id-countdown"
                  style={{ "--progress": countdownProgress } as CSSProperties}
                >
                  <div className="countdown-ring-inner">{countdown}</div>
                </div>
              )}
            </div>
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
            {showCameraStarting && (
              <div className="camera-permission">
                <div className="camera-permission-card">
                  <strong>Starting camera…</strong>
                  <p>Hold on while the camera initializes.</p>
                </div>
              </div>
            )}
            {cameraError && <p className="error">{cameraError}</p>}
            {idDetectError && <p className="error">{idDetectError}</p>}
            {captureBusy && <p className="sub">Processing capture...</p>}
            <div className="camera-actions floating id-action-bar">
              <button
                className="icon-button icon-switch"
                type="button"
                {...withTouchAction(() => setUseFrontCamera((prev) => !prev))}
              >
                <span className="icon">📷</span>
                <span className="icon-label">Switch camera</span>
              </button>
              <button
                className="icon-button icon-capture"
                type="button"
                disabled={captureBusy}
                {...withTouchAction(() => captureFrame())}
              >
                <span className="icon">◎</span>
                <span className="icon-label">Capture</span>
              </button>
              <button
                className="icon-button icon-cancel"
                type="button"
                {...withTouchAction(() => setActiveTarget(null))}
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
