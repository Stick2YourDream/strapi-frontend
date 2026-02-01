export const SIGNAL_TAGS = [
  { value: "none", label: "None" },
  { value: "win", label: "Win" },
  { value: "blocker", label: "Blocker" },
  { value: "feedback", label: "Feedback" },
  { value: "check-in", label: "Check-in" },
  { value: "support-request", label: "Support request" },
] as const;

export type SignalTag = (typeof SIGNAL_TAGS)[number]["value"];

export const formatSignalTag = (value?: string) => {
  if (!value || value === "none") return "";
  const match = SIGNAL_TAGS.find((tag) => tag.value === value);
  return match ? match.label : "";
};
