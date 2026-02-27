import type {
  FaceLandmarker,
  FaceLandmarkerOptions,
} from "@mediapipe/tasks-vision";
import { loadTasksVision } from "./tasksVisionLoader";

export type FaceMatchResult = {
  score: number;
  distance: number;
  selfieIndex: number;
  comparedCount: number;
};

type FaceMatchLogger = (event: string, payload?: Record<string, unknown>) => void;

type ComputeFaceMatchOptions = {
  log?: FaceMatchLogger;
  maxSelfies?: number;
  budgetMs?: number;
};

type WarmupFaceMatchOptions = {
  log?: FaceMatchLogger;
};

const TASKS_VISION_VERSION = "0.10.32";
const ENV_FACE_MODEL_URL = String(import.meta.env.VITE_FACE_MODEL_URL || "").trim();
const ENV_VISION_WASM_URL = String(import.meta.env.VITE_VISION_WASM_URL || "").trim();
const ENV_FACE_MATCH_DELEGATE = String(
  import.meta.env.VITE_FACE_MATCH_DELEGATE || "cpu"
)
  .trim()
  .toLowerCase();
const DEFAULT_MAX_DISTANCE = 0.13;
const MAX_FACE_DIMENSION = 512;
const LANDMARKER_TIMEOUT_MS = 3500;
const IMAGE_DECODE_TIMEOUT_MS = 1500;

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
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
  MOUTH_UPPER: 13,
  MOUTH_LOWER: 14,
  CHIN: 152,
  FOREHEAD: 10,
  LEFT_CHEEK: 234,
  RIGHT_CHEEK: 454,
} as const;

const SIGNATURE_POINTS: number[] = [
  LANDMARK_INDEX.LEFT_EYE_OUTER,
  LANDMARK_INDEX.RIGHT_EYE_OUTER,
  LANDMARK_INDEX.LEFT_EYE_INNER,
  LANDMARK_INDEX.RIGHT_EYE_INNER,
  LANDMARK_INDEX.NOSE_TIP,
  LANDMARK_INDEX.MOUTH_LEFT,
  LANDMARK_INDEX.MOUTH_RIGHT,
  LANDMARK_INDEX.MOUTH_UPPER,
  LANDMARK_INDEX.MOUTH_LOWER,
  LANDMARK_INDEX.CHIN,
  LANDMARK_INDEX.FOREHEAD,
  LANDMARK_INDEX.LEFT_CHEEK,
  LANDMARK_INDEX.RIGHT_CHEEK,
];

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let landmarkerInstance: FaceLandmarker | null = null;

const supportsWebGL2 = typeof WebGL2RenderingContext !== "undefined";

const resolvePreferredDelegate = (): "GPU" | "CPU" => {
  if (ENV_FACE_MATCH_DELEGATE === "gpu") return "GPU";
  if (ENV_FACE_MATCH_DELEGATE === "cpu") return "CPU";
  return supportsWebGL2 ? "GPU" : "CPU";
};

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const yieldToMainThread = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out`)),
      ms
    );
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });

const loadLandmarker = async () => {
  if (landmarkerInstance) return landmarkerInstance;
  if (!landmarkerPromise) {
    landmarkerPromise = withTimeout(
      (async () => {
        const vision = await loadTasksVision();
        let lastError: unknown;
        const preferredDelegate: "GPU" | "CPU" = resolvePreferredDelegate();
        for (const wasmUrl of VISION_WASM_URLS) {
          for (const modelUrl of FACE_MODEL_URLS) {
            try {
              const resolver = await vision.FilesetResolver.forVisionTasks(wasmUrl);
              const buildOptions = (delegate: "GPU" | "CPU"): FaceLandmarkerOptions => ({
                baseOptions: { modelAssetPath: modelUrl, delegate },
                runningMode: "IMAGE",
                outputFaceBlendshapes: false,
                outputFacialTransformationMatrixes: false,
                numFaces: 1,
                minFaceDetectionConfidence: 0.1,
                minFacePresenceConfidence: 0.1,
                minTrackingConfidence: 0.1,
              });
              try {
                return await vision.FaceLandmarker.createFromOptions(
                  resolver,
                  buildOptions(preferredDelegate)
                );
              } catch (err) {
                lastError = err;
                if (preferredDelegate === "GPU") {
                  return await vision.FaceLandmarker.createFromOptions(
                    resolver,
                    buildOptions("CPU")
                  );
                }
                throw err;
              }
            } catch (err) {
              lastError = err;
            }
          }
        }
        throw lastError || new Error("Unable to load face model.");
      })(),
      LANDMARKER_TIMEOUT_MS,
      "Face model"
    );
  }
  try {
    landmarkerInstance = await landmarkerPromise;
  } catch (error) {
    landmarkerPromise = null;
    landmarkerInstance = null;
    throw error;
  }
  return landmarkerInstance;
};

const loadImageSource = async (
  file: File
): Promise<{ image: TexImageSource; cleanup: () => void }> => {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await withTimeout(
        createImageBitmap(file),
        IMAGE_DECODE_TIMEOUT_MS,
        "Image decode"
      );
      return {
        image: bitmap,
        cleanup: () => {
          if ("close" in bitmap) bitmap.close();
        },
      };
    } catch {
      // fall back to HTMLImageElement
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  const loaded = withTimeout(
    new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to load image."));
    }),
    IMAGE_DECODE_TIMEOUT_MS,
    "Image load"
  );
  image.src = url;
  await loaded;
  return {
    image,
    cleanup: () => URL.revokeObjectURL(url),
  };
};

const getImageSize = (image: TexImageSource) => {
  if ("naturalWidth" in image && "naturalHeight" in image) {
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  }
  if ("videoWidth" in image && "videoHeight" in image) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  if ("width" in image && "height" in image) {
    return { width: (image as any).width, height: (image as any).height };
  }
  return { width: 0, height: 0 };
};

const downscaleImage = (image: TexImageSource) => {
  const { width, height } = getImageSize(image);
  if (!width || !height) return image;
  const maxDim = Math.max(width, height);
  if (maxDim <= MAX_FACE_DIMENSION) return image;
  const scale = MAX_FACE_DIMENSION / maxDim;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  if (image instanceof ImageData) {
    const temp = document.createElement("canvas");
    temp.width = image.width;
    temp.height = image.height;
    const tempCtx = temp.getContext("2d");
    if (!tempCtx) return image;
    tempCtx.putImageData(image, 0, 0);
    ctx.drawImage(temp, 0, 0, targetWidth, targetHeight);
  } else {
    ctx.drawImage(image as CanvasImageSource, 0, 0, targetWidth, targetHeight);
  }
  return canvas;
};

const buildSignature = (landmarks: Array<{ x: number; y: number; z: number }>) => {
  const leftEye = landmarks[LANDMARK_INDEX.LEFT_EYE_OUTER];
  const rightEye = landmarks[LANDMARK_INDEX.RIGHT_EYE_OUTER];
  if (!leftEye || !rightEye) return null;
  const centerX = (leftEye.x + rightEye.x) / 2;
  const centerY = (leftEye.y + rightEye.y) / 2;
  const centerZ = (leftEye.z + rightEye.z) / 2;
  const scale = Math.max(
    0.0001,
    Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y)
  );
  const signature: number[] = [];
  for (const index of SIGNATURE_POINTS) {
    const point = landmarks[index];
    if (!point) return null;
    signature.push(
      (point.x - centerX) / scale,
      (point.y - centerY) / scale,
      (point.z - centerZ) / scale
    );
  }
  return signature;
};

const signatureDistance = (a: number[], b: number[]) => {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 3) {
    const dx = a[i] - b[i];
    const dy = a[i + 1] - b[i + 1];
    const dz = a[i + 2] - b[i + 2];
    sum += Math.hypot(dx, dy, dz);
  }
  return sum / (a.length / 3);
};

const scoreFromDistance = (distance: number, maxDistance = DEFAULT_MAX_DISTANCE) => {
  if (!Number.isFinite(distance)) return 0;
  const score = 1 - distance / maxDistance;
  return Math.min(1, Math.max(0, score));
};

const extractSignature = async (
  file: File,
  options?: { label?: string; log?: FaceMatchLogger }
) => {
  const label = options?.label || file.name || "image";
  const log = options?.log;
  const startedAt = nowMs();
  log?.("extract-start", {
    label,
    bytes: file.size,
    mime: file.type || "unknown",
  });
  const landmarkerStart = nowMs();
  const landmarker = await loadLandmarker();
  log?.("landmarker-ready", {
    label,
    ms: Math.round(nowMs() - landmarkerStart),
  });
  const decodeStart = nowMs();
  const { image, cleanup } = await loadImageSource(file);
  log?.("image-ready", {
    label,
    ms: Math.round(nowMs() - decodeStart),
  });
  try {
    const source = downscaleImage(image);
    await yieldToMainThread();
    log?.("detect-start", { label });
    const detectStart = nowMs();
    const result = landmarker.detect(source);
    await yieldToMainThread();
    log?.("detect-done", {
      label,
      ms: Math.round(nowMs() - detectStart),
    });
    const landmarks = result?.faceLandmarks?.[0];
    if (!landmarks) {
      log?.("extract-no-face", {
        label,
        elapsedMs: Math.round(nowMs() - startedAt),
      });
      return null;
    }
    const signature = buildSignature(landmarks);
    log?.("extract-complete", {
      label,
      elapsedMs: Math.round(nowMs() - startedAt),
      signaturePoints: signature ? signature.length / 3 : 0,
    });
    return signature;
  } finally {
    cleanup();
  }
};

export const warmupFaceMatchModel = async (
  options?: WarmupFaceMatchOptions
): Promise<boolean> => {
  const log = options?.log;
  const startedAt = nowMs();
  try {
    await loadLandmarker();
    log?.("warmup-ready", {
      elapsedMs: Math.round(nowMs() - startedAt),
    });
    return true;
  } catch (error) {
    log?.("warmup-failed", {
      elapsedMs: Math.round(nowMs() - startedAt),
      message: toErrorMessage(error),
    });
    return false;
  }
};

export const computeFaceMatch = async (
  idFront: File,
  selfies: File[],
  options?: ComputeFaceMatchOptions
): Promise<FaceMatchResult | null> => {
  const log = options?.log;
  if (!idFront || !selfies.length) {
    log?.("run-skipped", {
      reason: "missing-input",
      hasIdFront: Boolean(idFront),
      selfieCount: selfies.length,
    });
    return null;
  }
  const runStartedAt = nowMs();
  const budgetMs = Math.max(2000, Math.round(options?.budgetMs || 8000));
  const maxSelfies = Math.max(1, Math.min(selfies.length, options?.maxSelfies || 4));
  const selfiePool = selfies.slice(0, maxSelfies).filter(Boolean);
  log?.("run-start", {
    budgetMs,
    maxSelfies,
    selfiePool: selfiePool.length,
    idFrontBytes: idFront.size,
  });
  const elapsedMs = () => nowMs() - runStartedAt;
  const withinBudget = (stage: string) => {
    const elapsed = elapsedMs();
    if (elapsed <= budgetMs) return true;
    log?.("budget-exceeded", {
      stage,
      elapsedMs: Math.round(elapsed),
      budgetMs,
    });
    return false;
  };
  let idSignature: number[] | null = null;
  try {
    idSignature = await extractSignature(idFront, { label: "id-front", log });
  } catch (error) {
    log?.("id-signature-error", {
      message: toErrorMessage(error),
      elapsedMs: Math.round(elapsedMs()),
    });
    return null;
  }
  if (!idSignature) {
    log?.("id-signature-missing", {
      elapsedMs: Math.round(elapsedMs()),
    });
    return null;
  }
  const candidates: { distance: number; selfieIndex: number }[] = [];
  for (let index = 0; index < selfiePool.length; index += 1) {
    if (!withinBudget(`selfie-${index + 1}-start`)) break;
    await yieldToMainThread();
    const selfie = selfiePool[index];
    if (!selfie) continue;
    let selfieSignature: number[] | null = null;
    try {
      selfieSignature = await extractSignature(selfie, {
        label: `selfie-${index + 1}`,
        log,
      });
    } catch (error) {
      log?.("selfie-signature-error", {
        selfieIndex: index,
        message: toErrorMessage(error),
      });
      continue;
    }
    if (!selfieSignature) {
      log?.("selfie-signature-missing", { selfieIndex: index });
      continue;
    }
    const distance = signatureDistance(idSignature, selfieSignature);
    if (Number.isFinite(distance)) {
      candidates.push({ distance, selfieIndex: index });
      log?.("candidate-added", {
        selfieIndex: index,
        distance: Number(distance.toFixed(6)),
      });
      if (distance <= DEFAULT_MAX_DISTANCE * 0.7) {
        log?.("early-stop-strong-match", {
          selfieIndex: index,
          distance: Number(distance.toFixed(6)),
        });
        break;
      }
    }
  }
  if (!candidates.length) {
    log?.("run-complete-empty", {
      elapsedMs: Math.round(elapsedMs()),
    });
    return null;
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  const result = {
    distance: best.distance,
    score: scoreFromDistance(best.distance),
    selfieIndex: best.selfieIndex,
    comparedCount: candidates.length,
  };
  log?.("run-complete", {
    elapsedMs: Math.round(elapsedMs()),
    bestDistance: Number(result.distance.toFixed(6)),
    bestScore: Number(result.score.toFixed(4)),
    bestSelfieIndex: result.selfieIndex,
    comparedCount: result.comparedCount,
  });
  return result;
};
