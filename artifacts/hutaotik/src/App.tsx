import React, { Component, ReactNode, useState, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadScreenTransition, onScreenTransitionChanged } from "@/lib/screen-transitions";
import {
  applyBounceAnimation,
  loadBounceAnimationEnabled,
  onBounceAnimationChanged,
} from "@/lib/bounce-animation";
import {
  loadDropdownAnimation,
  loadDropdownSpeed,
  saveDropdownAnimation,
  saveDropdownSpeed,
} from "@/lib/dropdown-animations";
import { applyThemeCustomization, loadThemeCustomization } from "@/lib/theme-customization";
import { applyDisplayScale, applyTopBarOffset, loadDisplayScale, loadTopBarOffset } from "@/lib/display-scale";
import { applyFontStyle, loadFontStyle } from "@/lib/font-style";
import { loadUiStyle, saveUiStyle } from "@/lib/ui-style";
import { Layout } from "@/components/layout";
import { NotificationGate } from "@/components/notification-gate";
import { SplashIntro } from "@/components/splash-intro";
import Home from "@/pages/home";
import History from "@/pages/history";
import Updates from "@/pages/updates";
import Suggestions from "@/pages/suggestions";
import Settings from "@/pages/settings";
import TaotoolsPage from "@/pages/taotools";
import Admin from "@/pages/admin";
import Showcase from "@/pages/showcase";
import Analyze from "@/pages/analyze";
import Notifications from "@/pages/notifications";
import NotFound from "@/pages/not-found";
import { setExtraHeaders } from "@workspace/api-client-react";
import AdminPublisher from "@/pages/admin-publisher";
import PublishPreview from "@/pages/publish-preview";
import { AppUpdateChecker } from "@/components/app-update-checker";

const queryClient = new QueryClient();

// Initialize admin token from localStorage so protected API calls work on page reload
try {
  const storedToken = localStorage.getItem("admin_token");
  if (storedToken) {
    setExtraHeaders({ "x-admin-token": storedToken });
  }
} catch {
  /* ignore restricted storage */
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center text-destructive">
            ⚠️
          </div>
          <h1 className="text-xl font-bold">HutaoTik App Error</h1>
          <p className="text-xs text-muted-foreground max-w-sm">{this.state.error || "An unexpected error occurred."}</p>
          <button
            type="button"
            onClick={() => {
              window.location.hash = "#/";
              window.location.reload();
            }}
            className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-xl"
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Router() {
  const [route, setRoute] = useState(() => window.location.hash.replace("#", "") || "/");
  const [bounceEnabled, setBounceEnabled] = useState(() => loadBounceAnimationEnabled());
  const [savedTransition, setSavedTransition] = useState(() => loadScreenTransition());
  const transitionWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "") || "/";
      setRoute(hash);
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    const unsubscribeBounce = onBounceAnimationChanged(setBounceEnabled);
    const unsubscribeTransition = onScreenTransitionChanged((next) => {
      setSavedTransition(next);
      // Replay the new transition live without unmounting the current screen or closing <details>.
      requestAnimationFrame(() => {
        const el = transitionWrapperRef.current;
        if (!el || next === "none") return;
        el.style.animation = "none";
        void el.offsetWidth;
        el.style.animation = "";
      });
    });

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      unsubscribeBounce();
      unsubscribeTransition();
    };
  }, []);

  const cleanRoute = route.split("?")[0];

  let screen: ReactNode;
  switch (cleanRoute) {
    case "/":
    case "":
      screen = <Home />;
      break;
    case "/taotools":
      screen = <TaotoolsPage />;
      break;
    case "/history":
      screen = <History />;
      break;
    case "/updates":
      screen = <Updates />;
      break;
    case "/suggestions":
      screen = <Suggestions />;
      break;
    case "/settings":
      screen = <Settings />;
      break;
    case "/showcase":
      screen = <Showcase />;
      break;
    case "/notifications":
      screen = <Notifications />;
      break;
    case "/admin":
      screen = <Admin />;
      break;
    case "/publish-preview":
      screen = <PublishPreview />;
      break;
    case "/analyze":
      screen = <Analyze />;
      break;
    default:
      screen = <NotFound />;
  }

  const transition =
    !bounceEnabled && (savedTransition === "bounce" || savedTransition === "elastic")
      ? "fade"
      : savedTransition;
  return (
    <div
      ref={transitionWrapperRef}
      key={cleanRoute}
      className={transition === "none" ? undefined : `screen-transition screen-transition--${transition}`}
    >
      {screen}
    </div>
  );
}

function App() {
  const [publishPreview, setPublishPreview] = useState(
    () => window.location.hash.replace("#", "").split("?")[0] === "/publish-preview",
  );

  useEffect(() => {
    try {
      const customization = loadThemeCustomization();
      if (customization) applyThemeCustomization(customization);
      saveUiStyle(loadUiStyle());
      applyDisplayScale(loadDisplayScale());
      applyTopBarOffset(loadTopBarOffset());
      applyFontStyle(loadFontStyle());
      applyBounceAnimation(loadBounceAnimationEnabled());
      saveDropdownAnimation(loadDropdownAnimation());
      saveDropdownSpeed(loadDropdownSpeed());
    } catch (error) {
      console.error("Could not restore saved visual preferences.", error);
    }

    const handleHashChange = () => {
      setPublishPreview(window.location.hash.replace("#", "").split("?")[0] === "/publish-preview");
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const adminApp = import.meta.env.VITE_APP_MODE === "admin";

  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" forcedTheme="dark" defaultTheme="dark" storageKey="hutaotik-theme">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            {publishPreview ? (
              <PublishPreview />
            ) : adminApp ? (
              <AdminPublisher />
            ) : (
              <>
                <SplashIntro />
                <NotificationGate>
                  <Layout>
                    <Router />
                  </Layout>
                  <AppUpdateChecker />
                </NotificationGate>
              </>
            )}
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
