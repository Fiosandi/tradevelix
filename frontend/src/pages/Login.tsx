import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Invalid email or password');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div onClick={() => navigate('/')} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 28 }}>🦈</span>
            <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em' }}>Tradevelix</span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--sub)' }}>Sign in to your account</div>
        </div>

        {/* Card */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 28px' }}>
          <form onSubmit={submit}>

            {error && (
              <div style={{ background: 'var(--sell-dim)', border: '1px solid var(--sell)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--sell)' }}>
                {error}
              </div>
            )}

            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 6 }}>EMAIL</label>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{ width: '100%', height: 44, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 14px', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target.style.borderColor = 'var(--floor)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 6 }}>PASSWORD</label>
              <input
                type="password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ width: '100%', height: 44, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 14px', fontSize: 14, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target.style.borderColor = 'var(--floor)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
            </div>

            <button type="submit" disabled={loading} style={{ width: '100%', height: 46, background: loading ? 'var(--border)' : 'var(--buy)', color: '#000', fontWeight: 700, border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 15 }}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--sub)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--buy)', fontWeight: 600, textDecoration: 'none' }}>Create one</Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
