import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell, Customized, ReferenceLine,
} from 'recharts';
import { Layout } from '../components/Layout';
import { dashboardApi } from '../api';
import type { BrokerFlowData, BrokerFlowPoint } from '../types';
import { Play, AlertCircle } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const PALETTE = [
  '#22d3ee', '#10d98b', '#f59e0b', '#a78bfa', '#f97316',
  '#ec4899', '#84cc16', '#fb923c', '#38bdf8', '#a3e635',
  '#e879f9', '#34d399',
];

const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = (iso: string) => {
  if (!iso) return '';
  const p = iso.split('-');
  return `${p[2]} ${MONTHS[+p[1]]}`;
};

const fmtLots = (v: number) => {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};

const rp = (v: number) => Math.round(v).toLocaleString('id-ID');

// ─── Candlestick layer (Recharts Customized) ──────────────────────────────────

const CandlestickLayer = React.memo((props: any) => {
  const data: BrokerFlowPoint[] = props.data ?? [];
  // xAxisMap keys are numeric (0, 1...), yAxisMap keys are the yAxisId strings
  const xAxis = props.xAxisMap?.[0] ?? Object.values(props.xAxisMap ?? {})[0] as any;
  const yAxisMap = props.yAxisMap ?? {};
  const priceAxis = yAxisMap['price'] ?? Object.values(yAxisMap).find((a: any) => a?.orientation === 'right') as any;
  if (!xAxis?.scale || !priceAxis?.scale) return null;

  const xScale = xAxis.scale;
  const yScale = priceAxis.scale;
  const bw = Math.max((xScale.bandwidth?.() ?? 8) * 0.75, 2.5);

  return (
    <g>
      {data.map((d) => {
        if (!d.open || !d.high || !d.low || !d.close) return null;
        const cx = (xScale(d.date) ?? 0) + (xScale.bandwidth?.() ?? 0) / 2;
        const yH = yScale(d.high);
        const yL = yScale(d.low);
        const yO = yScale(d.open);
        const yC = yScale(d.close);
        const up = d.close >= d.open;
        const col = up ? '#10d98b' : '#ff4466';
        const bodyTop = Math.min(yO, yC);
        const bodyH = Math.max(Math.abs(yC - yO), 1.5);
        return (
          <g key={d.date}>
            <line x1={cx} y1={yH} x2={cx} y2={yL} stroke={col} strokeWidth={1} opacity={0.7} />
            <rect
              x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH}
              fill={col} fillOpacity={0.85} rx={0.5}
            />
          </g>
        );
      })}
    </g>
  );
});

// ─── Tooltip ─────────────────────────────────────────────────────────────────

const FlowTip = ({ active, payload, label, visibleBrokers, brokerColor }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as BrokerFlowPoint;
  if (!d) return null;

  const brokerVals = payload
    .filter((p: any) => visibleBrokers.has(p.dataKey))
    .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 11, maxWidth: 240,
    }}>
      <div style={{ color: 'var(--sub)', fontWeight: 700, marginBottom: 8 }}>{fmtDate(label)}</div>
      {d.close != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 6, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
          <span style={{ color: 'var(--sub)' }}>OHLC</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text)' }}>
            {d.open && rp(d.open)} / <span style={{ color: '#10d98b' }}>{d.high && rp(d.high)}</span> / <span style={{ color: '#ff4466' }}>{d.low && rp(d.low)}</span> / {rp(d.close)}
          </span>
        </div>
      )}
      {brokerVals.map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: brokerColor(p.dataKey), fontWeight: 700, fontFamily: 'monospace' }}>{p.dataKey}</span>
          <span style={{ fontFamily: 'monospace', color: (p.value ?? 0) >= 0 ? 'var(--buy)' : 'var(--sell)' }}>
            {(p.value ?? 0) >= 0 ? '+' : ''}{fmtLots(p.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

const BrokerFlow: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [ticker, setTicker] = useState(searchParams.get('ticker') || 'BUMI');
  const [tickerInput, setTickerInput] = useState(ticker);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<BrokerFlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visibleBrokers, setVisibleBrokers] = useState<Set<string>>(new Set());
  const [hideTektok, setHideTektok] = useState(true);
  const [hideNetDist, setHideNetDist] = useState(false);

  const fetch = useCallback(async (t: string) => {
    setLoading(true); setError('');
    try {
      const r = await dashboardApi.getBrokerFlow(t.toUpperCase(), fromDate, toDate);
      setData(r);
      const initial = new Set(
        [...r.top_accumulators, ...r.top_distributors]
          .filter(b => !b.is_tektok)
          .map(b => b.broker)
      );
      setVisibleBrokers(initial);
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { fetch(ticker); }, [ticker, fromDate, toDate]);

  // Assign stable colors per broker
  const brokerColor = useCallback((broker: string) => {
    if (!data) return 'var(--sub)';
    const idx = data.brokers.indexOf(broker);
    return PALETTE[idx % PALETTE.length];
  }, [data]);

  // Filtered brokers to show based on toggles
  const activeBrokers = useMemo(() => {
    if (!data) return [];
    return [...visibleBrokers].filter(b => {
      if (hideTektok && data.tektok_brokers.includes(b)) return false;
      if (hideNetDist && data.top_distributors.some(d => d.broker === b)) return false;
      return true;
    });
  }, [visibleBrokers, hideTektok, hideNetDist, data]);

  const toggleBroker = (b: string) => {
    setVisibleBrokers(prev => {
      const n = new Set(prev);
      if (n.has(b)) n.delete(b); else n.add(b);
      return n;
    });
  };

  const submit = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t) setTicker(t);
  };

  return (
    <Layout subtitle="Broker Inventory">
      <div style={{ padding: '20px 24px' }}>

        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
            Broker Inventory Flow
          </h1>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>
            Cumulative net lot accumulation per broker overlaid on candlestick price action.
            Divergence between broker lines and price = smart money signal.
          </p>
        </div>

        {/* Controls */}
        <div style={{
          display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 18px', marginBottom: 18,
        }}>
          {/* Ticker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ticker</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder="BUMI"
                style={{
                  height: 32, padding: '0 10px', borderRadius: 7, width: 90,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text)', fontSize: 13, fontWeight: 700, fontFamily: 'monospace',
                  outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--floor)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
              <button onClick={submit} style={{
                height: 32, padding: '0 12px', borderRadius: 7, background: 'var(--floor)',
                border: 'none', cursor: 'pointer', color: 'white', fontWeight: 700, fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <Play size={11} /> Go
              </button>
            </div>
          </div>

          {/* Date range */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              style={{ height: 32, padding: '0 10px', borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, outline: 'none', width: 150 }}
              onFocus={e => e.target.style.borderColor = 'var(--floor)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              style={{ height: 32, padding: '0 10px', borderRadius: 7, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, outline: 'none', width: 150 }}
              onFocus={e => e.target.style.borderColor = 'var(--floor)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {/* Toggles */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 4 }}>
            {[
              { key: 'tektok', label: 'hide tektok', active: hideTektok, toggle: () => setHideTektok(v => !v) },
              { key: 'dist',   label: 'hide net dist', active: hideNetDist, toggle: () => setHideNetDist(v => !v) },
            ].map(t => (
              <button key={t.key} onClick={t.toggle} style={{
                height: 32, padding: '0 12px', borderRadius: 7, fontSize: 11, fontWeight: 700,
                background: t.active ? 'var(--floor-dim)' : 'var(--card-hi)',
                border: `1px solid ${t.active ? 'var(--floor)' : 'var(--border)'}`,
                color: t.active ? 'var(--floor)' : 'var(--muted)',
                cursor: 'pointer', transition: 'all 0.1s',
              }}>
                {t.label}
              </button>
            ))}
          </div>

          {data && (
            <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span>{data.weeks_of_data} week{data.weeks_of_data !== 1 ? 's' : ''} of broker data</span>
              {data.weeks_of_data < 4 && (
                <span style={{ color: 'var(--watch)', fontWeight: 600 }}>⚠ Run broker history backfill in Admin for more data</span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: 'var(--sell-dim)', border: '1px solid var(--sell)', color: 'var(--sell)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12, flexDirection: 'column' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--floor)' }} className="spin" />
            <span style={{ color: 'var(--sub)', fontSize: 12 }}>Loading {ticker}...</span>
          </div>
        )}

        {!loading && data && data.timeline.length > 0 && (
          <>
            {/* Legend */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-start' }}>
              {/* Net Akum */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Net Akumulasi
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {data.top_accumulators.map(b => {
                    const vis = visibleBrokers.has(b.broker);
                    const col = brokerColor(b.broker);
                    const tek = b.is_tektok;
                    return (
                      <button key={b.broker} onClick={() => toggleBroker(b.broker)}
                        title={`${b.broker}: +${fmtLots(b.cum_lots)} lots${tek ? ' (tektok)' : ''}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700,
                          border: `1.5px solid ${vis ? col : 'var(--border)'}`,
                          background: vis ? `${col}18` : 'var(--card)',
                          color: vis ? col : 'var(--muted)',
                          cursor: 'pointer', transition: 'all 0.1s',
                          opacity: tek && hideTektok ? 0.35 : 1,
                        }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0, opacity: vis ? 1 : 0.3 }} />
                        {b.broker}
                        <span style={{ fontSize: 9, opacity: 0.7 }}>+{fmtLots(b.cum_lots)}</span>
                        {tek && <span style={{ fontSize: 9, color: 'var(--watch)' }}>✕</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Net Dist */}
              {!hideNetDist && data.top_distributors.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Net Distribusi
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {data.top_distributors.map(b => {
                      const vis = visibleBrokers.has(b.broker);
                      const col = brokerColor(b.broker);
                      const tek = b.is_tektok;
                      return (
                        <button key={b.broker} onClick={() => toggleBroker(b.broker)}
                          title={`${b.broker}: -${fmtLots(b.cum_lots)} lots${tek ? ' (tektok)' : ''}`}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700,
                            border: `1.5px dashed ${vis ? col : 'var(--border)'}`,
                            background: vis ? `${col}18` : 'var(--card)',
                            color: vis ? col : 'var(--muted)',
                            cursor: 'pointer', transition: 'all 0.1s',
                            opacity: tek && hideTektok ? 0.35 : 1,
                          }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0, opacity: vis ? 1 : 0.3 }} />
                          {b.broker}
                          <span style={{ fontSize: 9, opacity: 0.7 }}>-{fmtLots(b.cum_lots)}</span>
                          {tek && <span style={{ fontSize: 9, color: 'var(--watch)' }}>✕</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Main chart: broker lines + candlestick */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 7px' }}>Inventory</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{data.ticker} · Cumulative Net Lots</span>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--sub)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 16, height: 2, background: 'var(--sub)', display: 'inline-block' }} /> Broker lots (left)</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 8, background: '#10d98b', display: 'inline-block', borderRadius: 1, opacity: 0.8 }} /> Price (right)</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={data.timeline} margin={{ top: 8, right: 72, left: 0, bottom: 0 }} syncId="flow">
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--sub)', fontSize: 9 }} tickLine={false} axisLine={false}
                    interval="preserveStartEnd" tickFormatter={fmtDate} />
                  <YAxis yAxisId="lots" domain={['auto', 'auto']} tick={{ fill: 'var(--sub)', fontSize: 9 }}
                    tickLine={false} axisLine={false} width={56} tickFormatter={fmtLots} />
                  <YAxis yAxisId="price" orientation="right" domain={['auto', 'auto']}
                    tick={{ fill: 'var(--sub)', fontSize: 9 }} tickLine={false} axisLine={false}
                    width={72} tickFormatter={v => `Rp ${rp(v)}`} />
                  <ReferenceLine yAxisId="lots" y={0} stroke="var(--border)" strokeWidth={1} />
                  <Tooltip
                    content={<FlowTip visibleBrokers={visibleBrokers} brokerColor={brokerColor} />}
                    cursor={{ stroke: 'var(--floor)', strokeWidth: 1, strokeDasharray: '4 2' }}
                  />
                  {/* Hidden anchor line — forces Recharts to compute the price axis scale */}
                  <Line yAxisId="price" dataKey="close" stroke="transparent" dot={false}
                    legendType="none" activeDot={false} isAnimationActive={false} />
                  {/* Broker flow lines */}
                  {activeBrokers.map(b => (
                    <Line
                      key={b}
                      yAxisId="lots"
                      dataKey={b}
                      stroke={brokerColor(b)}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3, fill: brokerColor(b) }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                  {/* Candlestick (rendered via Customized) */}
                  <Customized component={CandlestickLayer} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Volume pane */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <ResponsiveContainer width="100%" height={70}>
                <ComposedChart data={data.timeline} margin={{ top: 4, right: 72, left: 0, bottom: 0 }} syncId="flow">
                  <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--sub)', fontSize: 8 }} tickLine={false} axisLine={false}
                    width={56} tickFormatter={v => `${(v / 1e6).toFixed(0)}M`} />
                  <YAxis yAxisId="price" orientation="right" hide />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const vol = payload[0]?.value as number;
                      return (
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
                          <div style={{ color: 'var(--sub)' }}>{fmtDate(String(label ?? ''))}</div>
                          <div style={{ fontFamily: 'monospace', color: 'var(--sub)', fontWeight: 600 }}>Vol: {fmtLots(vol)}</div>
                        </div>
                      );
                    }}
                    cursor={false}
                  />
                  <Bar dataKey="volume" maxBarSize={6}>
                    {data.timeline.map((d, i) => (
                      <Cell key={i} fill={Number(d.close ?? 0) >= Number(d.open ?? d.close ?? 0) ? 'var(--buy)' : 'var(--sell)'} fillOpacity={0.6} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {!loading && data && data.timeline.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sub)', marginBottom: 6 }}>
              No price data for {ticker} in this date range
            </div>
            <div style={{ fontSize: 12 }}>Run a daily sync or try a different date range.</div>
          </div>
        )}

        {!loading && data && data.timeline.length > 0 && data.weeks_of_data === 0 && (
          <div style={{
            marginTop: 16, background: 'var(--watch-dim)', border: '1px solid var(--watch)',
            borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--text)',
          }}>
            <strong style={{ color: 'var(--watch)' }}>No broker history data.</strong>{' '}
            Go to Admin → "Broker History Backfill" to fetch 12 weeks of historical broker data.
            Price chart is shown but broker lines won't appear until that's done.
          </div>
        )}

      </div>
    </Layout>
  );
};

export default BrokerFlow;
