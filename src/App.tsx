import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import Dashboard from "@/pages/Dashboard";
import Wizard from "@/pages/Wizard";
import Services from "@/pages/Services";
import NetworkPage from "@/pages/NetworkPage";
import DnsPage from "@/pages/DnsPage";
import NatPage from "@/pages/NatPage";
import OspfPage from "@/pages/OspfPage";
import LogsPage from "@/pages/LogsPage";
import TroubleshootPage from "@/pages/TroubleshootPage";
import FilesPage from "@/pages/FilesPage";
import HistoryPage from "@/pages/HistoryPage";
import SettingsPage from "@/pages/SettingsPage";
import UsersPage from "@/pages/UsersPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const ProtectedApp = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <Layout>{children}</Layout>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ProtectedApp><Dashboard /></ProtectedApp>} />
            <Route path="/wizard" element={<ProtectedApp><Wizard /></ProtectedApp>} />
            <Route path="/services" element={<ProtectedApp><Services /></ProtectedApp>} />
            <Route path="/network" element={<ProtectedApp><NetworkPage /></ProtectedApp>} />
            <Route path="/dns" element={<ProtectedApp><DnsPage /></ProtectedApp>} />
            <Route path="/nat" element={<ProtectedApp><NatPage /></ProtectedApp>} />
            <Route path="/ospf" element={<ProtectedApp><OspfPage /></ProtectedApp>} />
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
