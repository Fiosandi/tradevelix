import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { dashboardApi } from '../api';
import type { StockDetail as SD, BrokerEntry, DailyPrice, StockHistory, WeeklyHistoryPoint, MajorHolderMovement, StockShareholder } from '../types';
import { ArrowLeft, ChevronDown, ChevronUp, Info } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Line, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceArea,
} from 'recharts';
import { Layout } from '../components/Layout';

// ─── Signal config ────────────────────────────────────────────────────────────

type Signal = SD['overall_signal'];
const SIGS: Record<Signal, { label: string; color: string; bg: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'var(--buy)',   bg: 'var(--buy-dim)'   },
  BUY:         { label: 'BUY',          color: 'var(--buy)',   bg: 'var(--buy-dim)'   },
  WATCH:       { label: 'WATCH',        color: 'var(--watch)', bg: 'var(--watch-dim)' },
  WAIT:        { label: 'WAIT',         color: 'var(--sub)',   bg: 'var(--wait-dim)'  },
  SELL:        { label: 'SELL',         color: 'var(--sell)',  bg: 'var(--sell-dim)'  },
  STRONG_SELL: { label: 'STRONG SELL',  color: 'var(--sell)',  bg: 'var(--sell-dim)'  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const n = (x: number | string | null | undefined, d = 0): string => {
  if (x == null || x === '') return '—';
  const v = +x; if (isNaN(v)) return '—';
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(d);
};
const rp = (x: number | null | undefined) => x == null ? '—' : x.toLocaleString('id-ID');

const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = (iso: string) => {
  if (!iso) return '';
  const parts = iso.split('-');
  return `${parts[2]} ${MONTHS[+parts[1]]} ${parts[0].slice(2)}`;
};

// ─── Evidence panels ──────────────────────────────────────────────────────────

const EvidenceWhaleNet: React.FC<{ entries: BrokerEntry[]; net: number }> = ({ entries, net }) => {
  const whales = entries.filter(b => b.is_whale).sort((a, b) => Math.abs(b.lots) - Math.abs(a.lots));
  const maxLots = Math.max(...whales.map(b => Math.abs(b.lots)), 1);
  const pos = net >= 0;
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 10, lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--text)' }}>Formula:</strong>{' '}
        Σ(Whale Broker BUY lots) − Σ(Whale Broker SELL lots)<br />
        Whale brokers classified as: <span style={{ color: 'var(--whale)', fontFamily: 'monospace' }}>
          {whales.map(b => b.broker_code).join(', ') || 'AI, BK, YU, BB, AS, SS, CS'}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Broker', 'Side', 'Net Lots', 'Avg Price', 'Investor Type', 'Contribution'].map((h, i) => (
              <th key={h} className="th" style={{ textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {whales.map(b => {
            const barW = (Math.abs(b.lots) / maxLots) * 100;
            const buy = b.side === 'BUY';
            const netLots = buy ? b.lots : -b.lots;
            return (
              <tr key={b.broker_code}>
                <td className="td" style={{ fontWeight: 700, fontFamily: 'monospace', color: 'var(--whale)' }}>{b.broker_code}</td>
                <td className="td">
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                    color: buy ? 'var(--buy)' : 'var(--sell)',
                    background: buy ? 'var(--buy-dim)' : 'var(--sell-dim)',
                  }}>{b.side}</span>
                </td>
                <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: buy ? 'var(--buy)' : 'var(--sell)' }}>
                  {buy ? '+' : ''}{netLots.toLocaleString()}
                </td>
                <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>
                  Rp {rp(b.avg_price)}
                </td>
                <td className="td" style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 10, color: b.investor_type === 'Asing' ? 'var(--floor)' : 'var(--sub)' }}>{b.investor_type}</span>
                </td>
                <td className="td" style={{ textAlign: 'right', paddingRight: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <div style={{ width: 60, height: 4, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barW}%`, background: buy ? 'var(--buy)' : 'var(--sell)', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--sub)', minWidth: 32, textAlign: 'right' }}>{((Math.abs(b.lots) / maxLots) * 100).toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{
        marginTop: 10, padding: '10px 14px', borderRadius: 8,
        background: pos ? 'var(--buy-dim)' : 'var(--sell-dim)',
        border: `1px solid ${pos ? 'var(--buy)' : 'var(--sell)'}`,
        fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ color: 'var(--sub)' }}>Net result: Σ BUY − Σ SELL</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 15, color: pos ? 'var(--buy)' : 'var(--sell)' }}>
          {pos ? '+' : ''}{net.toLocaleString()} lots → {pos ? 'ACCUMULATING' : 'DISTRIBUTING'}
        </span>
      </div>
    </div>
  );
};

const EvidenceRetailExit: React.FC<{ entries: BrokerEntry[]; retail: number }> = ({ entries, retail }) => {
  // Use non-whale entries as retail proxy, sorted by sell side
  const retailers = entries.filter(b => !b.is_whale && b.side === 'SELL').sort((a, b) => b.lots - a.lots).slice(0, 8);
  const totalSell = entries.filter(b => !b.is_whale && b.side === 'SELL').reduce((s, b) => s + b.lots, 0);
  const totalAll  = entries.reduce((s, b) => s + b.lots, 0);
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 10, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text)' }}>Formula:</strong>{' '}
        (Non-whale SELL lots ÷ Total lots) × 100<br />
        <strong style={{ color: 'var(--text)' }}>Interpretation:</strong>{' '}
        High % = retail is exiting → whales absorbing. Bullish signal when retail exits ≥ 50%.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Non-whale SELL lots', value: totalSell.toLocaleString(), color: 'var(--sell)' },
          { label: 'Total all lots traded', value: totalAll.toLocaleString(), color: 'var(--sub)' },
          { label: 'Retail Exit %', value: retail.toFixed(1) + '%', color: retail >= 50 ? 'var(--buy)' : 'var(--sub)' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 15, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--sub)', marginBottom: 6, fontWeight: 600 }}>TOP NON-WHALE SELLERS</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>
          {['Broker', 'Lots Sold', 'Avg Price', 'Type', 'Share'].map((h, i) => (
            <th key={h} className="th" style={{ textAlign: i >= 1 ? 'right' : 'left' }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {retailers.map(b => (
            <tr key={b.broker_code}>
              <td className="td" style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{b.broker_code}</td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--sell)', fontWeight: 700 }}>{b.lots.toLocaleString()}</td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>Rp {rp(b.avg_price)}</td>
              <td className="td" style={{ textAlign: 'right', fontSize: 10, color: b.investor_type === 'Asing' ? 'var(--floor)' : 'var(--sub)' }}>{b.investor_type}</td>
              <td className="td" style={{ textAlign: 'right', color: 'var(--sub)', fontSize: 10 }}>{totalSell > 0 ? ((b.lots / totalSell) * 100).toFixed(1) + '%' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const EvidenceKekompakan: React.FC<{ entries: BrokerEntry[]; score: number }> = ({ entries, score }) => {
  const whales = entries.filter(b => b.is_whale);
  const buying  = whales.filter(b => b.side === 'BUY');
  const selling = whales.filter(b => b.side === 'SELL');
  const majority = buying.length >= selling.length ? 'BUY' : 'SELL';

  if (whales.length === 0) return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>🤝</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sub)', marginBottom: 4 }}>No whale broker data for this week</div>
      <div style={{ fontSize: 11 }}>Run a weekly sync to populate broker entries. Kekompakan score of {score.toFixed(1)}% was calculated from the last available data.</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 10, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text)' }}>Formula:</strong>{' '}
        (Whale brokers in majority direction ÷ Total active whale brokers) × 100<br />
        <strong style={{ color: 'var(--text)' }}>Interpretation:</strong>{' '}
        ≥70% = strong whale consensus. &lt;40% = mixed signals — avoid entering.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Active whale brokers', value: whales.length, color: 'var(--whale)' },
          { label: 'Buying whales', value: buying.length, color: 'var(--buy)' },
          { label: 'Selling whales', value: selling.length, color: 'var(--sell)' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 20, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--sub)' }}>Whale coordination ({majority} majority)</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: score >= 60 ? 'var(--whale)' : 'var(--sub)' }}>{score.toFixed(1)}%</span>
        </div>
        <div className="pbar-track">
          <div className="pbar-fill" style={{ width: `${score}%`, background: score >= 70 ? 'var(--whale)' : score >= 40 ? 'var(--watch)' : 'var(--sell)' }} />
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>
          {['Broker', 'Direction', 'Lots', 'Avg Price', 'Investor Type'].map((h, i) => (
            <th key={h} className="th" style={{ textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {whales.sort((a,b) => Math.abs(b.lots)-Math.abs(a.lots)).map(b => (
            <tr key={b.broker_code}>
              <td className="td" style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--whale)' }}>{b.broker_code}</td>
              <td className="td">
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                  color: b.side === 'BUY' ? 'var(--buy)' : 'var(--sell)',
                  background: b.side === 'BUY' ? 'var(--buy-dim)' : 'var(--sell-dim)',
                }}>{b.side}</span>
              </td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: b.side === 'BUY' ? 'var(--buy)' : 'var(--sell)', fontWeight: 700 }}>
                {b.lots.toLocaleString()}
              </td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>Rp {rp(b.avg_price)}</td>
              <td className="td" style={{ textAlign: 'right', fontSize: 10, color: 'var(--sub)' }}>{b.investor_type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const EvidenceFloor: React.FC<{ entries: BrokerEntry[]; current: number; floor: number; dist: number }> = ({ entries, current, floor, dist }) => {
  const whales = entries.filter(b => b.is_whale && b.side === 'BUY');
  const totalLots  = whales.reduce((s, b) => s + b.lots, 0);
  const weightedSum = whales.reduce((s, b) => s + (b.lots * b.avg_price), 0);
  const calcFloor = totalLots > 0 ? (weightedSum / totalLots) : 0;
  const pos = dist >= 0;
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--sub)', marginBottom: 10, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text)' }}>Bandar Floor Formula:</strong>{' '}
        Weighted average buy price of whale brokers<br />
        = Σ(lots × avg_price) ÷ Σ(lots) across all buying whale brokers<br />
        <strong style={{ color: 'var(--text)' }}>Distance:</strong>{' '}
        (Current Price − Bandar Floor) ÷ Bandar Floor × 100
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Current Price',  value: `Rp ${rp(current)}`,  color: 'var(--text)' },
          { label: 'Bandar Floor',   value: `Rp ${rp(floor)}`,   color: 'var(--floor)' },
          { label: 'Distance',       value: `${pos?'+':''}${dist.toFixed(2)}%`, color: dist <= 5 ? 'var(--watch)' : dist <= 15 ? 'var(--buy)' : 'var(--sub)' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--sub)', marginBottom: 6, fontWeight: 600 }}>WHALE BROKER BUY PRICES (inputs to floor calc)</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>
          {['Broker', 'Lots', 'Avg Buy Price', 'Lot × Price', 'Weight'].map((h, i) => (
            <th key={h} className="th" style={{ textAlign: i >= 1 ? 'right' : 'left' }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {whales.sort((a,b) => b.lots-a.lots).map(b => (
            <tr key={b.broker_code}>
              <td className="td" style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--whale)' }}>{b.broker_code}</td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--buy)' }}>{b.lots.toLocaleString()}</td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>Rp {rp(b.avg_price)}</td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)', fontSize: 11 }}>{n(b.lots * b.avg_price)}</td>
              <td className="td" style={{ textAlign: 'right', color: 'var(--sub)', fontSize: 10 }}>
                {totalLots > 0 ? ((b.lots / totalLots) * 100).toFixed(1) + '%' : '—'}
              </td>
            </tr>
          ))}
          {totalLots > 0 && (
            <tr style={{ background: 'var(--card-hi)' }}>
              <td className="td" style={{ fontWeight: 700, color: 'var(--sub)' }}>Weighted Avg</td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--whale)', fontWeight: 700 }}>{totalLots.toLocaleString()}</td>
              <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: 'var(--floor)', fontSize: 13 }}>
                Rp {rp(Math.round(calcFloor))}
              </td>
              <td className="td" colSpan={2} style={{ textAlign: 'right', fontSize: 10, color: 'var(--sub)' }}>
                = Bandar Floor
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'var(--buy-dim)', border: '1px solid var(--buy)', fontSize: 11 }}>
        <strong style={{ color: 'var(--text)' }}>Zone Guide:</strong>{' '}
        <span style={{ color: 'var(--sell)' }}>&lt;2% = Danger</span> ·{' '}
        <span style={{ color: 'var(--buy)' }}>2–15% = Sweet Spot (buy zone)</span> ·{' '}
        <span style={{ color: 'var(--sub)' }}>&gt;15% = Safe but expensive</span>
      </div>
    </div>
  );
};

// ─── Clickable metric card ────────────────────────────────────────────────────

type EvidenceType = 'whale' | 'retail' | 'kekompakan' | 'floor';

const MetricCard: React.FC<{
  label: string;
  value: React.ReactNode;
  sub: string;
  accent: string;
  evidenceType: EvidenceType;
  open: boolean;
  onToggle: () => void;
  evidence: React.ReactNode;
}> = ({ label, value, sub, accent, open, onToggle, evidence }) => (
  <div className={`metric-card ${open ? 'open' : ''}`} style={{ borderTop: `2px solid ${accent}` }}>
    <div
      onClick={onToggle}
      style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, marginBottom: 4, fontFamily: 'monospace' }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--sub)', letterSpacing: '0.05em' }}>EVIDENCE</span>
        <span style={{ color: 'var(--sub)' }}>{open ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}</span>
      </div>
    </div>
    {open && (
      <div className="evidence-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <Info size={12} style={{ color: 'var(--floor)' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--floor)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            How this is calculated
          </span>
        </div>
        {evidence}
      </div>
    )}
  </div>
);

// ─── Panel wrapper ────────────────────────────────────────────────────────────

const Panel: React.FC<{ tag: string; title: string; right?: React.ReactNode; children: React.ReactNode }> = ({ tag, title, right, children }) => (
  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
    <div style={{
      padding: '12px 20px', borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--sub)', letterSpacing: '0.1em',
          textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4,
          background: 'var(--bg)', border: '1px solid var(--border)',
        }}>{tag}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
      </div>
      {right && <div>{right}</div>}
    </div>
    <div style={{ padding: 20 }}>{children}</div>
  </div>
);

// ─── KV row ───────────────────────────────────────────────────────────────────

const KV: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0', borderBottom: '1px solid var(--border)',
  }}>
    <span style={{ fontSize: 12, color: 'var(--sub)' }}>{label}</span>
    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{value}</span>
  </div>
);

// ─── Multi-metric chart ───────────────────────────────────────────────────────

const MultiChart: React.FC<{ prices: DailyPrice[]; entryZone?: { ideal: number; max: number } | null }> = ({ prices, entryZone }) => {
  const data = prices.map(p => ({
    date:  p.date,
    close: p.close,
    vol:   +(p.volume / 1e6).toFixed(2),
    fBuy:  +(p.foreign_buy  / 1e9).toFixed(3),
    fSell: -(p.foreign_sell / 1e9).toFixed(3),
    fNet:  +((p.foreign_buy - p.foreign_sell) / 1e9).toFixed(3),
  }));

  const minC = Math.min(...data.map(d => d.close)) * 0.994;
  const maxC = Math.max(...data.map(d => d.close)) * 1.006;

  const Tip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
        <div style={{ color: 'var(--sub)', marginBottom: 6, fontWeight: 600 }}>{fmtDate(label)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--sub)' }}>Close</span>
            <span style={{ color: 'var(--text)', fontFamily: 'monospace', fontWeight: 700 }}>Rp {rp(d?.close)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--buy)' }}>F.Buy</span>
            <span style={{ color: 'var(--buy)', fontFamily: 'monospace' }}>{d?.fBuy?.toFixed(2)}B</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--sell)' }}>F.Sell</span>
            <span style={{ color: 'var(--sell)', fontFamily: 'monospace' }}>{Math.abs(d?.fSell ?? 0).toFixed(2)}B</span>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 3, paddingTop: 3, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: d?.fNet >= 0 ? 'var(--buy)' : 'var(--sell)' }}>F.Net</span>
            <span style={{ color: d?.fNet >= 0 ? 'var(--buy)' : 'var(--sell)', fontFamily: 'monospace', fontWeight: 700 }}>
              {d?.fNet >= 0 ? '+' : ''}{d?.fNet?.toFixed(3)}B
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--sub)', marginBottom: 6, display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 16, height: 2, background: 'var(--text)', display: 'inline-block' }} /> Price
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 8, background: 'var(--buy-dim)', border: '1px solid var(--buy)', display: 'inline-block', borderRadius: 2 }} /> F.Buy
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 8, background: 'var(--sell-dim)', border: '1px solid var(--sell)', display: 'inline-block', borderRadius: 2 }} /> F.Sell
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 64, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: 'var(--sub)', fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" tickFormatter={fmtDate} />
          <YAxis yAxisId="price" domain={[minC, maxC]} orientation="right"
            tick={{ fill: 'var(--sub)', fontSize: 9 }} tickLine={false} axisLine={false}
            tickFormatter={v => rp(Math.round(v))} width={68} />
          <YAxis yAxisId="flow" domain={['auto', 'auto']} hide />
          <Tooltip content={<Tip />} />
          <Bar yAxisId="flow" dataKey="fBuy"  fill="var(--buy)"  fillOpacity={0.35} radius={[2,2,0,0]} maxBarSize={6} />
          <Bar yAxisId="flow" dataKey="fSell" fill="var(--sell)" fillOpacity={0.35} radius={[0,0,2,2]} maxBarSize={6} />
          <Line yAxisId="price" type="monotone" dataKey="close" stroke="var(--text)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: 'var(--text)' }} />
          {entryZone && (
            <ReferenceArea yAxisId="price" y1={entryZone.ideal} y2={entryZone.max}
              fill="rgba(16,217,139,.12)" stroke="rgba(16,217,139,.4)" strokeDasharray="4 2"
              label={{ value: 'Entry Zone', position: 'insideTopRight', fill: 'var(--buy)', fontSize: 9 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 4, fontSize: 10, color: 'var(--sub)' }}>Net Foreign Flow (Rp Billion)</div>
      <ResponsiveContainer width="100%" height={72}>
        <ComposedChart data={data} margin={{ top: 0, right: 64, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.3} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'var(--sub)', fontSize: 8 }} tickLine={false} axisLine={false} width={36} tickFormatter={v => v.toFixed(1)} />
          <Tooltip content={<Tip />} />
          <Bar dataKey="fNet" maxBarSize={8} radius={[2,2,2,2]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.fNet >= 0 ? 'var(--buy)' : 'var(--sell)'} fillOpacity={0.7} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

// ─── Broker table (one side) ──────────────────────────────────────────────────

const BrokerHalf: React.FC<{ entries: BrokerEntry[]; side: 'BUY' | 'SELL' }> = ({ entries, side }) => {
  const rows = entries.filter(b => b.side === side).sort((a, b) => b.lots - a.lots);
  const max  = rows[0]?.lots ?? 1;
  const col  = side === 'BUY' ? 'var(--buy)' : 'var(--sell)';
  const dim  = side === 'BUY' ? 'var(--buy-dim)' : 'var(--sell-dim)';

  const typeBadge = (t: string) => {
    const m: Record<string, string> = { Asing: 'var(--floor)', Lokal: 'var(--sub)', Pemerintah: 'var(--whale)' };
    return <span style={{ fontSize: 9, fontWeight: 700, color: m[t] ?? 'var(--sub)' }}>{t}</span>;
  };

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: col }}>{side === 'BUY' ? '↑' : '↓'} {side}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{rows.length} brokers</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
          <tr>{['Code', 'Lots', 'Avg Price', 'Value', 'Type'].map((h, i) => (
            <th key={h} className="th" style={{ textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((b, i) => {
            const barW = (b.lots / max) * 100;
            return (
              <tr key={b.broker_code + i}
                style={{ background: `linear-gradient(to right, ${dim} ${barW}%, transparent ${barW}%)` }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-hi)')}
                onMouseLeave={e => (e.currentTarget.style.background = `linear-gradient(to right, ${dim} ${barW}%, transparent ${barW}%)`)}
              >
                <td className="td" style={{ fontWeight: 700, fontFamily: 'monospace', color: b.is_whale ? 'var(--whale)' : col }}>
                  {b.is_whale && <span style={{ marginRight: 3, fontSize: 9 }}>🐋</span>}{b.broker_code}
                </td>
                <td className="td" style={{ position: 'relative', zIndex: 1, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: col }}>{b.lots.toLocaleString()}</td>
                <td className="td" style={{ position: 'relative', zIndex: 1, textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>Rp {rp(b.avg_price)}</td>
                <td className="td" style={{ position: 'relative', zIndex: 1, textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)', fontSize: 10 }}>{n(b.value)}</td>
                <td className="td" style={{ position: 'relative', zIndex: 1, textAlign: 'right' }}>{typeBadge(b.investor_type)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ─── Flow by category ─────────────────────────────────────────────────────────

const FlowByCategory: React.FC<{ entries: BrokerEntry[] }> = ({ entries }) => {
  const cats = ['Asing', 'Lokal', 'Pemerintah'];
  const colMap: Record<string, string> = { Asing: 'var(--floor)', Lokal: 'var(--sub)', Pemerintah: 'var(--whale)' };
  const data = cats.map(cat => {
    const rows = entries.filter(b => b.investor_type === cat);
    const buy  = rows.filter(b => b.side === 'BUY').reduce((s, b) => s + b.lots, 0);
    const sell = rows.filter(b => b.side === 'SELL').reduce((s, b) => s + b.lots, 0);
    return { cat, buy, sell, net: buy - sell };
  }).filter(d => d.buy + d.sell > 0);
  const maxL = Math.max(...data.flatMap(d => [d.buy, d.sell]), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.map(d => (
        <div key={d.cat}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: colMap[d.cat] ?? 'var(--text)' }}>{d.cat}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: d.net >= 0 ? 'var(--buy)' : 'var(--sell)' }}>
              Net: {d.net >= 0 ? '+' : ''}{n(d.net)}
            </span>
          </div>
          {[{ side: 'BUY', v: d.buy, c: 'var(--buy)' }, { side: 'SELL', v: d.sell, c: 'var(--sell)' }].map(row => (
            <div key={row.side} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 28, fontSize: 9, color: row.c, textAlign: 'right', fontWeight: 700 }}>{row.side}</span>
              <div style={{ flex: 1, height: 7, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(row.v / maxL) * 100}%`, background: row.c, borderRadius: 4, opacity: 0.8 }} />
              </div>
              <span style={{ width: 56, textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: row.c, fontWeight: 600 }}>{n(row.v)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

// ─── 8-week trend chart ───────────────────────────────────────────────────────

const SIG_COLOR: Record<string, string> = {
  STRONG_BUY: 'var(--buy)', BUY: 'var(--buy)',
  WATCH: 'var(--watch)', WAIT: 'var(--muted)',
  SELL: 'var(--sell)', STRONG_SELL: 'var(--sell)',
};

const TrendChart: React.FC<{ data: WeeklyHistoryPoint[] }> = ({ data }) => {
  const maxAbs = Math.max(...data.map(d => Math.abs(d.whale_net_lots)), 1);

  const TrendTip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload as WeeklyHistoryPoint;
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 11 }}>
        <div style={{ color: 'var(--sub)', marginBottom: 6, fontWeight: 600 }}>{fmtDate(label)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--sub)' }}>Whale Net</span>
            <span style={{ color: d.whale_net_lots >= 0 ? 'var(--buy)' : 'var(--sell)', fontFamily: 'monospace', fontWeight: 700 }}>
              {d.whale_net_lots >= 0 ? '+' : ''}{d.whale_net_lots.toLocaleString()} lots
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--sub)' }}>Retail Exit</span>
            <span style={{ color: d.retail_exit_percent >= 50 ? 'var(--buy)' : 'var(--muted)', fontFamily: 'monospace' }}>{d.retail_exit_percent.toFixed(1)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--sub)' }}>Signal</span>
            <span style={{ color: SIG_COLOR[d.overall_signal] ?? 'var(--muted)', fontWeight: 700, fontSize: 10 }}>{d.overall_signal?.replace('_', ' ')}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--sub)', marginBottom: 8, alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: 'var(--buy-dim)', border: '1px solid var(--buy)', borderRadius: 2, display: 'inline-block' }} /> Whale Net (buy)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: 'var(--sell-dim)', border: '1px solid var(--sell)', borderRadius: 2, display: 'inline-block' }} /> Whale Net (sell)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 16, height: 2, background: '#22d3ee', display: 'inline-block' }} /> Retail Exit %
        </span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 8, right: 64, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} strokeDasharray="3 3" />
          <XAxis dataKey="week_end" tick={{ fill: 'var(--sub)', fontSize: 9 }} tickLine={false} axisLine={false}
            tickFormatter={fmtDate} />
          <YAxis yAxisId="lots" domain={[-maxAbs * 1.1, maxAbs * 1.1]} orientation="left"
            tick={{ fill: 'var(--sub)', fontSize: 9 }} tickLine={false} axisLine={false} width={52}
            tickFormatter={v => v >= 1000 || v <= -1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
          <YAxis yAxisId="pct" domain={[0, 100]} orientation="right"
            tick={{ fill: 'var(--sub)', fontSize: 9 }} tickLine={false} axisLine={false} width={32}
            tickFormatter={v => `${v}%`} />
          <Tooltip content={<TrendTip />} />
          <Bar yAxisId="lots" dataKey="whale_net_lots" maxBarSize={28} radius={[3,3,3,3]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.whale_net_lots >= 0 ? 'var(--buy)' : 'var(--sell)'}
                fillOpacity={0.7} />
            ))}
          </Bar>
          <Line yAxisId="pct" type="monotone" dataKey="retail_exit_percent"
            stroke="#22d3ee" strokeWidth={1.5} dot={(p: any) => (
              <circle key={p.index} cx={p.cx} cy={p.cy} r={4}
                fill={SIG_COLOR[data[p.index]?.overall_signal] ?? 'var(--muted)'}
                stroke="var(--surface)" strokeWidth={1.5} />
            )} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
        {data.map((d, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: SIG_COLOR[d.overall_signal] ?? 'var(--muted)', fontWeight: 700 }}>
              {d.overall_signal?.replace('_', ' ')}
            </div>
            <div style={{ fontSize: 8, color: 'var(--muted)' }}>{fmtDate(d.week_end ?? '')}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

const StockDetailPage: React.FC = () => {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate   = useNavigate();
  const [stock,   setStock]   = useState<SD | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [openEvidence, setOpenEvidence] = useState<Set<EvidenceType>>(new Set());
  const [range, setRange] = useState<'1M' | '3M' | 'Max'>('3M');
  const [history, setHistory] = useState<StockHistory | null>(null);
  const [majorHolders, setMajorHolders] = useState<MajorHolderMovement[]>([]);
  const [shareholders, setShareholders] = useState<StockShareholder[]>([]);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    Promise.all([
      dashboardApi.getStockDetail(ticker),
      dashboardApi.getStockHistory(ticker),
      dashboardApi.getMajorHolders(ticker).catch(() => ({ movements: [] })),
      dashboardApi.getShareholders(ticker).catch(() => ({ shareholders: [] })),
    ])
      .then(([detail, hist, holders, sh]) => {
        setStock(detail);
        setHistory(hist);
        setMajorHolders(holders.movements ?? []);
        setShareholders(sh.shareholders ?? []);
      })
      .catch(() => setError(`Failed to load ${ticker}`))
      .finally(() => setLoading(false));
  }, [ticker]);

  const accdist = useMemo(() => {
    if (!stock) return null;
    return stock.api_signals.find(s => s.signal_type === 'accumulation')?.status ?? null;
  }, [stock]);

  const pumpRisk = useMemo(() => {
    if (!stock) return null;
    const pd = stock.api_signals.find(s => s.signal_type === 'pump_dump');
    return pd && pd.score != null && pd.score > 6 ? pd.score : null;
  }, [stock]);

  const entryZone = useMemo(() => {
    if (!stock) return null;
    const acc = stock.api_signals.find(s => s.signal_type === 'accumulation');
    if (!acc?.entry_ideal_price) return null;
    return { ideal: acc.entry_ideal_price, max: acc.entry_max_price ?? acc.entry_ideal_price * 1.02 };
  }, [stock]);

  const chartPrices = useMemo(() => {
    if (!stock) return [];
    const all = stock.recent_prices;
    if (range === '1M') return all.slice(-30);
    if (range === '3M') return all.slice(-90);
    return all;
  }, [stock, range]);

  const toggleEvidence = (type: EvidenceType) => {
    setOpenEvidence(prev => {
      const next = new Set(prev);
      if (type === 'whale' || type === 'retail') {
        const bothOpen = next.has('whale') || next.has('retail');
        if (bothOpen) { next.delete('whale'); next.delete('retail'); }
        else { next.add('whale'); next.add('retail'); }
      } else {
        if (next.has(type)) next.delete(type); else next.add(type);
      }
      return next;
    });
  };

  if (loading) return (
    <Layout title="Stock Profiler" ticker={ticker}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12, flexDirection: 'column' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--floor)' }} className="spin" />
        <span style={{ color: 'var(--sub)', fontSize: 13 }}>Loading {ticker}...</span>
      </div>
    </Layout>
  );

  if (error || !stock) return (
    <Layout title="Stock Profiler">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: 'var(--sell)', fontSize: 14 }}>{error ?? 'Not found'}</div>
        <button onClick={() => navigate('/dashboard')} style={{ padding: '8px 18px', background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--sub)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
          ← Dashboard
        </button>
      </div>
    </Layout>
  );

  const s      = SIGS[stock.overall_signal] ?? SIGS.WAIT;
  const pos    = stock.whale_net_lots > 0;
  const retail = Math.min(Math.max(stock.retail_exit_percent, 0), 100);
  const keko   = stock.kekompakan_score;
  const dist   = stock.distance_to_floor_pct;
  const vpa    = stock.vpa_signal ? String(stock.vpa_signal).replace(/_/g, ' ') : '—';
  const vpaUp  = vpa.includes('UP');
  const vpaDown = vpa.includes('DOWN');

  return (
    <Layout title="Stock Profiler" subtitle={`${fmtDate(stock.week_start)} – ${fmtDate(stock.week_end)}`} ticker={stock.ticker}>
      <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Back + Hero */}
        <div>
          <button onClick={() => navigate('/dashboard')} style={{
            display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 12,
            background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, padding: 0,
          }}>
            <ArrowLeft size={13} /> Back to Dashboard
          </button>

          <div style={{
            background: 'var(--card)', border: `1px solid var(--border)`,
            borderLeft: `4px solid var(--buy)`, borderRadius: 14,
            padding: '18px 24px',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20,
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.02em' }}>{stock.ticker}</span>
                <span className="sig-badge" style={{ color: s.color, background: s.bg, borderColor: `${s.color}40` }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                  {s.label} · {stock.confidence_score}%
                </span>
                {accdist && (
                  <span className="sig-badge" style={{
                    color: accdist === 'ACCUMULATION' ? 'var(--floor)' : 'var(--watch)',
                    background: accdist === 'ACCUMULATION' ? 'var(--floor-dim)' : 'var(--watch-dim)',
                    borderColor: accdist === 'ACCUMULATION' ? 'var(--floor)' : 'var(--watch)',
                    opacity: 0.9,
                  }}>
                    {accdist === 'ACCUMULATION' ? '▲ AKUMULASI' : '▼ DISTRIBUSI'}
                  </span>
                )}
                {pumpRisk != null && (
                  <span className="sig-badge" style={{ color: '#ff3b5c', background: 'rgba(255,59,92,.12)', borderColor: 'rgba(255,59,92,.4)', animation: 'pulse 1.5s ease-in-out infinite' }}>
                    ⚠ PUMP RISK {pumpRisk.toFixed(1)}
                  </span>
                )}
                {stock.sector && <span style={{ fontSize: 10, color: 'var(--sub)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 5 }}>{stock.sector}</span>}
              </div>
              <div style={{ fontSize: 14, color: 'var(--sub)' }}>{stock.name}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>Rp {rp(stock.current_price)}</div>
              {stock.price_change_week != null && (
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: stock.price_change_week >= 0 ? 'var(--buy)' : 'var(--sell)' }}>
                  {stock.price_change_week >= 0 ? '▲' : '▼'} {Math.abs(stock.price_change_week).toFixed(2)}% / week
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Clickable metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, alignItems: 'start' }}>
          <MetricCard
            label="🐋 Whale Net" evidenceType="whale"
            value={<span style={{ color: pos ? 'var(--buy)' : 'var(--sell)' }}>{pos?'+':''}{n(stock.whale_net_lots)} lots</span>}
            sub={pos ? 'Accumulating' : 'Distributing'}
            accent={pos ? 'var(--buy)' : 'var(--sell)'}
            open={openEvidence.has('whale')} onToggle={() => toggleEvidence('whale')}
            evidence={<EvidenceWhaleNet entries={stock.broker_entries} net={stock.whale_net_lots} />}
          />
          <MetricCard
            label="📊 Retail Exit" evidenceType="retail"
            value={<span style={{ color: retail >= 50 ? 'var(--buy)' : 'var(--sub)' }}>{retail.toFixed(1)}%</span>}
            sub={retail >= 60 ? 'High exodus — bullish' : retail >= 40 ? 'Moderate exit' : 'Low exit — caution'}
            accent={retail >= 50 ? 'var(--buy)' : 'var(--border)'}
            open={openEvidence.has('retail')} onToggle={() => toggleEvidence('retail')}
            evidence={<EvidenceRetailExit entries={stock.broker_entries} retail={retail} />}
          />
          <MetricCard
            label="🤝 Kekompakan" evidenceType="kekompakan"
            value={<span style={{ color: keko >= 60 ? 'var(--whale)' : 'var(--sub)' }}>{keko.toFixed(1)}%</span>}
            sub={keko >= 70 ? 'Strong coordination' : keko >= 40 ? 'Moderate' : 'Weak'}
            accent={keko >= 60 ? 'var(--whale)' : 'var(--border)'}
            open={openEvidence.has('kekompakan')} onToggle={() => toggleEvidence('kekompakan')}
            evidence={<EvidenceKekompakan entries={stock.broker_entries} score={keko} />}
          />
          <MetricCard
            label="🎯 Vs Floor" evidenceType="floor"
            value={<span style={{ color: dist <= 5 ? 'var(--watch)' : dist <= 15 ? 'var(--buy)' : 'var(--sub)' }}>{dist >= 0 ? '+' : ''}{dist.toFixed(2)}%</span>}
            sub={dist <= 3 ? '⚠ Near floor — buy zone' : dist <= 10 ? '✓ Sweet spot' : 'Above floor'}
            accent={dist <= 5 ? 'var(--watch)' : 'var(--border)'}
            open={openEvidence.has('floor')} onToggle={() => toggleEvidence('floor')}
            evidence={<EvidenceFloor entries={stock.broker_entries} current={stock.current_price} floor={stock.bandar_floor_price} dist={dist} />}
          />
        </div>

        {/* Price chart */}
        {stock.recent_prices.length > 0 && (
          <Panel tag={`Chart · ${range}`} title="Price & Foreign Flow"
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['1M', '3M', 'Max'] as const).map(r => (
                    <button key={r} onClick={() => setRange(r)} style={{
                      padding: '2px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                      background: range === r ? 'var(--floor)' : 'var(--card-hi)',
                      color: range === r ? 'white' : 'var(--muted)',
                      border: `1px solid ${range === r ? 'var(--floor)' : 'var(--border)'}`,
                      cursor: 'pointer', transition: 'all 0.1s',
                    }}>{r}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--sub)' }}>
                  {chartPrices.length > 0 && <>
                    <span>High: <strong style={{ color: 'var(--text)', fontFamily: 'monospace' }}>{rp(Math.max(...chartPrices.map(p => p.close)))}</strong></span>
                    <span>Low: <strong style={{ color: 'var(--text)', fontFamily: 'monospace' }}>{rp(Math.min(...chartPrices.map(p => p.close)))}</strong></span>
                  </>}
                </div>
              </div>
            }
          >
            <MultiChart prices={chartPrices} entryZone={entryZone} />
          </Panel>
        )}

        {/* Broker flow */}
        {stock.broker_entries.length > 0 && (
          <Panel tag="Broker Flow" title="Buy & Sell Activity"
            right={
              <div style={{ display: 'flex', gap: 16, fontSize: 11, alignItems: 'center' }}>
                {stock.broker_summary?.broker_accdist && (
                  <span style={{ fontWeight: 700, color: stock.broker_summary.broker_accdist === 'Acc' ? 'var(--buy)' : 'var(--sell)' }}>
                    {stock.broker_summary.broker_accdist === 'Acc' ? '▲ AKUMULASI' : '▼ DISTRIBUSI'}
                  </span>
                )}
                <span style={{ color: 'var(--sub)' }}>
                  Avg: <strong style={{ color: 'var(--text)', fontFamily: 'monospace' }}>Rp {rp(stock.broker_summary?.avg_price)}</strong>
                </span>
              </div>
            }
          >
            <div style={{ display: 'flex', gap: 0, overflow: 'auto' }}>
              <BrokerHalf entries={stock.broker_entries} side="BUY" />
              <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
              <BrokerHalf entries={stock.broker_entries} side="SELL" />
            </div>
            <div style={{ marginTop: 10, fontSize: 10, color: 'var(--muted)' }}>
              🐋 Whale broker · <span style={{ color: 'var(--floor)' }}>Asing</span> = Foreign · <span style={{ color: 'var(--sub)' }}>Lokal</span> = Local · <span style={{ color: 'var(--whale)' }}>Pemerintah</span> = Government
            </div>
          </Panel>
        )}

        {/* Bottom row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>

          {/* Flow by category */}
          <Panel tag="Category Flow" title="Foreign · Local · Gov">
            <FlowByCategory entries={stock.broker_entries} />
          </Panel>

          {/* Floor price */}
          <Panel tag="Floor Price" title="Bandar Floor">
            {stock.bandar_floor_price > 0 && stock.current_price > 0 ? (() => {
              const ceiling = stock.bandar_floor_price * 1.30;
              const pct = Math.min(Math.max(((stock.current_price - stock.bandar_floor_price) / (ceiling - stock.bandar_floor_price)) * 100, 2), 97);
              return (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                    {[
                      { label: 'Bandar Floor', v: rp(stock.bandar_floor_price), color: 'var(--floor)' },
                      { label: 'Current',      v: rp(stock.current_price),       color: 'var(--text)' },
                    ].map(c => (
                      <div key={c.label} style={{ background: 'var(--surface)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{c.label}</div>
                        <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: c.color }}>Rp {c.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ position: 'relative', height: 20, borderRadius: 10, overflow: 'hidden', background: 'var(--border)', marginBottom: 6 }}>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                      <div style={{ width: '10%', background: 'var(--sell-dim)' }} />
                      <div style={{ flex: 1, background: 'var(--buy-dim)' }} />
                      <div style={{ width: '15%', background: 'var(--floor-dim)' }} />
                    </div>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct}%`, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center' }}>
                      <div style={{ width: 3, height: '100%', background: dist <= 5 ? 'var(--watch)' : 'var(--text)', borderRadius: 2 }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: dist <= 5 ? 'var(--watch)' : dist <= 15 ? 'var(--buy)' : 'var(--sub)' }}>
                    {dist >= 0 ? '+' : ''}{dist.toFixed(2)}%
                  </div>
                </div>
              );
            })() : <div style={{ color: 'var(--muted)', fontSize: 13 }}>No floor data</div>}
          </Panel>

          {/* Three Doors */}
          <Panel tag="Three Doors" title="Signal Summary">
            <div>
              {[
                { label: 'Door 1 · Whale Net',    value: <span style={{ color: pos ? 'var(--buy)' : 'var(--sell)' }}>{pos?'+':''}{n(stock.whale_net_lots)} lots</span> },
                { label: 'Door 2 · Retail Exit',  value: <span style={{ color: retail >= 50 ? 'var(--buy)' : 'var(--sub)' }}>{retail.toFixed(1)}%</span> },
                { label: 'Door 2 · VPA',          value: <span style={{ color: vpaUp ? 'var(--buy)' : vpaDown ? 'var(--sell)' : 'var(--sub)' }}>{vpa}</span> },
                { label: 'Door 3 · Kekompakan',   value: <span style={{ color: keko >= 60 ? 'var(--whale)' : 'var(--sub)' }}>{keko.toFixed(1)}%</span> },
                { label: 'Accumulation Score',     value: <span style={{ color: (stock.api_accumulation_score ?? 0) > 5 ? 'var(--buy)' : 'var(--sub)' }}>{stock.api_accumulation_score?.toFixed(1) ?? '—'}</span> },
                { label: 'Distribution Score',    value: <span style={{ color: (stock.api_distribution_score ?? 0) > 5 ? 'var(--sell)' : 'var(--sub)' }}>{stock.api_distribution_score?.toFixed(1) ?? '—'}</span> },
                ...(entryZone ? [{ label: '🎯 Entry Zone', value: <span style={{ color: 'var(--buy)', fontFamily: 'monospace', fontWeight: 700 }}>Rp {rp(entryZone.ideal)} – {rp(entryZone.max)}</span> }] : []),
                ...(pumpRisk != null ? [{ label: '⚠ Pump Risk', value: <span style={{ color: 'var(--sell)', fontWeight: 700 }}>{pumpRisk.toFixed(1)} / 10</span> }] : []),
                { label: 'Overall Signal',         value: <span style={{ color: s.color, fontWeight: 800 }}>{s.label}</span> },
              ].map(r => <KV key={r.label} label={r.label} value={r.value} />)}
            </div>
          </Panel>
        </div>

        {/* 8-week trend */}
        {history && history.weeks.length >= 2 && (
          <Panel tag={`${history.weeks.length}-Week Trend`} title="Whale Net & Retail Exit History">
            <TrendChart data={history.weeks} />
          </Panel>
        )}

        {/* Major holder movements */}
        {majorHolders.length > 0 && (
          <Panel tag="IDX / KSEI" title="Major Holder Disclosures (5%+)">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Holder', 'Date', 'Prev %', 'Curr %', 'Change', 'Action', 'Price', 'Source'].map((h, i) => (
                      <th key={h} className="th" style={{ textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {majorHolders.map((m, i) => {
                    const buy = m.action_type === 'BUY';
                    const sell = m.action_type === 'SELL';
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--card-hi)' }}>
                        <td className="td" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 11 }}>{m.holder_name}</span>
                          <span style={{ marginLeft: 6, fontSize: 9, color: m.nationality === 'FOREIGN' ? 'var(--floor)' : 'var(--sub)', fontWeight: 700 }}>
                            {m.nationality === 'FOREIGN' ? 'Asing' : 'Lokal'}
                          </span>
                        </td>
                        <td className="td" style={{ whiteSpace: 'nowrap', color: 'var(--sub)', fontSize: 11 }}>{fmtDate(m.disclosure_date)}</td>
                        <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)' }}>{m.prev_pct.toFixed(2)}%</td>
                        <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: buy ? 'var(--buy)' : sell ? 'var(--sell)' : 'var(--sub)' }}>
                          {m.curr_pct.toFixed(2)}%
                        </td>
                        <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: m.change_pct >= 0 ? 'var(--buy)' : 'var(--sell)' }}>
                          {m.change_pct >= 0 ? '+' : ''}{m.change_pct.toFixed(2)}%
                        </td>
                        <td className="td" style={{ textAlign: 'right' }}>
                          {m.action_type && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                              background: buy ? 'var(--buy-dim)' : 'var(--sell-dim)',
                              color: buy ? 'var(--buy)' : 'var(--sell)',
                            }}>{m.action_type}</span>
                          )}
                        </td>
                        <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)', fontSize: 11 }}>
                          {m.price_at_disclosure ? `Rp ${rp(m.price_at_disclosure)}` : '—'}
                        </td>
                        <td className="td" style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 9, color: 'var(--muted)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 3 }}>{m.source}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* Controlling shareholders + their broker codes */}
        {shareholders.length > 0 && (
          <Panel tag="5%+ Shareholders" title="Controlling Shareholders & Broker Mapping">
            <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--sub)', lineHeight: 1.6 }}>
              When these brokers appear in the whale flow evidence panel, they represent activity
              by the <strong style={{ color: 'var(--text)' }}>controlling shareholders</strong> of this stock —
              the strongest possible accumulation/distribution signal.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Shareholder', 'Broker Codes', 'Shares', '%', 'Role'].map(h => (
                      <th key={h} className="th" style={{ textAlign: h === 'Shareholder' ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shareholders.map((sh, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--card-hi)' }}>
                      <td className="td" style={{ fontWeight: 600, color: 'var(--text)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sh.name}
                      </td>
                      <td className="td" style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {sh.broker_codes.map(code => (
                            <span key={code} style={{
                              fontSize: 10, fontWeight: 800, fontFamily: 'monospace',
                              padding: '2px 7px', borderRadius: 4,
                              background: 'var(--whale-dim, rgba(112,86,255,.1))',
                              color: 'var(--whale)',
                              border: '1px solid rgba(112,86,255,.3)',
                            }}>🐋 {code}</span>
                          ))}
                        </div>
                      </td>
                      <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)', fontSize: 11 }}>
                        {sh.shares ? `${(sh.shares / 1e9).toFixed(2)}B` : '—'}
                      </td>
                      <td className="td" style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: sh.percentage >= 20 ? 'var(--buy)' : 'var(--sub)' }}>
                        {sh.percentage.toFixed(2)}%
                      </td>
                      <td className="td" style={{ textAlign: 'right' }}>
                        <span style={{
                          fontSize: 9, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                          background: sh.is_controlling ? 'var(--floor-dim)' : 'var(--card-hi)',
                          color: sh.is_controlling ? 'var(--floor)' : 'var(--muted)',
                        }}>{sh.is_controlling ? 'Controller' : 'Strategic'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

      </div>
    </Layout>
  );
};

export default StockDetailPage;
