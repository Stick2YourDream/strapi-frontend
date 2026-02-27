/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_ANDROID_APK_VERSION?: string;
  readonly VITE_ANDROID_APK_CODE?: string;
  readonly VITE_RELEASE_NOTES_VERSION?: string;
  readonly VITE_MEDIAPIPE_VISION_URL?: string;
  readonly VITE_FACE_LANDMARKER_MODEL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
