import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { NocProvider } from "@/lib/noc-context";
import ProtectedRoute from "@/components/ProtectedRoute";
import SessionTimeoutModal from "@/components/SessionTimeoutModal";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/NotFound";

// Lazy-loaded pages
const ForceChangePasswordPage = lazy(() => import("@/pages/ForceChangePasswordPage"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Wizard = lazy(() => import("@/pages/Wizard"));
const Services = lazy(() => import("@/pages/Services"));
const NetworkPage = lazy(() => import("@/pages/NetworkPage"));
const DnsPage = lazy(() => import("@/pages/DnsPage"));
const NatPage = lazy(() => import("@/pages/NatPage"));
const OspfPage = lazy(() => import("@/pages/OspfPage"));
const LogsPage = lazy(() => import("@/pages/LogsPage"));
const TroubleshootPage = lazy(() => import("@/pages/TroubleshootPage"));
const FilesPage = lazy(() => import("@/pages/FilesPage"));
const HistoryPage = lazy(() => import("@/pages/HistoryPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const EventsPage = lazy(() => import("@/pages/EventsPage"));
const MetricsPage = lazy(() => import("@/pages/MetricsPage"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="flex items-center justify-center h-[60vh]">
    <div className="flex flex-col items-center gap-3">
      <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-xs text-muted-foreground">Carregando...</span>
    </div>
  </div>
);

const ProtectedApp = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <Layout>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </Layout>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <SessionTimeoutModal />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/force-change-password" element={<Suspense fallback={<PageLoader />}><ForceChangePasswordPage /></Suspense>} />
            <Route path="/" element={<ProtectedApp><Dashboard /></ProtectedApp>} />
            <Route path="/wizard" element={<ProtectedApp><Wizard /></ProtectedApp>} />
            <Route path="/services" element={<ProtectedApp><Services /></ProtectedApp>} />
            <Route path="/network" element={<ProtectedApp><NetworkPage /></ProtectedApp>} />
            <Route path="/dns" element={<ProtectedApp><DnsPage /></ProtectedApp>} />
            <Route path="/nat" element={<ProtectedApp><NatPage /></ProtectedApp>} />
            <Route path="/ospf" element={<ProtectedApp><OspfPage /></ProtectedApp>} />
            <Route path="/metrics" element={<ProtectedApp><MetricsPage /></ProtectedApp>} />
            <Route path="/events" element={<ProtectedApp><EventsPage /></ProtectedApp>} />
            <Route path="/logs" element={<ProtectedApp><LogsPage /></ProtectedApp>} />
            <Route path="/troubleshoot" element={<ProtectedApp><TroubleshootPage /></ProtectedApp>} />
            <Route path="/files" element={<ProtectedApp><FilesPage /></ProtectedApp>} />
            <Route path="/history" element={<ProtectedApp><HistoryPage /></ProtectedApp>} />
            <Route path="/settings" element={<ProtectedApp><SettingsPage /></ProtectedApp>} />
            <Route path="/users" element={<ProtectedApp><UsersPage /></ProtectedApp>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
