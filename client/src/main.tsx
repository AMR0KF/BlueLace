import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LanguageProvider } from "./lib/i18n";
import { AppStateProvider } from "./state/AppState";
import "./styles/fonts.css";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/500.css";
import "@fontsource/tajawal/700.css";
import "./styles/base.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </LanguageProvider>
  </StrictMode>,
);
