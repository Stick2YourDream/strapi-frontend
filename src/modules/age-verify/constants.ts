export const AGE_VERIFY_BASE_PATH = String(
  import.meta.env.VITE_AGE_VERIFY_BASE_PATH || "/age-verify"
)
  .trim()
  .replace(/\/+$/, "") || "/age-verify";
