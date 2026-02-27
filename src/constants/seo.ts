export const DEFAULT_ROBOTS_DIRECTIVES =
  "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";

export const NOINDEX_ROBOTS_DIRECTIVES =
  "noindex, nofollow, noarchive, nosnippet, max-image-preview:none, max-video-preview:-1";

const PRIVATE_EXACT_PATHS = new Set([
  "/dashboard",
  "/news",
  "/me",
  "/my-posts",
  "/my-gallery",
  "/post-manager",
  "/moderation",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/delete-account",
  "/delete-data",
  "/share",
  "/protocol",
]);

const PRIVATE_PREFIX_PATHS = [
  "/friends",
  "/groups",
  "/storefront",
  "/notes",
  "/age-verify",
];

export const PUBLIC_SITEMAP_PATHS = [
  "/",
  "/what-makes-us-different",
  "/apps",
  "/downloads",
  "/forums",
  "/terms",
  "/privacy",
  "/cookies",
  "/safety",
  "/report",
  "/support",
  "/guidelines",
  "/marketplace-policy",
  "/marketplace-fee-disclosure",
] as const;

const normalizePath = (pathname: string) => {
  if (!pathname) return "/";
  const noQuery = pathname.split("?")[0] || "/";
  const noHash = noQuery.split("#")[0] || "/";
  const normalized = noHash.endsWith("/") && noHash !== "/" ? noHash.slice(0, -1) : noHash;
  return normalized.toLowerCase();
};

const pathMatchesPrefix = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

export const isPrivateSeoPath = (pathname: string) => {
  const normalized = normalizePath(pathname);
  if (PRIVATE_EXACT_PATHS.has(normalized)) {
    return true;
  }
  return PRIVATE_PREFIX_PATHS.some((prefix) => pathMatchesPrefix(normalized, prefix));
};
