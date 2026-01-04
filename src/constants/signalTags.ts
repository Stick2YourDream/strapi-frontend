export const SIGNAL_TAGS = [
  { value: "win", label: "Win" },
  { value: "blocker", label: "Blocker" },
  { value: "feedback", label: "Feedback" },
  { value: "check-in", label: "Check-in" },
] as const;

export type SignalTag = (typeof SIGNAL_TAGS)[number]["value"];

export const formatSignalTag = (value?: string) => {
  const match = SIGNAL_TAGS.find((tag) => tag.value === value);
  return match ? match.label : "Check-in";
};
