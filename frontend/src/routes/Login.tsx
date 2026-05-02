import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { TrendingUp, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Login: React.FC = () => {
  const { user, login, register, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: { pathname?: string } } };
  const redirectTo = loc.state?.from?.pathname || '/';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail]       = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);

  if (user) return <Navigate to={redirectTo} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else                  await register(email, username, password);
      nav(redirectTo, { replace: true });
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || 'Auth failed');
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={20} className="text-buy" />
          <span className="font-bold text-lg tracking-tight">Tradevelix</span>
        </div>
        <p className="text-xs text-sub mb-6">
          {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-muted">Email</span>
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:border-floor focus:outline-none"
              autoComplete="email"
            />
          </label>

          {mode === 'register' && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide font-semibold text-muted">Username</span>
              <input
                type="text" required value={username}
                onChange={e => setUsername(e.target.value)}
                className="bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:border-floor focus:outline-none"
                autoComplete="username"
              />
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-muted">Password</span>
            <input
              type="password" required value={password}
              onChange={e => setPassword(e.target.value)}
              className="bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:border-floor focus:outline-none"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && (
            <div className="bg-sell-dim text-sell text-xs rounded-lg px-3 py-2 border border-sell/30">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="bg-buy text-bg rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-xs text-sub hover:text-text"
          >
            {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};
