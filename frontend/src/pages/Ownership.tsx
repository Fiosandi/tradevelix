import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ownershipApi } from '../api';
import type { OwnershipResponse } from '../types';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area,
} from 'recharts';
import { Globe2, Building2, User, Briefcase, Crown } from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────

const ENTITY_PALETTE: Record<string, string> = {
  Lokal_Corporate:  '#2563eb',
  Lokal_Individual: '#60a5fa',
  Lokal_MutualFund: '#7c3aed',
  Lokal_Insurance:  '#0891b2',
  Lokal_Bank:       '#0284c7',
  Lokal_Pension:    '#4f46e5',
  Lokal_Foundation: '#6366f1',
  Lokal_Other:      '#94a3b8',
  Asing_Corporate:  '#dc2626',
  Asing_Individual: '#fb923c',
  Asing_MutualFund: '#f97316',
  Asing_Insurance:  '#e11d48',
  Asing_Bank:       '#ea580c',
  Asing_Pension:    '#c2410c',
  Asing_Foundation: '#9f1239',
  Asing_Other:      '#a8a29e',
};

const fmtMonth = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};

const fmtNum = (n: number | null | undefined): string => {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString('id-ID');
};

const fmtPct = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(2)}%`;

// ─── Page ────────────────────────────────────────────────────────────────────

const WATCHLIST = ['BUVA','BIPI','VKTR','BUMI','BRMS','ENRG','SUPA','COCO','PTRO','CUAN','IMPC','INDY','MBSS','PSKT','PANI','CBDK','ITMG','INKP','TKIM','BNBR','WIFI','INET','ESSA','BULL'];

const Ownership: React.FC = () => {
  const { ticker: urlTicker } = useParams<{ ticker?: string }>();
  const navigate = useNavigate();
  const [ticker, setTicker] = useState<string>((urlTicker || 'BUVA').toUpperCase());
  const [data, setData] = useState<OwnershipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    ownershipApi.get(ticker, 12)
      .then(setData)
      .catch(e => setErr(e.response?.status === 401 ? 'Sign in required' : 'Failed to load ownership data'))
      .finally(() => setLoading(false));
  }, [ticker]);

  // Pivot monthly data into recharts shape: each row = one month, each entity_segment = one column
  const monthlyChart = useMemo(() => {
    if (!data?.monthly) return [];
    return data.monthly.map(m => {
      const row: Record<string, any> = { month: fmtMonth(m.month) };
      Object.entries(m.by_segment).forEach(([k, v]) => {
        row[k] = v.pct;
      });
      return row;
    });
  }, [data]);

  // All segment keys present across all months (so colours are consistent)
  const segmentKeys = useMemo(() => {
    if (!data?.monthly) return [];
    const s = new Set<string>();
    data.monthly.forEach(m => Object.keys(m.by_segment).forEach(k => s.add(k)));
    // Order: Lokal first then Asing, preserving palette order
    const ordered = Object.keys(ENTITY_PALETTE).filter(k => s.has(k));
    Array.from(s).filter(k => !ordered.includes(k)).forEach(k => ordered.push(k));
    return ordered;
  }, [data]);

  return (
    <Layout subtitle="OWNERSHIP" ticker={ticker}>
      <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>

        {/* Ticker selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>
            Ownership Composition
          </h1>
          <select
            value={ticker}
            onChange={e => { setTicker(e.target.value); navigate(`/ownership/${e.target.value}`); }}
            style={{
              height: 36, padding: '0 12px', borderRadius: 8,
              background: 'var(--card)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 13, fontFamily: 'monospace', fontWeight: 700,
              outline: 'none', cursor: 'pointer',
            }}
          >
            {WATCHLIST.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            {data?.name && `· ${data.name}`}
          </span>
        </div>

        {loading && <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div>}
        {err && <div style={{ color: 'var(--sell)', padding: 40, textAlign: 'center' }}>{err}</div>}

        {!loading && !err && data && !data.has_data && (
          <EmptyState ticker={ticker} />
        )}

        {!loading && !err && data?.has_data && (
          <>
            <SummaryStrip data={data} />
            <Card title="Monthly Composition (last 12 months)" subtitle="Stacked by holder type — % of total shares">
              {monthlyChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={monthlyChart} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: 'var(--sub)', fontSize: 11 }} stroke="var(--border)" />
                    <YAxis tick={{ fill: 'var(--sub)', fontSize: 11 }} stroke="var(--border)" tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <Tooltip content={<MonthlyTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {segmentKeys.map(k => (
                      <Bar key={k} dataKey={k} stackId="a" fill={ENTITY_PALETTE[k] || '#94a3b8'} name={k.replace('_', ' · ')} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : <div style={{ color: 'var(--muted)', padding: 20 }}>No monthly data</div>}
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card title="Local Holders" subtitle={`${data.breakdown.local.length} entity types`}>
                <BreakdownTable rows={data.breakdown.local} totalShares={data.summary?.total_shares || 1} accent="var(--buy)" />
              </Card>
              <Card title="Foreign Holders" subtitle={`${data.breakdown.foreign.length} entity types`}>
                <BreakdownTable rows={data.breakdown.foreign} totalShares={data.summary?.total_shares || 1} accent="var(--sell)" />
              </Card>
            </div>

            {data.sid_trend.length > 0 && (
              <Card title="Single Investor ID (SID) Trend" subtitle="Number of unique shareholders — proxy for retail interest">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.sid_trend.map(s => ({ ...s, month: fmtMonth(s.month) }))} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: 'var(--sub)', fontSize: 11 }} stroke="var(--border)" />
                    <YAxis tick={{ fill: 'var(--sub)', fontSize: 11 }} stroke="var(--border)" tickFormatter={v => fmtNum(v)} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                      formatter={(v: any) => [fmtNum(typeof v === 'number' ? v : Number(v)), 'SID Count']}
                    />
                    <Area type="monotone" dataKey="sid_count" stroke="var(--whale)" fill="var(--whale)" fillOpacity={0.18} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            )}

            <Card title="Major Shareholders" subtitle="Holders with ≥1% (controlling tagged with 👑)">
              <MajorTable majors={data.majors} />
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const Card: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <section style={{
    background: 'var(--card)', border: '1px solid var(--border)',
    borderRadius: 12, padding: 18, marginBottom: 16,
  }}>
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</h2>
      {subtitle && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--muted)' }}>{subtitle}</p>}
    </div>
    {children}
  </section>
);

const SummaryStrip: React.FC<{ data: OwnershipResponse }> = ({ data }) => {
  const s = data.summary;
  if (!s) return null;
  const items = [
    { icon: <Globe2 size={16} />,    label: 'Foreign',   value: fmtPct(s.foreign_pct), color: 'var(--sell)' },
    { icon: <Building2 size={16} />, label: 'Local',     value: fmtPct(s.local_pct),   color: 'var(--buy)' },
    { icon: <User size={16} />,      label: 'Retail',    value: fmtPct(s.retail_pct),  color: 'var(--watch)' },
    { icon: <Briefcase size={16} />, label: 'Holders',   value: s.holder_count.toLocaleString(), color: 'var(--whale)' },
    { icon: <Crown size={16} />,     label: 'Total Shares', value: fmtNum(s.total_shares), color: 'var(--floor)' },
  ];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16,
    }}>
      {items.map(it => (
        <div key={it.label} style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            <span style={{ color: it.color }}>{it.icon}</span> {it.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', marginTop: 4 }}>
            {it.value}
          </div>
        </div>
      ))}
      <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
        Snapshot month: <span style={{ fontFamily: 'monospace', color: 'var(--sub)' }}>{fmtMonth(s.month)}</span>
      </div>
    </div>
  );
};

const BreakdownTable: React.FC<{ rows: { entity_type: string; shares: number; holders: number; pct: number }[]; totalShares: number; accent: string }> = ({ rows, accent }) => {
  if (rows.length === 0) return <div style={{ color: 'var(--muted)', padding: 12 }}>No data</div>;
  const max = Math.max(...rows.map(r => r.pct));
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={{ textAlign: 'left', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Entity</th>
          <th style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Shares</th>
          <th style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Holders</th>
          <th style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.entity_type} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '8px 4px', color: 'var(--text)' }}>{r.entity_type}</td>
            <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>{fmtNum(r.shares)}</td>
            <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>{r.holders}</td>
            <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)', fontWeight: 600 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                <div style={{ width: 60, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(r.pct / max * 100).toFixed(0)}%`, height: '100%', background: accent }} />
                </div>
                <span style={{ minWidth: 48 }}>{fmtPct(r.pct)}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const MajorTable: React.FC<{ majors: any[] }> = ({ majors }) => {
  if (majors.length === 0) return <div style={{ color: 'var(--muted)', padding: 12 }}>No major shareholders found.</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={{ textAlign: 'left', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Holder</th>
          <th style={{ textAlign: 'left', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Type</th>
          <th style={{ textAlign: 'left', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Status</th>
          <th style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Shares</th>
          <th style={{ textAlign: 'right', padding: '6px 4px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>%</th>
        </tr>
      </thead>
      <tbody>
        {majors.map((m, i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '8px 4px', color: 'var(--text)', fontWeight: 500 }}>
              {m.is_controlling && <span style={{ marginRight: 4 }}>👑</span>}
              {m.name}
            </td>
            <td style={{ padding: '8px 4px', color: 'var(--sub)' }}>{m.entity_type || '—'}</td>
            <td style={{ padding: '8px 4px' }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: m.status === 'Asing' ? 'var(--sell-dim)' : 'var(--buy-dim)',
                color: m.status === 'Asing' ? 'var(--sell)' : 'var(--buy)',
              }}>{m.status}</span>
            </td>
            <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>{fmtNum(m.shares)}</td>
            <td style={{ padding: '8px 4px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)', fontWeight: 700 }}>{m.pct != null ? `${m.pct.toFixed(2)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const MonthlyTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontSize: 11, minWidth: 180 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{label}</div>
      {sorted.slice(0, 8).map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--sub)' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: p.fill, marginRight: 6, borderRadius: 2 }} />{p.dataKey.replace('_', ' · ')}</span>
          <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{p.value.toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
};

const EmptyState: React.FC<{ ticker: string }> = ({ ticker }) => (
  <div style={{
    background: 'var(--card)', border: '1px dashed var(--border)',
    borderRadius: 12, padding: '60px 24px', textAlign: 'center',
  }}>
    <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>No KSEI ownership data for {ticker}</h3>
    <p style={{ margin: '8px 0 16px', fontSize: 12, color: 'var(--muted)', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
      Upload the latest monthly KSEI PDF from the Admin panel — the parser will extract every ≥1% holder, classify by entity type (Corporate / Individual / MutualFund / Insurance / Bank / Pension), and populate this view.
    </p>
    <a href="/admin" style={{
      display: 'inline-block', padding: '8px 16px', borderRadius: 8,
      background: 'var(--floor)', color: 'white', fontSize: 12, fontWeight: 700,
      textDecoration: 'none',
    }}>Go to Admin</a>
  </div>
);

export default Ownership;
