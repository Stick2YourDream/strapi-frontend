export {};

declare global {
  type YspDesktopHelperPayload =
    | string
    | {
        code?: string;
        autoConnect?: boolean;
      };

  type YspDesktopMenuDevice = {
    id: string;
    label: string;
  };

  type YspDesktopCallMenuState = {
    visible: boolean;
    canManageCall?: boolean;
    canMuteEveryone?: boolean;
    canStopAllScreens?: boolean;
    audioDevices?: YspDesktopMenuDevice[];
    videoDevices?: YspDesktopMenuDevice[];
    selectedAudioInputId?: string;
    selectedVideoInputId?: string;
  };

  type YspDesktopMenuAction = {
    action:
      | "open-settings"
      | "mute-everyone"
      | "stop-all-screens"
      | "select-audio-input"
      | "select-video-input";
    deviceId?: string;
  };

  interface YspDesktopBridge {
    isAvailable: boolean;
    platform?: string;
    openHelper?: (payload?: YspDesktopHelperPayload) => Promise<boolean>;
    openExternal?: (url: string) => Promise<boolean>;
    toggleFullScreen?: () => Promise<boolean>;
    setFullScreen?: (value: boolean) => Promise<boolean>;
    isFullScreen?: () => Promise<boolean>;
    setCallMenuState?: (state: YspDesktopCallMenuState) => Promise<boolean>;
    onMenuAction?: (listener: (action: YspDesktopMenuAction) => void) => () => void;
  }

  interface Window {
    yspDesktop?: YspDesktopBridge;
  }
}
