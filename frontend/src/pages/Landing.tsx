import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Landing: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
      fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column',
    }}>

      {/* ── Nav ───────────────────────────────────────────────────────── */}
      <nav style={{
        padding: '0 32px', height: 60, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🦈</span>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em' }}>Tradevelix</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {user ? (
            <button onClick={() => navigate('/dashboard')} style={primaryBtn}>
              Open dashboard
            </button>
          ) : (
            <>
              <button onClick={() => navigate('/login')} style={ghostBtn}>Sign in</button>
              <button onClick={() => navigate('/register')} style={primaryBtn}>Sign up</button>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 32px' }}>
        <div style={{ maxWidth: 560, textAlign: 'left' }}>
          <h1 style={{
            fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: 800,
            lineHeight: 1.15, letterSpacing: '-0.03em', margin: '0 0 20px',
          }}>
            Trading analysis tools<br />for IDX.
          </h1>

          <p style={{ fontSize: 16, color: 'var(--sub)', lineHeight: 1.6, margin: '0 0 28px' }}>
            A small set of tools I built to make sense of broker flow, ownership data, and price action on the
            Indonesian Stock Exchange. Nothing fancy — just charts, tables, and a few signals I actually use myself.
          </p>

          <ul style={{
            listStyle: 'none', padding: 0, margin: '0 0 36px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {[
              'Daily broker buy/sell with whale vs retail breakdown',
              'Monthly KSEI ownership composition',
              'Three Doors signal — whale net, retail exit, kekompakan',
              'Backtest your signals on the last 120 days',
            ].map(line => (
              <li key={line} style={{ fontSize: 14, color: 'var(--sub)', display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ color: 'var(--buy)', fontFamily: 'monospace', fontSize: 12 }}>—</span>
                {line}
              </li>
            ))}
          </ul>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate(user ? '/dashboard' : '/register')} style={primaryBtn}>
              {user ? 'Open dashboard' : 'Sign up'}
            </button>
            {!user && (
              <button onClick={() => navigate('/login')} style={ghostBtn}>
                Sign in
              </button>
            )}
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 4 }}>Free for now.</span>
          </div>
        </div>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid var(--border)', padding: '20px 32px',
        display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
        fontSize: 12, color: 'var(--muted)',
      }}>
        <span>Built for IDX traders. Data via Market Reaper.</span>
        <span>Educational use — not financial advice.</span>
      </footer>
    </div>
  );
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 8,
  background: 'var(--buy)', color: '#000', fontWeight: 700,
  border: 'none', cursor: 'pointer', fontSize: 13,
};

const ghostBtn: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 8,
  background: 'transparent', color: 'var(--sub)',
  border: '1px solid var(--border)', cursor: 'pointer', fontSize: 13,
};

export default Landing;
