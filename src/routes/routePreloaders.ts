import type { ComponentType } from "react";

type RouteModule = { default: ComponentType };
type RouteLoader = () => Promise<RouteModule>;

type NetworkInformationLike = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
};

const createMemoizedRouteLoader = (loader: RouteLoader): RouteLoader => {
  let pending: Promise<RouteModule> | null = null;
  return () => {
    if (!pending) {
      pending = loader().catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
};

const matchesRoutePrefix = (path: string, prefix: string) =>
  path === prefix ||
  path.startsWith(`${prefix}/`) ||
  path.startsWith(`${prefix}?`) ||
  path.startsWith(`${prefix}#`);

const getNetworkInformation = (): NetworkInformationLike | null => {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
};

export const loadDashboardRoute = createMemoizedRouteLoader(
  () => import("../pages/dashboard")
);
export const loadMeRoute = createMemoizedRouteLoader(() => import("../pages/me"));
export const loadStorefrontSellerRoute = createMemoizedRouteLoader(
  () => import("../pages/storefront-seller")
);

export const preloadDashboardRoute = () => {
  void loadDashboardRoute();
};

export const preloadMeRoute = () => {
  void loadMeRoute();
};

export const preloadStorefrontSellerRoute = () => {
  void loadStorefrontSellerRoute();
};

export const preloadCriticalRouteForPath = (path: string) => {
  const normalized = String(path || "").trim().toLowerCase();
  if (!normalized.startsWith("/")) return false;
  if (matchesRoutePrefix(normalized, "/dashboard")) {
    preloadDashboardRoute();
    return true;
  }
  if (matchesRoutePrefix(normalized, "/me")) {
    preloadMeRoute();
    return true;
  }
  if (matchesRoutePrefix(normalized, "/storefront/seller")) {
    preloadStorefrontSellerRoute();
    return true;
  }
  return false;
};

export const canWarmCriticalRouteChunks = () => {
  const connection = getNetworkInformation();
  if (!connection) return true;
  if (connection.saveData) return false;

  const effectiveType = String(connection.effectiveType || "").toLowerCase();
  if (effectiveType === "slow-2g" || effectiveType === "2g") {
    return false;
  }

  const downlink = Number(connection.downlink || 0);
  if (downlink > 0 && downlink < 1) {
    return false;
  }
  return true;
};
