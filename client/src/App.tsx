import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import Home from "@/pages/Home";
import Admin from "@/pages/Admin";
import Dashboard from "@/pages/Dashboard";
import AuthPage from "@/pages/AuthPage";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { InfluencerSection } from "./components/InfluencerSection";
import { ThemeProvider } from "./contexts/ThemeContext";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/admin"} component={Admin} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/dashboard/:section"} component={Dashboard} />
      <Route path={"/r/:referralCode/:side"} component={AuthPage} />
      <Route path={"/auth"} component={AuthPage} />
      {import.meta.env.DEV && <Route path={"/__preview/influencers"}><main style={{maxWidth:1500,margin:"0 auto",padding:24}}><InfluencerSection preview /></main></Route>}
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
