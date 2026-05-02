import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { dashboardApi } from '../api';
import type { LeaderboardEntry, LeaderboardResponse } from '../types';
import { fmtIdr, fmtLot, fmtPct, fmtPrice, fmtDate, signalClasses } from '../lib/fmt';

const SIGNAL_RANK: Record<string, number> = {
  STRONG_BUY: 6, BUY: 5, WATCH: 4, WAIT: 3, SELL: 2, STRONG_SELL: 1,
};

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export const Watchlist: React.FC = () => {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setData(await dashboardApi.getLeaderboard()); }
    catch (e: any) { setErr(e?.response?.data?.detail || e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const sorted = useMemo<LeaderboardEntry[]>(() => {
    if (!data?.entries) return [];
    return [...data.entries].sort((a, b) => {
      const sa = SIGNAL_RANK[a.overall_signal] ?? 0;
      const sb = SIGNAL_RANK[b.overall_signal] ?? 0;
      if (sa !== sb) return sb - sa;
      return num(b.confidence_score) - num(a.confidence_score);
    });
  }, [data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Watchlist</h1>
          <p className="text-xs text-sub mt-0.5">
            {data
              ? <>Week {fmtDate(data.week_start)} → {fmtDate(data.week_end)} · {data.count} stocks</>
              : 'Loading…'}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-xs text-sub hover:text-text border border-border rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      {err && (
        <div className="flex items-center gap-2 bg-sell-dim text-sell text-sm rounded-lg px-3 py-2 border border-sell/30">
          <AlertCircle size={14} /> {err}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-sub">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {data && sorted.length === 0 && !loading && (
        <div className="text-center py-16 text-sub text-sm">
          No data yet. Paste your Stockbit token in <Link to="/admin/credentials" className="text-floor hover:underline">Admin → Credentials</Link> to start the backfill.
        </div>
      )}

      {/* Desktop table */}
      {sorted.length > 0 && (
        <div className="hidden md:block overflow-x-auto bg-card border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide font-semibold text-muted border-b border-border">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Signal</th>
                <th className="px-4 py-3 text-right">Conf</th>
                <th className="px-4 py-3 text-right">Whale Net</th>
                <th className="px-4 py-3 text-right">Retail Exit</th>
                <th className="px-4 py-3 text-right">Floor</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right">Δ Floor</th>
                <th className="px-4 py-3">VPA</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => {
                const whale = num(row.whale_net_lots);
                const retail = num(row.retail_exit_percent);
                const floor = num(row.Bandar_floor_price);
                const price = num(row.current_price);
                const distance = num(row.distance_to_floor_pct);
                return (
                  <tr key={row.ticker} className="border-b border-border last:border-0 hover:bg-card-hi">
                    <td className="px-4 py-3">
                      <Link to={`/s/${row.ticker}`} className="font-bold tracking-tight hover:text-floor">
                        {row.ticker}
                      </Link>
                      <div className="text-[10px] text-muted truncate max-w-[140px]">{row.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-[10px] font-bold px-2 py-1 rounded ${signalClasses(row.overall_signal)}`}>
                        {row.overall_signal.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular text-text">{Math.round(num(row.confidence_score))}</td>
                    <td className={`px-4 py-3 text-right tabular ${whale >= 0 ? 'text-buy' : 'text-sell'}`}>
                      <div className="flex items-center justify-end gap-1">
                        {whale >= 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                        {fmtLot(Math.abs(whale))}
                      </div>
                      <div className="text-[10px] text-muted">{fmtIdr(num(row.whale_net_value))}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular text-watch">{fmtPct(retail)}</td>
                    <td className="px-4 py-3 text-right tabular text-floor">{fmtPrice(floor)}</td>
                    <td className="px-4 py-3 text-right tabular">{fmtPrice(price)}</td>
                    <td className={`px-4 py-3 text-right tabular ${distance >= 0 ? 'text-buy' : 'text-sell'}`}>
                      {fmtPct(distance)}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-sub">{row.vpa_signal || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile cards */}
      {sorted.length > 0 && (
        <div className="md:hidden flex flex-col gap-2">
          {sorted.map(row => {
            const whale = num(row.whale_net_lots);
            const retail = num(row.retail_exit_percent);
            const distance = num(row.distance_to_floor_pct);
            return (
              <Link
                key={row.ticker}
                to={`/s/${row.ticker}`}
                className="bg-card border border-border rounded-xl p-3 active:bg-card-hi"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-bold text-base tracking-tight">{row.ticker}</div>
                    <div className="text-[10px] text-muted truncate">{row.name}</div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded ${signalClasses(row.overall_signal)}`}>
                    {row.overall_signal.replace('_', ' ')}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <div className="text-muted">Whale Net</div>
                    <div className={`font-semibold tabular ${whale >= 0 ? 'text-buy' : 'text-sell'}`}>
                      {whale >= 0 ? '+' : '−'}{fmtLot(Math.abs(whale))}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted">Retail Exit</div>
                    <div className="font-semibold tabular text-watch">{fmtPct(retail)}</div>
                  </div>
                  <div>
                    <div className="text-muted">Δ Floor</div>
                    <div className={`font-semibold tabular ${distance >= 0 ? 'text-buy' : 'text-sell'}`}>
                      {fmtPct(distance)}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
