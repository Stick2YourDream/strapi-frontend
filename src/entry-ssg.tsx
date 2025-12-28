import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import AppRoutes from "./routes/AppRoutes";
import { StaticAuthProvider } from "./context/AuthContext";
import { ChatProvider } from "./context/ChatContext";
import { UserPreferencesProvider } from "./context/UserPreferencesContext";
import ChatDock from "./components/ChatDock";
import ConsentBanner from "./components/ConsentBanner";

type RenderResult = {
  html: string;
};

export const render = (url: string): RenderResult => {
  const app = (
    <StaticRouter location={url}>
      <StaticAuthProvider>
        <UserPreferencesProvider>
          <ChatProvider>
            <AppRoutes />
            <ChatDock />
            <ConsentBanner />
          </ChatProvider>
        </UserPreferencesProvider>
      </StaticAuthProvider>
    </StaticRouter>
  );

  return { html: renderToString(app) };
};
