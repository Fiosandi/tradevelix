import React, { useState, useMemo } from 'react';
import { Layout } from '../components/Layout';
import { backtestApi } from '../api';
import type { BacktestResult, TradeResult } from '../types';
import { TrendingUp, Target, AlertTriangle, ChevronUp, ChevronDown, Play } from 'lucide-react';

// ─── Formatters ───────────────────────────────────────────────────────────────

const rp = (v: number) => `Rp ${Math.round(v).toLocaleString('id-ID')}`;
const pct = (v: number) => (v > 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`);
const pctColor = (v: number) => v > 0 ? 'var(--buy)' : v < 0 ? 'var(--sell)' : 'var(--muted)';

const EXIT_META: Record<string, { label: string; color: string; bg: string }> = {
  TARGET_2:  { label: 'T2 +25%', color: 'var(--buy)',   bg: 'var(--buy-dim)' },
  TARGET_1:  { label: 'T1 +12%', color: '#22d3ee',      bg: 'rgba(34,211,238,0.08)' },
  STOP_LOSS: { label: 'Stop',    color: 'var(--sell)',   bg: 'var(--sell-dim)' },
  TIME_STOP: { label: 'Time',    color: 'var(--muted)',  bg: 'var(--card)' },
  NO_DATA:   { label: 'No Data', color: 'var(--muted)',  bg: 'var(--card)' },
};

// ─── Stat card ────────────────────────────────────────────────────────────────

const Stat: React.FC<{
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}> = ({ label, value, sub, color, icon }) => (
  <div style={{
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 18px',
    display: 'flex', flexDirection: 'column', gap: 4,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      {icon && <span style={{ color: 'var(--muted)', opacity: 0.8 }}>{icon}</span>}
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
    </div>
    <div style={{ fontSize: 22, fontWeight: 800, color: color ?? 'var(--text)', letterSpacing: '-0.02em' }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
  </div>
);

// ─── Hit rate bar ─────────────────────────────────────────────────────────────

const HitBar: React.FC<{ t2: number; t1: number; stop: number; time: number }> = ({ t2, t1, stop, time }) => {
  const total = t2 + t1 + stop + time;
  if (total === 0) return null;
  const segments = [
    { pct: t2, color: 'var(--buy)', label: `T2 ${t2.toFixed(0)}%` },
    { pct: t1, color: '#22d3ee', label: `T1 ${t1.toFixed(0)}%` },
    { pct: stop, color: 'var(--sell)', label: `Stop ${stop.toFixed(0)}%` },
    { pct: time, color: 'var(--muted)', label: `Time ${time.toFixed(0)}%` },
  ];
  return (
    <div>
      <div style={{ height: 10, borderRadius: 5, overflow: 'hidden', display: 'flex', background: 'var(--card-hi)' }}>
        {segments.map((s, i) => (
          <div key={i} title={s.label} style={{ width: `${s.pct}%`, background: s.color, transition: 'width 0.3s' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        {segments.map((s, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--sub)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── Trade row ────────────────────────────────────────────────────────────────

const TradeRow: React.FC<{ t: TradeResult; i: number }> = ({ t, i }) => {
  const meta = EXIT_META[t.exit_reason] ?? EXIT_META.NO_DATA;
  return (
    <tr style={{ background: i % 2 === 0 ? 'transparent' : 'var(--card-hi)' }}>
      <td style={{ padding: '7px 12px', fontWeight: 700, color: 'var(--text)', fontSize: 12, fontFamily: 'monospace' }}>{t.ticker}</td>
      <td style={{ padding: '7px 12px' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          background: t.signal === 'STRONG_BUY' ? 'var(--buy-dim)' : 'rgba(250,204,21,0.12)',
          color: t.signal === 'STRONG_BUY' ? 'var(--buy)' : '#facc15',
        }}>{t.signal.replace('_', ' ')}</span>
      </td>
      <td style={{ padding: '7px 12px', color: 'var(--sub)', fontSize: 11 }}>{t.week_end}</td>
      <td style={{ padding: '7px 12px', color: 'var(--sub)', fontSize: 12 }}>{t.entry_price > 0 ? rp(t.entry_price) : '—'}</td>
      <td style={{ padding: '7px 12px', color: 'var(--sell)', fontSize: 12 }}>{rp(t.stop_loss)}</td>
      <td style={{ padding: '7px 12px', fontSize: 12 }}>
        <span style={{ color: '#22d3ee' }}>{rp(t.target_1)}</span>
        <span style={{ color: 'var(--muted)', margin: '0 4px' }}>/</span>
        <span style={{ color: 'var(--buy)' }}>{rp(t.target_2)}</span>
      </td>
      <td style={{ padding: '7px 12px' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          background: meta.bg, color: meta.color,
        }}>{meta.label}</span>
      </td>
      <td style={{
        padding: '7px 12px',
        fontWeight: 700, fontSize: 13,
        color: pctColor(t.pnl_pct),
      }}>
        {t.exit_reason === 'NO_DATA' ? '—' : pct(t.pnl_pct)}
      </td>
      <td style={{ padding: '7px 12px', color: 'var(--muted)', fontSize: 11 }}>{t.confidence}%</td>
    </tr>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

type SortKey = 'ticker' | 'week_end' | 'pnl_pct' | 'confidence';

const Backtest: React.FC = () => {
  const [ticker, setTicker]     = useState('');
  const [fromDate, setFromDate] = useState('2026-01-01');
  const [minConf, setMinConf]   = useState(60);
  const [result, setResult]     = useState<BacktestResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [sortKey, setSortKey]   = useState<SortKey>('week_end');
  const [sortAsc, setSortAsc]   = useState(false);

  const run = async () => {
    setLoading(true); setError('');
    try {
      const r = await backtestApi.run({
        ticker: ticker.trim().toUpperCase() || undefined,
        from_date: fromDate || undefined,
        min_confidence: minConf,
      });
      setResult(r);
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message ?? 'Error running backtest');
    }
    setLoading(false);
  };

  const sorted = useMemo(() => {
    if (!result) return [];
    return [...result.trades].sort((a, b) => {
      let av: any = a[sortKey], bv: any = b[sortKey];
      if (typeof av === 'string') av = av.toLowerCase(), bv = bv.toLowerCase();
      return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [result, sortKey, sortAsc]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc(v => !v);
    else { setSortKey(k); setSortAsc(false); }
  };

  const SortBtn: React.FC<{ k: SortKey; label: string }> = ({ k, label }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{
        padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: sortKey === k ? 'var(--floor)' : 'var(--muted)',
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {label} {sortKey === k ? (sortAsc ? <ChevronUp size={10} style={{ display: 'inline' }} /> : <ChevronDown size={10} style={{ display: 'inline' }} />) : null}
    </th>
  );

  return (
    <Layout subtitle="Three Doors Backtest">
      <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
            Three Doors Backtest
          </h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
            Replay STRONG_BUY / BUY signals against historical OHLCV data.
            Entry at open after signal week · Stop at floor −5% · T1 +12% · T2 +25% · Time-stop 35d
          </p>
        </div>

        {/* Controls */}
        <div style={{
          display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end',
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '16px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ticker (blank = all)</label>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              placeholder="e.g. BUMI"
              style={{
                height: 34, padding: '0 12px', borderRadius: 8,
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 13, width: 140,
                outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--floor)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>From date</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              style={{
                height: 34, padding: '0 12px', borderRadius: 8,
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 13, width: 160,
                outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--floor)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Min confidence</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range" min={0} max={100} step={5}
                value={minConf}
                onChange={e => setMinConf(Number(e.target.value))}
                style={{ width: 110 }}
              />
              <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 700, minWidth: 36, fontFamily: 'monospace' }}>{minConf}%</span>
            </div>
          </div>

          <button
            onClick={run}
            disabled={loading}
            style={{
              height: 34, padding: '0 20px', borderRadius: 8,
              background: loading ? 'var(--card-hi)' : 'var(--floor)',
              border: 'none', cursor: loading ? 'default' : 'pointer',
              color: 'white', fontWeight: 700, fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'opacity 0.15s', opacity: loading ? 0.6 : 1,
            }}
          >
            <Play size={13} />
            {loading ? 'Running…' : 'Run Backtest'}
          </button>
        </div>

        {error && (
          <div style={{ background: 'var(--sell-dim)', border: '1px solid var(--sell)', color: 'var(--sell)', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13 }}>
            {error}
          </div>
        )}

        {result && (
          <>
            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
              <Stat
                label="Win Rate"
                value={`${result.win_rate.toFixed(1)}%`}
                sub={`${result.winning_trades}W / ${result.losing_trades}L of ${result.total_trades} trades`}
                color={result.win_rate >= 60 ? 'var(--buy)' : result.win_rate >= 40 ? 'var(--watch)' : 'var(--sell)'}
                icon={<TrendingUp size={13} />}
              />
              <Stat
                label="Avg Return"
                value={pct(result.avg_return_pct)}
                sub={`Gain ${pct(result.avg_gain_pct)} · Loss ${pct(result.avg_loss_pct)}`}
                color={pctColor(result.avg_return_pct)}
                icon={<Target size={13} />}
              />
              <Stat
                label="Best / Worst"
                value={pct(result.best_trade_pct)}
                sub={`Worst: ${pct(result.worst_trade_pct)}`}
                color="var(--buy)"
                icon={<TrendingUp size={13} />}
              />
              <Stat
                label="T2 Hit Rate"
                value={`${result.t2_hit_rate.toFixed(1)}%`}
                sub={`T1 hit: ${result.t1_hit_rate.toFixed(1)}%`}
                color="var(--buy)"
                icon={<Target size={13} />}
              />
              <Stat
                label="Stop Hit Rate"
                value={`${result.stop_hit_rate.toFixed(1)}%`}
                sub={`Time-stop: ${result.time_stop_rate.toFixed(1)}%`}
                color={result.stop_hit_rate > 40 ? 'var(--sell)' : 'var(--muted)'}
                icon={<AlertTriangle size={13} />}
              />
            </div>

            {/* Exit distribution */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Exit Distribution</div>
              <HitBar t2={result.t2_hit_rate} t1={result.t1_hit_rate - result.t2_hit_rate} stop={result.stop_hit_rate} time={result.time_stop_rate} />
            </div>

            {result.total_trades === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)', fontSize: 13 }}>
                No trades found for these parameters.
                {' '}Make sure price history has been backfilled (Admin → Price History Backfill).
              </div>
            )}

            {/* Trade table */}
            {sorted.length > 0 && (
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Trade Log</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sorted.length} trades</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <SortBtn k="ticker" label="Ticker" />
                        <th style={{ padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>Signal</th>
                        <SortBtn k="week_end" label="Week End" />
                        <th style={{ padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>Entry</th>
                        <th style={{ padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>Stop</th>
                        <th style={{ padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>T1 / T2</th>
                        <th style={{ padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>Exit</th>
                        <SortBtn k="pnl_pct" label="P&L" />
                        <SortBtn k="confidence" label="Conf" />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((t, i) => <TradeRow key={`${t.ticker}-${t.week_end}-${i}`} t={t} i={i} />)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {!result && !loading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>Set parameters and run backtest</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 380, margin: '0 auto' }}>
              Requires price history data. Run "Price History Backfill" in Admin first if charts are empty.
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Backtest;
