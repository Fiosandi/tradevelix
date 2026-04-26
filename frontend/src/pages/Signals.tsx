import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { dashboardApi } from '../api';
import type { TradeSignal } from '../types';
import { TrendingUp, Target, AlertTriangle, ArrowUpRight } from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rp  = (v: number | null | undefined) => v == null ? '—' : `Rp ${Math.round(v).toLocaleString('id-ID')}`;
const pct = (v: number | null | undefined) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const pctColor = (v: number | null | undefined) => !v ? 'var(--sub)' : v > 0 ? 'var(--buy)' : 'var(--sell)';

const SIG: Record<string, { label: string; color: string; bg: string }> = {
  STRONG_BUY: { label: 'STRONG BUY', color: 'var(--buy)',   bg: 'var(--buy-dim)'   },
  BUY:        { label: 'BUY',        color: 'var(--buy)',   bg: 'var(--buy-dim)'   },
};

// ─── Signal card ──────────────────────────────────────────────────────────────

const SignalCard: React.FC<{ s: TradeSignal; onClick: () => void }> = ({ s, onClick }) => {
  const sig = SIG[s.action] ?? SIG.BUY;
  const entry = s.entry_price ?? 0;
  const stop  = s.stop_loss   ?? 0;
  const t1    = s.target_1    ?? 0;
  const t2    = s.target_2    ?? 0;
  const cp    = s.current_price ?? entry;

  // Progress bar: position of current price between stop and T2
  const range = t2 - stop;
  const progress = range > 0 ? Math.min(Math.max((cp - stop) / range * 100, 0), 100) : 0;

  // Zone color based on where price is
  const zone = cp <= stop ? 'var(--sell)' : cp >= t2 ? 'var(--buy)' : cp >= t1 ? '#22d3ee' : cp > entry ? 'var(--buy)' : 'var(--watch)';

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderLeft: `4px solid ${sig.color}`,
        borderRadius: 12, padding: '16px 20px', cursor: 'pointer',
        transition: 'transform 0.1s, border-color 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'none')}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', fontFamily: 'monospace' }}>{s.ticker}</span>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 100, color: sig.color, background: sig.bg }}>
              ● {sig.label}
            </span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{s.confidence}%</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--sub)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: pctColor(s.pnl_pct) }}>
            {s.pnl_pct != null ? pct(s.pnl_pct) : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>vs entry</div>
        </div>
      </div>

      {/* Price ladder */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted)', marginBottom: 4, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <span>Stop</span><span>Entry</span><span>T1 +12%</span><span>T2 +25%</span>
        </div>
        <div style={{ position: 'relative', height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'visible', marginBottom: 4 }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, height: '100%',
            width: `${progress}%`, borderRadius: 4,
            background: `linear-gradient(to right, var(--sell), var(--watch), var(--buy))`,
            transition: 'width 0.3s',
          }} />
          {cp > 0 && (
            <div style={{
              position: 'absolute', top: -3, left: `${progress}%`,
              transform: 'translateX(-50%)',
              width: 14, height: 14, borderRadius: '50%',
              background: zone, border: '2px solid var(--surface)',
              boxShadow: `0 0 6px ${zone}`,
            }} />
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: 'monospace', color: 'var(--sub)' }}>
          <span style={{ color: 'var(--sell)' }}>{rp(stop)}</span>
          <span style={{ color: 'var(--floor)' }}>{rp(entry)}</span>
          <span style={{ color: '#22d3ee' }}>{rp(t1)}</span>
          <span style={{ color: 'var(--buy)' }}>{rp(t2)}</span>
        </div>
      </div>

      {/* Bullets + whale brokers */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          {s.key_bullets.slice(0, 3).map((b, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--sub)', marginBottom: 2 }}>
              · {b}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flex: 0, gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {s.whale_brokers.map(b => (
            <span key={b} style={{
              fontSize: 9, fontWeight: 700, fontFamily: 'monospace',
              padding: '2px 6px', borderRadius: 4,
              color: 'var(--whale)', background: 'rgba(112,86,255,.12)',
              border: '1px solid rgba(112,86,255,.3)',
            }}>🐋 {b}</span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {s.volume_confirmed && (
            <span style={{ fontSize: 9, color: 'var(--buy)', background: 'var(--buy-dim)', padding: '2px 7px', borderRadius: 4, fontWeight: 700 }}>
              ✓ VPA UP
            </span>
          )}
          <span style={{ fontSize: 9, color: 'var(--muted)' }}>
            Current: <strong style={{ color: 'var(--text)', fontFamily: 'monospace' }}>{rp(s.current_price)}</strong>
          </span>
        </div>
        <ArrowUpRight size={13} style={{ color: 'var(--muted)' }} />
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

const Signals: React.FC = () => {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (dashboardApi as any).getTradeSignals?.()
      .then((r: any) => setSignals(r.signals ?? []))
      .catch((e: any) => setError(e.response?.data?.detail ?? e.message))
      .finally(() => setLoading(false));
  }, []);

  const strong = signals.filter(s => s.action === 'STRONG_BUY');
  const buy    = signals.filter(s => s.action === 'BUY');

  return (
    <Layout subtitle="Active Signals">
      <div style={{ padding: '20px 28px' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
            Trade Signals
          </h1>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>
            Generated from Three Doors analysis · Entry / Stop / T1 +12% / T2 +25% · Expires in 30 days
          </p>
        </div>

        {/* Stats row */}
        {signals.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Active Signals', value: signals.length, color: 'var(--text)', icon: <Target size={14} /> },
              { label: 'Strong Buy',     value: strong.length, color: 'var(--buy)',  icon: <TrendingUp size={14} /> },
              { label: 'Buy',            value: buy.length,    color: '#22d3ee',     icon: <TrendingUp size={14} /> },
              {
                label: 'Avg P&L',
                value: signals.filter(s => s.pnl_pct != null).length
                  ? `${(signals.reduce((a, s) => a + (s.pnl_pct ?? 0), 0) / signals.filter(s => s.pnl_pct != null).length).toFixed(1)}%`
                  : '—',
                color: pctColor(signals.reduce((a, s) => a + (s.pnl_pct ?? 0), 0)),
                icon: <AlertTriangle size={14} />,
              },
            ].map(stat => (
              <div key={stat.label} style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '12px 18px',
                display: 'flex', alignItems: 'center', gap: 10, minWidth: 130,
              }}>
                <span style={{ color: stat.color, opacity: 0.8 }}>{stat.icon}</span>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{stat.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: stat.color, fontFamily: 'monospace' }}>{stat.value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--sell-dim)', border: '1px solid var(--sell)', color: 'var(--sell)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12 }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--floor)' }} className="spin" />
          </div>
        )}

        {!loading && signals.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📡</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>No active signals</div>
            <div style={{ fontSize: 12 }}>Signals are generated after each weekly sync + calculation. Run Admin → Calculate to generate them.</div>
          </div>
        )}

        {/* Strong Buy */}
        {strong.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--buy)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <TrendingUp size={12} /> Strong Buy · {strong.length} signal{strong.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
              {strong.map(s => <SignalCard key={s.id} s={s} onClick={() => navigate(`/stock/${s.ticker}`)} />)}
            </div>
          </div>
        )}

        {/* Buy */}
        {buy.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#22d3ee', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <TrendingUp size={12} /> Buy · {buy.length} signal{buy.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
              {buy.map(s => <SignalCard key={s.id} s={s} onClick={() => navigate(`/stock/${s.ticker}`)} />)}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Signals;
