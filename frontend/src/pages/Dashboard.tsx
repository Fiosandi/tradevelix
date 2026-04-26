import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { dashboardApi } from '../api';
import type { LeaderboardEntry, DashboardSummary, TopWhaleBroker } from '../types';
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';
import { Layout } from '../components/Layout';

// ─── Design tokens ────────────────────────────────────────────────────────────

type Signal = LeaderboardEntry['overall_signal'];
type Filter  = 'all' | 'buy' | 'watch' | 'sell' | 'whale';
type SortKey = 'signal' | 'whale' | 'retail' | 'floor';

interface Sig { label: string; color: string; bg: string; pill: string }

const SIGS: Record<Signal, Sig> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'var(--buy)',   bg: 'var(--buy-dim)',   pill: 'var(--buy-dim)'   },
  BUY:         { label: 'BUY',          color: 'var(--buy)',   bg: 'var(--buy-dim)',   pill: 'var(--buy-dim)'   },
  WATCH:       { label: 'WATCH',        color: 'var(--watch)', bg: 'var(--watch-dim)', pill: 'var(--watch-dim)' },
  WAIT:        { label: 'WAIT',         color: 'var(--sub)',   bg: 'transparent',      pill: 'var(--wait-dim)'  },
  SELL:        { label: 'SELL',         color: 'var(--sell)',  bg: 'var(--sell-dim)',  pill: 'var(--sell-dim)'  },
  STRONG_SELL: { label: 'STRONG SELL',  color: 'var(--sell)',  bg: 'var(--sell-dim)',  pill: 'var(--sell-dim)'  },
};
const SIG_ORDER: Record<Signal, number> = { STRONG_BUY: 0, BUY: 1, WATCH: 2, WAIT: 3, SELL: 4, STRONG_SELL: 5 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | string | null | undefined): string => {
  if (n == null || n === '') return '—';
  const v = +n; if (isNaN(v)) return '—';
  if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(2)+'M';
  if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1)+'K';
  return v.toLocaleString();
};
const fmtP = (n: number | string | null | undefined): string => {
  if (n == null) return '—'; const v = +n; if (isNaN(v)) return '—';
  return v.toLocaleString('id-ID');
};

// ─── Broker chip ─────────────────────────────────────────────────────────────

const Chip: React.FC<{ b: TopWhaleBroker }> = ({ b }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
    fontFamily: 'monospace', border: '1px solid',
    color:       b.side === 'BUY' ? 'var(--buy)' : 'var(--sell)',
    borderColor: b.side === 'BUY' ? 'var(--buy)'  : 'var(--sell)',
    background:  b.side === 'BUY' ? 'var(--buy-dim)' : 'var(--sell-dim)',
    opacity: 0.9,
  }}>
    {b.side === 'BUY' ? <TrendingUp size={8}/> : <TrendingDown size={8}/>}
    {b.code}
  </span>
);

// ─── Table row ────────────────────────────────────────────────────────────────

const Row: React.FC<{ e: LeaderboardEntry; onClick: () => void }> = ({ e, onClick }) => {
  const s      = SIGS[e.overall_signal] ?? SIGS.WAIT;
  const pos    = e.whale_net_lots > 0;
  const retail = Math.min(Math.max(Number(e.retail_exit_percent)||0, 0), 100);
  const floor  = Number(e.distance_to_floor_pct)||0;
  const price  = Number(e.current_price || e.close)||0;

  return (
    <tr
      onClick={onClick}
      style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-hi)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td style={{ width: 4, padding: 0 }}>
        <div style={{ width: 4, height: '100%', minHeight: 52, background: s.color, borderRadius: '2px 0 0 2px' }} />
      </td>
      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{e.ticker}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
      </td>
      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
        <span style={{ padding: '3px 9px', borderRadius: 100, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: s.color, background: s.pill }}>
          ● {s.label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{e.confidence_score}%</span>
          {e.pump_score != null && e.pump_score > 6 && (
            <span title={`Pump risk score: ${e.pump_score.toFixed(1)}`} style={{ fontSize: 9, fontWeight: 700, color: '#ff3b5c', background: 'rgba(255,59,92,.12)', border: '1px solid rgba(255,59,92,.3)', borderRadius: 4, padding: '0px 4px', lineHeight: '14px' }}>
              ⚠ PUMP
            </span>
          )}
        </div>
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>
        {price > 0 ? fmtP(price) : '—'}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: pos ? 'var(--buy)' : 'var(--sell)' }}>
          {pos ? '+' : ''}{fmt(e.whale_net_lots)}
        </span>
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>lots</div>
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: retail >= 50 ? 'var(--buy)' : 'var(--sub)' }}>
          {retail.toFixed(1)}%
        </span>
        <div style={{ marginTop: 4, height: 3, width: 60, marginLeft: 'auto', background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${retail}%`, background: retail >= 50 ? 'var(--buy)' : 'var(--sub)', borderRadius: 4, transition: 'width 0.4s' }} />
        </div>
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: floor <= 5 ? 'var(--watch)' : 'var(--sub)' }}>
          {floor >= 0 ? '+' : ''}{floor.toFixed(1)}%
        </span>
      </td>
      <td style={{ padding: '10px 16px' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(e.top_whale_brokers ?? []).slice(0, 3).map(b => <Chip key={b.code} b={b} />)}
        </div>
      </td>
      <td style={{ padding: '10px 16px', color: 'var(--muted)' }}>
        <ArrowUpRight size={14} />
      </td>
    </tr>
  );
};

// ─── Stat card ────────────────────────────────────────────────────────────────

const Stat: React.FC<{ label: string; value: number; color: string; icon: React.ReactNode }> = ({ label, value, color, icon }) => (
  <div style={{
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }}>
    <div>
      <div style={{ fontSize: 11, color: 'var(--sub)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: 'monospace', lineHeight: 1 }}>{value}</div>
    </div>
    <div style={{ color, opacity: 0.7, fontSize: 22 }}>{icon}</div>
  </div>
);

// ─── Dashboard ────────────────────────────────────────────────────────────────

// ─── API Budget Monitor ───────────────────────────────────────────────────────

// DashboardSummary already imported above via types line 4

const ApiBudget: React.FC<{ apiUsage?: DashboardSummary['api_usage'] }> = ({ apiUsage }) => {
  if (!apiUsage) return null;

  // Use DB-sourced total (accurate even after server restart)
  const totalUsed  = apiUsage.monthly_calls_used ?? apiUsage.client_stats?.monthly_calls ?? 0;
  const totalLimit = apiUsage.monthly_limit ?? (apiUsage.client_stats?.monthly_limit ?? 2700);
  const totalPct   = Math.min((totalUsed / (totalLimit || 2700)) * 100, 100);
  const remaining  = apiUsage.monthly_remaining ?? (totalLimit - totalUsed);
  const budgetColor = totalPct > 80 ? 'var(--sell)' : totalPct > 60 ? 'var(--watch)' : 'var(--buy)';

  const keys = apiUsage.client_stats?.per_key ?? [];
  const keysHaveData = keys.some(k => k.calls_used > 0);
  const usage = apiUsage.client_stats;

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 18px', marginBottom: 20,
      display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>
        API Budget
      </div>

      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--sub)' }}>
            {totalUsed.toLocaleString()} / {totalLimit.toLocaleString()} calls · {keys.length || 3} keys
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: budgetColor }}>
            {remaining.toLocaleString()} remaining
          </span>
        </div>
        <div className="pbar-track">
          <div className="pbar-fill" style={{ width: `${totalPct}%`, background: budgetColor }} />
        </div>
      </div>

      {/* Per-key pills — only show if in-memory has data; otherwise show note */}
      {keysHaveData ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {keys.map(k => {
            const pct = Math.min((k.calls_used / k.calls_limit) * 100, 100);
            const col = pct > 80 ? 'var(--sell)' : pct > 50 ? 'var(--watch)' : 'var(--buy)';
            return (
              <div key={k.key_index} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8,
                background: k.active ? 'var(--buy-dim)' : 'var(--surface)',
                border: `1px solid ${k.active ? 'var(--buy)' : 'var(--border)'}`,
              }}>
                {k.active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--buy)', display: 'inline-block' }} />}
                <span style={{ fontSize: 10, color: k.active ? 'var(--buy)' : 'var(--sub)', fontWeight: 700 }}>Key #{k.key_index}</span>
                <span style={{ fontSize: 10, color: col, fontFamily: 'monospace', fontWeight: 700 }}>{k.calls_used}/{k.calls_limit}</span>
                <div style={{ width: 40, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 2 }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <span style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>
          Per-key breakdown resets on server restart · see Admin page for history
        </span>
      )}

      {usage && (
        <div style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          Today: <span style={{ color: 'var(--sub)', fontFamily: 'monospace' }}>{usage.daily_calls}/{usage.daily_limit}</span>
        </div>
      )}
    </div>
  );
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [entries,    setEntries]    = useState<LeaderboardEntry[]>([]);
  const [weekRange,  setWeekRange]  = useState<{start: string; end: string} | null>(null);
  const [summary,    setSummary]    = useState<DashboardSummary | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sort,       setSort]       = useState<SortKey>('signal');

  // Filter driven by ?filter= URL param so sidebar links work
  const filter = (searchParams.get('filter') as Filter) ?? 'all';
  const setFilter = (f: Filter) => {
    if (f === 'all') setSearchParams({});
    else setSearchParams({ filter: f });
  };

  const load = async (soft = false) => {
    try {
      soft ? setRefreshing(true) : setLoading(true);
      setError(null);
      const [lb, s] = await Promise.all([dashboardApi.getLeaderboard(), dashboardApi.getSummary()]);
      setEntries(lb.entries);
      if (lb.week_start && lb.week_end) setWeekRange({ start: lb.week_start, end: lb.week_end });
      setSummary(s);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        setError('Session expired. Please log out and log in again.');
      } else if (status >= 500) {
        setError('Server error. Try refreshing in a moment.');
      } else {
        setError('Cannot reach backend. Check your connection.');
      }
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    buy:   entries.filter(e => ['BUY','STRONG_BUY'].includes(e.overall_signal)).length,
    watch: entries.filter(e => e.overall_signal === 'WATCH').length,
    sell:  entries.filter(e => ['SELL','STRONG_SELL'].includes(e.overall_signal)).length,
    whale: entries.filter(e => e.whale_net_lots > 0).length,
  }), [entries]);

  const rows = useMemo(() => {
    let r = [...entries];
    if (filter === 'buy')   r = r.filter(e => ['BUY','STRONG_BUY'].includes(e.overall_signal));
    if (filter === 'watch') r = r.filter(e => e.overall_signal === 'WATCH');
    if (filter === 'sell')  r = r.filter(e => ['SELL','STRONG_SELL'].includes(e.overall_signal));
    if (filter === 'whale') { r = r.filter(e => e.whale_net_lots > 0); r.sort((a,b) => b.whale_net_lots - a.whale_net_lots); }
    if (sort === 'signal')  r.sort((a,b) => (SIG_ORDER[a.overall_signal]-SIG_ORDER[b.overall_signal])||b.confidence_score-a.confidence_score);
    if (sort === 'whale')   r.sort((a,b) => b.whale_net_lots - a.whale_net_lots);
    if (sort === 'retail')  r.sort((a,b) => Number(b.retail_exit_percent)-Number(a.retail_exit_percent));
    if (sort === 'floor')   r.sort((a,b) => Number(a.distance_to_floor_pct)-Number(b.distance_to_floor_pct));
    return r;
  }, [entries, filter, sort]);

  const weekLabel = weekRange ? `${weekRange.start} – ${weekRange.end}` : '';

  if (loading) return (
    <Layout title="Dashboard">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12, flexDirection: 'column' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #1e293b', borderTopColor: '#3b82f6' }} className="spin" />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>Loading...</span>
      </div>
    </Layout>
  );

  if (error) return (
    <Layout title="Dashboard">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: '#fb7185', fontSize: 14 }}>{error}</div>
        <button onClick={() => load()} style={{ padding: '8px 20px', background: 'var(--card)', border: '1px solid #334155', color: 'var(--sub)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
          Retry
        </button>
      </div>
    </Layout>
  );

  return (
    <Layout title="Dashboard" subtitle={weekLabel}>
      <div style={{ padding: '24px 28px' }}>

        {/* ── Stats ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
          <Stat label="BUY Signals"    value={counts.buy}   color="#34d399" icon={<TrendingUp size={20}/>} />
          <Stat label="WATCH Signals"  value={counts.watch} color="#fb923c" icon="👁" />
          <Stat label="SELL / Exit"    value={counts.sell}  color="#fb7185" icon={<TrendingDown size={20}/>} />
          <Stat label="Whale Accum."   value={counts.whale} color="#a78bfa" icon="🐋" />
        </div>

        {/* ── API Budget Monitor ─────────────────────────────────── */}
        <ApiBudget apiUsage={summary?.api_usage} />

        {/* ── Filter + sort ───────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {([
              { id: 'all',   label: `All (${entries.length})`,  c: 'var(--sub)', p: 'var(--card)' },
              { id: 'buy',   label: `BUY (${counts.buy})`,     c: '#34d399', p: 'rgba(52,211,153,.1)' },
              { id: 'watch', label: `WATCH (${counts.watch})`, c: '#fb923c', p: 'rgba(251,146,60,.1)' },
              { id: 'sell',  label: `SELL (${counts.sell})`,   c: '#fb7185', p: 'rgba(251,113,133,.1)' },
              { id: 'whale', label: `🐋 Whale (${counts.whale})`, c: 'var(--whale)', p: 'rgba(167,139,250,.1)' },
            ] as {id: Filter; label: string; c: string; p: string}[]).map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${filter === f.id ? f.c+'40' : 'var(--card)'}`,
                background: filter === f.id ? f.p : 'transparent',
                color: filter === f.id ? f.c : 'var(--muted)',
                transition: 'all 0.12s',
              }}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--border-hi)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 4 }}>SORT</span>
            {([
              { id: 'signal', label: 'Signal' },
              { id: 'whale',  label: 'Whale' },
              { id: 'retail', label: 'Retail' },
              { id: 'floor',  label: 'Floor' },
            ] as {id: SortKey; label: string}[]).map(s => (
              <button key={s.id} onClick={() => setSort(s.id)} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${sort === s.id ? 'rgba(139,92,246,.4)' : 'transparent'}`,
                background: sort === s.id ? 'rgba(139,92,246,.12)' : 'transparent',
                color: sort === s.id ? 'var(--whale)' : 'var(--muted)',
                transition: 'all 0.12s',
              }}>{s.label}</button>
            ))}
            <button
              onClick={() => load(true)}
              style={{ marginLeft: 8, width: 30, height: 30, borderRadius: 7, background: 'var(--card)', border: '1px solid #334155', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* ── Table ──────────────────────────────────────────────── */}
        <div style={{ background: 'var(--card)', border: '1px solid #334155', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid #334155' }}>
                <th style={{ width: 4 }} />
                {['Stock', 'Signal', 'Price (Rp)', 'Whale Net', 'Retail Exit', 'Vs Floor', 'Brokers', ''].map((h, i) => (
                  <th key={i} style={{
                    padding: '10px 12px', fontSize: 10, fontWeight: 700,
                    color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.08em',
                    textAlign: i >= 3 && i <= 5 ? 'right' : 'left',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: 'var(--border-hi)', fontSize: 13 }}>No stocks match</td></tr>
              ) : (
                rows.map(e => <Row key={e.ticker} e={e} onClick={() => navigate(`/stock/${e.ticker}`)} />)
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--card)' }}>
          <span>Three Doors Analysis: Who · What · Coordination</span>
          <span>{entries.length} stocks · Market Reaper API</span>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
