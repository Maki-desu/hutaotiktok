import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";
import {
  applyBounceAnimation,
  installGlobalTapBounce,
  loadBounceAnimationEnabled,
} from "@/lib/bounce-animation";
import {
  applyDisplayScale,
  applyTopBarOffset,
  loadDisplayScale,
  loadTopBarOffset,
} from "@/lib/display-scale";
import { applyFontStyle, loadFontStyle } from "@/lib/font-style";

applyBounceAnimation(loadBounceAnimationEnabled());
installGlobalTapBounce();
applyDisplayScale(loadDisplayScale());
applyTopBarOffset(loadTopBarOffset());
applyFontStyle(loadFontStyle());
setBaseUrl(import.meta.env.VITE_API_URL || null);

createRoot(document.getElementById("root")!).render(<App />);
