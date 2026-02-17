export type PolicyRegionId = "us" | "eea_uk" | "ca" | "anz" | "jp" | "br" | "global";

export const POLICY_REGIONS: Array<{
  id: PolicyRegionId;
  label: string;
  description: string;
}> = [
  {
    id: "us",
    label: "United States",
    description: "U.S. federal and state consumer protections apply.",
  },
  {
    id: "eea_uk",
    label: "European Economic Area (EEA) + United Kingdom",
    description: "GDPR and UK GDPR rights apply.",
  },
  {
    id: "ca",
    label: "Canada",
    description: "PIPEDA and provincial privacy laws apply.",
  },
  {
    id: "anz",
    label: "Australia + New Zealand",
    description: "APPs and NZ Privacy Act protections apply.",
  },
  {
    id: "jp",
    label: "Japan",
    description: "APPI protections apply.",
  },
  {
    id: "br",
    label: "Brazil",
    description: "LGPD protections apply.",
  },
  {
    id: "global",
    label: "Rest of world",
    description: "Local consumer and privacy laws apply.",
  },
];
