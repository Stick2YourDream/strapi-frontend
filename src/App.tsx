// src/App.tsx
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import ConsentBanner from "./components/ConsentBanner";

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <ConsentBanner />
    </BrowserRouter>
  );
}
