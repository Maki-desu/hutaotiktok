import React, { Component, ReactNode, useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadScreenTransition } from "@/lib/screen-transitions";
import {
  loadDropdownAnimation,
  loadDropdownSpeed,
  saveDropdownAnimation,
  saveDropdownSpeed,
} from "@/lib/dropdown-animations";
import { applyThemeCustomization, loadThemeCustomization } from "@/lib/theme-customization";
import { loadUiStyle, saveUiStyle } from "@/lib/ui-style";
import { Layout } from "@/components/layout";
import { SplashIntro } from "@/components/splash-intro";
import Home from "@/pages/home";
import History from "@/pages/history";
import Updates from "@/pages/updates";
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
const storedToken = localStorage.getItem("admin_token");
if (storedToken) {
  setExtraHeaders({ "x-admin-token": storedToken });
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

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "") || "/";
      setRoute(hash);
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();

    return () => window.removeEventListener("hashchange", handleHashChange);
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

  const transition = loadScreenTransition();
  return (
    <div
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
    const customization = loadThemeCustomization();
    if (customization) applyThemeCustomization(customization);
    saveUiStyle(loadUiStyle());
    saveDropdownAnimation(loadDropdownAnimation());
    saveDropdownSpeed(loadDropdownSpeed());

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
                <Layout>
                  <Router />
                </Layout>
                <AppUpdateChecker />
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
