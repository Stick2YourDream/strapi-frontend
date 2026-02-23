export type TimeLimitSettings = {
  enabled?: boolean;
  durationMinutes?: number;
  cooldownUntil?: string | null;
};

export const TIME_LIMIT_MINUTES_MIN = 10;
export const TIME_LIMIT_MINUTES_MAX = 240;
export const DEFAULT_TIME_LIMIT_MINUTES = 60;

const clampMinutes = (value: number) =>
  Math.min(TIME_LIMIT_MINUTES_MAX, Math.max(TIME_LIMIT_MINUTES_MIN, value));

export const normalizeTimeLimitSettings = (
  settings?: TimeLimitSettings | null
): Required<Pick<TimeLimitSettings, "enabled" | "durationMinutes">> &
  Pick<TimeLimitSettings, "cooldownUntil"> => {
  const rawMinutes = Number(settings?.durationMinutes ?? DEFAULT_TIME_LIMIT_MINUTES);
  const minutes = Number.isFinite(rawMinutes)
    ? clampMinutes(Math.round(rawMinutes))
    : DEFAULT_TIME_LIMIT_MINUTES;
  const cooldownUntil =
    typeof settings?.cooldownUntil === "string" && settings.cooldownUntil.trim()
      ? settings.cooldownUntil
      : null;
  return {
    enabled: Boolean(settings?.enabled),
    durationMinutes: minutes,
    cooldownUntil,
  };
};

export const TIME_LIMIT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 10, label: "10 minutes" },
  { value: 20, label: "20 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1 hour 30 minutes" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
  { value: 240, label: "4 hours" },
];

export const parseCooldownUntilMs = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
};
