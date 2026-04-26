import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Register: React.FC = () => {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const [email, setEmail]       = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    try {
      await register(email, username, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Registration failed');
    }
  };

  const inp = {
    width: '100%', height: 44, background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '0 14px', fontSize: 14, color: 'var(--text)', outline: 'none',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div onClick={() => navigate('/')} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 28 }}>🦈</span>
            <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em' }}>Tradevelix</span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--sub)' }}>Create your free account</div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 28px' }}>
          <form onSubmit={submit}>
            {error && (
              <div style={{ background: 'var(--sell-dim)', border: '1px solid var(--sell)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--sell)' }}>
                {error}
              </div>
            )}

            {[
              { label: 'EMAIL', type: 'email', val: email, set: setEmail, ph: 'you@example.com' },
              { label: 'USERNAME', type: 'text', val: username, set: setUsername, ph: 'yourname' },
              { label: 'PASSWORD', type: 'password', val: password, set: setPassword, ph: '8+ characters' },
            ].map(f => (
              <div key={f.label} style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)', display: 'block', marginBottom: 6 }}>{f.label}</label>
                <input
                  type={f.type} required value={f.val} onChange={e => f.set(e.target.value)}
                  placeholder={f.ph} style={inp}
                  onFocus={e => (e.target.style.borderColor = 'var(--floor)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                />
              </div>
            ))}

            <div style={{ marginBottom: 24 }} />

            <button type="submit" disabled={loading} style={{ width: '100%', height: 46, background: loading ? 'var(--border)' : 'var(--buy)', color: '#000', fontWeight: 700, border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 15 }}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--sub)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--buy)', fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
