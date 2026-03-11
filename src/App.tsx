import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
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
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/wizard" element={<Wizard />} />
            <Route path="/services" element={<Services />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/dns" element={<DnsPage />} />
            <Route path="/nat" element={<NatPage />} />
            <Route path="/ospf" element={<OspfPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/troubleshoot" element={<TroubleshootPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
