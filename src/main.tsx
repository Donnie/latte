import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { applyTheme, initialTheme } from "./lib/theme";
import "./styles/global.css";

registerSW({ immediate: true });

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
