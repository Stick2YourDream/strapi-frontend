const pluralize = (value: number, unit: string) =>
  `${value} ${unit}${value === 1 ? "" : "s"} ago`;

export const formatPostUpdateLabel = (value?: string | number | Date) => {
  if (!value) return "posted an update";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "posted an update";

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "posted an update";

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return "just posted an update";

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `posted an update ${pluralize(hours, "hour")}`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `posted an update ${pluralize(days, "day")}`;
  if (days < 30) {
    const weeks = Math.max(1, Math.floor(days / 7));
    return `posted an update ${pluralize(weeks, "week")}`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) return `posted an update ${pluralize(months, "month")}`;

  const years = Math.max(1, Math.floor(days / 365));
  return `posted an update ${pluralize(years, "year")}`;
};
