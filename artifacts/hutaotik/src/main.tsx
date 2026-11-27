import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";
import { applyBounceAnimation, loadBounceAnimationEnabled } from "@/lib/bounce-animation";

applyBounceAnimation(loadBounceAnimationEnabled());
setBaseUrl(import.meta.env.VITE_API_URL || null);

createRoot(document.getElementById("root")!).render(<App />);
