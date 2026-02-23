import api from "../api/strapi";

export type DesktopOs = "windows" | "macos" | "linux" | "unknown";

export const detectDesktopOs = (): DesktopOs => {
  if (typeof navigator === "undefined") return "unknown";
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    "";
  const ua = navigator.userAgent || "";
  const isWindows = /Win/i.test(platform) || /Windows/i.test(ua);
  const isMac = /Mac/i.test(platform) || /Macintosh/i.test(ua);
  const isLinux = /Linux/i.test(platform) || /X11/i.test(ua);
  if (isWindows) return "windows";
  if (isMac) return "macos";
  if (isLinux) return "linux";
  return "unknown";
};

const parseFilenameFromDisposition = (value?: string | null) => {
  if (!value) return null;
  const utf8Match = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/["']/g, ""));
    } catch {
      return utf8Match[1].replace(/["']/g, "");
    }
  }
  const asciiMatch = value.match(/filename\s*=\s*"?([^\";]+)"?/i);
  return asciiMatch?.[1]?.trim() || null;
};

export const getExportFilename = (os: DesktopOs, userId?: number) => {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const idPart = userId ? `-${userId}` : "";
  const osPart = os !== "unknown" ? `-${os}` : "";
  return `ysp-profile-export${idPart}${osPart}-${dateStamp}.zip`;
};

export const getExportInstructions = (os: DesktopOs) => {
  switch (os) {
    case "windows":
      return "On Windows, right-click the zip and choose “Extract All…”.";
    case "macos":
      return "On macOS, double-click the zip to extract it in Finder.";
    case "linux":
      return "On Linux, open with Archive Manager or run `unzip`.";
    default:
      return "Extract the zip with your system’s archive tool.";
  }
};

export const exportProfileArchive = async (options?: {
  userId?: number;
  os?: DesktopOs;
}) => {
  const response = await api.get("/account/export", { responseType: "blob" });
  const contentDisposition = response.headers?.["content-disposition"] as string | undefined;
  const headerName = parseFilenameFromDisposition(contentDisposition);
  const os = options?.os ?? detectDesktopOs();
  const fallbackName = getExportFilename(os, options?.userId);
  const blob =
    response.data instanceof Blob
      ? response.data
      : new Blob([response.data], { type: "application/zip" });
  const filename = os !== "unknown" ? fallbackName : headerName || fallbackName;
  return { blob, filename, os };
};

export const downloadBlob = (blob: Blob, filename: string) => {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
