const NEWS_KEY_PREFIX = "ysp-news-enabled";

export const newsPreferenceKeyFor = (userId?: number | null) =>
  userId ? `${NEWS_KEY_PREFIX}-${userId}` : `${NEWS_KEY_PREFIX}-guest`;

export const readNewsPreference = (userId?: number | null): boolean | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(newsPreferenceKeyFor(userId));
  if (raw === null) return null;
  return raw === "true";
};

export const writeNewsPreference = (
  userId: number | null | undefined,
  value: boolean
) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    newsPreferenceKeyFor(userId),
    value ? "true" : "false"
  );
  window.dispatchEvent(new Event("ysp-news-updated"));
};
