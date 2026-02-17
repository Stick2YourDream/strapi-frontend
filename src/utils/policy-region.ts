import type { PolicyRegionId } from "../content/policy-regions";
import { POLICY_REGIONS } from "../content/policy-regions";

export const POLICY_REGION_STORAGE_KEY = "ysp_policy_region_v1";

const REGION_IDS = new Set(POLICY_REGIONS.map((region) => region.id));

export const normalizePolicyRegion = (value?: string | null): PolicyRegionId => {
  const raw = (value || "").trim().toLowerCase();
  if (REGION_IDS.has(raw as PolicyRegionId)) {
    return raw as PolicyRegionId;
  }
  return "us";
};

export const inferPolicyRegionFromLocale = (locale?: string | null): PolicyRegionId => {
  const raw = (locale || "").toLowerCase();
  if (!raw) return "us";
  if (raw.includes("en-us") || raw.includes("us")) return "us";
  if (raw.includes("en-gb") || raw.includes("gb") || raw.startsWith("fr") || raw.startsWith("de") || raw.startsWith("es") || raw.startsWith("it") || raw.startsWith("nl") || raw.startsWith("pt-pt") || raw.startsWith("sv") || raw.startsWith("da") || raw.startsWith("no") || raw.startsWith("fi")) {
    return "eea_uk";
  }
  if (raw.includes("ca") || raw.startsWith("fr-ca")) return "ca";
  if (raw.includes("au") || raw.includes("nz")) return "anz";
  if (raw.startsWith("ja") || raw.includes("jp")) return "jp";
  if (raw.startsWith("pt-br") || raw.includes("br")) return "br";
  return "global";
};

export const getInitialPolicyRegion = (): PolicyRegionId => {
  if (typeof window === "undefined") return "us";
  const stored = window.localStorage.getItem(POLICY_REGION_STORAGE_KEY);
  if (stored) return normalizePolicyRegion(stored);
  return inferPolicyRegionFromLocale(window.navigator.language);
};
