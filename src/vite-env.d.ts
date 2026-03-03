/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_NEWS_PROXY_URL?: string;
  readonly VITE_NEWS_API_URL?: string;
  readonly VITE_NEWS_API_KEY?: string;
  readonly VITE_NEWS_ACCESS_MODE?: string;
  readonly VITE_ANDROID_APK_VERSION?: string;
  readonly VITE_ANDROID_APK_CODE?: string;
  readonly VITE_RELEASE_NOTES_VERSION?: string;
  readonly VITE_MEDIAPIPE_VISION_URL?: string;
  readonly VITE_FACE_LANDMARKER_MODEL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
