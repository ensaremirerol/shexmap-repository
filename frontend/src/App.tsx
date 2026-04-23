import { Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell.js';
import ProtectedRoute from './components/auth/ProtectedRoute.js';
import HomePage from './pages/HomePage.js';
import BrowsePage from './pages/BrowsePage.js';
import PairingPage from './pages/PairingPage.js';
import ShExMapPage from './pages/ShExMapPage.js';
import SubmitPage from './pages/SubmitPage.js';
import CoveragePage from './pages/CoveragePage.js';
import SparqlPage from './pages/SparqlPage.js';
import DashboardPage from './pages/DashboardPage.js';
import ValidatePage from './pages/ValidatePage.js';
import CreateMapPage from './pages/CreateMapPage.js';
import CreatePairingPage from './pages/CreatePairingPage.js';
import AuthCallbackPage from './pages/AuthCallbackPage.js';
import NotFoundPage from './pages/NotFoundPage.js';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/pairings/:id" element={<PairingPage />} />
        <Route path="/maps/:id" element={<ShExMapPage />} />
        <Route path="/submit" element={<SubmitPage />} />
        <Route path="/coverage" element={<CoveragePage />} />
        <Route path="/query" element={<SparqlPage />} />
        <Route path="/validate" element={<ValidatePage />} />
        <Route path="/maps/new" element={<CreateMapPage />} />
        <Route path="/pairings/create" element={<CreatePairingPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}
