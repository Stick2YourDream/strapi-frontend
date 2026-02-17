import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import AppRoutes from "./routes/AppRoutes";
import { StaticAuthProvider } from "./context/AuthContext";
import { ChatProvider } from "./context/ChatContext";
import { TranslationProvider } from "./i18n/TranslationProvider";
import { UserPreferencesProvider } from "./context/UserPreferencesContext";
import { VideoCallProvider } from "./context/VideoCallContext";
import ChatDock from "./components/ChatDock";
import ConsentBanner from "./components/ConsentBanner";

type RenderResult = {
  html: string;
};

export const render = (url: string): RenderResult => {
  const app = (
    <StaticRouter location={url}>
      <TranslationProvider>
        <StaticAuthProvider>
          <UserPreferencesProvider>
            <ChatProvider>
              <VideoCallProvider>
                <AppRoutes />
                <ChatDock />
                <ConsentBanner />
              </VideoCallProvider>
            </ChatProvider>
          </UserPreferencesProvider>
        </StaticAuthProvider>
      </TranslationProvider>
    </StaticRouter>
  );

  return { html: renderToString(app) };
};
