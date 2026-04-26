import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './hooks/useTheme.tsx';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Landing     from './pages/Landing';
import Login       from './pages/Login';
import Register    from './pages/Register';
import Dashboard   from './pages/Dashboard';
import StockDetail from './pages/StockDetail';
import Admin       from './pages/Admin';
import Backtest    from './pages/Backtest';
import BrokerFlow  from './pages/BrokerFlow';
import Signals     from './pages/Signals';
import Ownership   from './pages/Ownership';
import Alerts      from './pages/Alerts';

const App: React.FC = () => (
  <ThemeProvider>
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/"          element={<Landing />} />
          <Route path="/login"     element={<Login />} />
          <Route path="/register"  element={<Register />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/stock/:ticker" element={<ProtectedRoute><StockDetail /></ProtectedRoute>} />
          <Route path="/admin"     element={<ProtectedRoute><Admin /></ProtectedRoute>} />
          <Route path="/backtest"  element={<ProtectedRoute><Backtest /></ProtectedRoute>} />
          <Route path="/broker-flow" element={<ProtectedRoute><BrokerFlow /></ProtectedRoute>} />
          <Route path="/signals"    element={<ProtectedRoute><Signals /></ProtectedRoute>} />
          <Route path="/ownership"  element={<ProtectedRoute><Ownership /></ProtectedRoute>} />
          <Route path="/ownership/:ticker" element={<ProtectedRoute><Ownership /></ProtectedRoute>} />
          <Route path="/alerts"     element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
