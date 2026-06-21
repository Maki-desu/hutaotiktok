import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Home from "@/pages/home";
import Notifications from "@/pages/notifications";
import History from "@/pages/history";
import Admin from "@/pages/admin";
import Showcase from "@/pages/showcase";
import Analyze from "@/pages/analyze";
import NotFound from "@/pages/not-found";
import { setExtraHeaders } from "@workspace/api-client-react";

const queryClient = new QueryClient();

// Initialize admin token from localStorage so protected API calls work on page reload
const storedToken = localStorage.getItem("admin_token");
if (storedToken) {
  setExtraHeaders({ "x-admin-token": storedToken });
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/showcase" component={Showcase} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/history" component={History} />
      <Route path="/admin" component={Admin} />
      <Route path="/analyze" component={Analyze} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
