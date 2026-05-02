import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './routes/Login';
import { Watchlist } from './routes/Watchlist';
import { Stock } from './routes/Stock';
import { Lab } from './routes/Lab';
import { Alerts } from './routes/Alerts';
import { Admin } from './routes/Admin';

const ShelledLayout = () => (
  <Shell>
    <Outlet />
  </Shell>
);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Back-compat redirects from v1 URLs */}
      <Route path="/dashboard"          element={<Navigate to="/" replace />} />
      <Route path="/watchlist"          element={<Navigate to="/" replace />} />
      <Route path="/signals"            element={<Navigate to="/" replace />} />
      <Route path="/stock/:ticker"      element={<RedirectStock />} />
      <Route path="/broker-flow"        element={<Navigate to="/" replace />} />
      <Route path="/ownership"          element={<Navigate to="/" replace />} />
      <Route path="/backtest"           element={<Navigate to="/lab" replace />} />

      {/* Authenticated app shell */}
      <Route element={<ProtectedRoute><ShelledLayout /></ProtectedRoute>}>
        <Route path="/"            element={<Watchlist />} />
        <Route path="/s/:ticker"   element={<Stock />} />
        <Route path="/lab"         element={<Lab />} />
        <Route path="/alerts"      element={<Alerts />} />
        <Route path="/admin/*"     element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { useParams } from 'react-router-dom';
function RedirectStock() {
  const { ticker } = useParams();
  return <Navigate to={`/s/${ticker}`} replace />;
}
