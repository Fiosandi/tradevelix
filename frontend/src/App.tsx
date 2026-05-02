import { Routes, Route } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './routes/Login';
import { Watchlist } from './routes/Watchlist';
import { Stock } from './routes/Stock';
import { Lab } from './routes/Lab';
import { Alerts } from './routes/Alerts';
import { Admin } from './routes/Admin';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Shell>
              <Routes>
                <Route path="/"            element={<Watchlist />} />
                <Route path="/s/:ticker"   element={<Stock />} />
                <Route path="/lab"         element={<Lab />} />
                <Route path="/alerts"      element={<Alerts />} />
                <Route path="/admin/*"     element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
              </Routes>
            </Shell>
          </ProtectedRoute>
        }
        path="*"
      />
    </Routes>
  );
}
