export {};

declare global {
  type YspDesktopHelperPayload =
    | string
    | {
        code?: string;
        autoConnect?: boolean;
      };

  interface YspDesktopBridge {
    isAvailable: boolean;
    platform?: string;
    openHelper?: (payload?: YspDesktopHelperPayload) => Promise<boolean>;
    openExternal?: (url: string) => Promise<boolean>;
    toggleFullScreen?: () => Promise<boolean>;
    setFullScreen?: (value: boolean) => Promise<boolean>;
    isFullScreen?: () => Promise<boolean>;
  }

  interface Window {
    yspDesktop?: YspDesktopBridge;
  }
}
