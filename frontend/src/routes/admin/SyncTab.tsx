import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Play } from 'lucide-react';
import { adminApi } from '../../api';
import { fmtTs } from '../../lib/fmt';

const triggers = [
  { type: 'daily',          label: 'Daily (OHLCV)',           hint: '~24 calls' },
  { type: 'weekly',         label: 'Weekly (broker + calc)',  hint: '~140 calls' },
  { type: 'broker-summary', label: 'Broker summary YTD',      hint: 'Stockbit, ~24 reqs' },
  { type: 'calculate',      label: 'Re-run calculations',     hint: 'no API calls' },
  { type: 'major-holders',  label: 'Major holders (5%+)',     hint: '~19 calls' },
];

export const SyncTab: React.FC<{ toast: (msg: string) => void }> = ({ toast }) => {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setStatus(await adminApi.getSyncStatus()); } catch { /* silent */ }
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  const fire = async (type: string) => {
    setBusy(type);
    try { await adminApi.triggerSync(type); toast(`${type} triggered`); load(); }
    catch (e: any) { toast(`Failed: ${e?.response?.data?.detail || e.message}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-bold text-base mb-3">Manual triggers</h2>
        <div className="flex flex-col gap-2">
          {triggers.map(t => (
            <button
              key={t.type}
              onClick={() => fire(t.type)}
              disabled={busy === t.type}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface border border-border hover:border-floor disabled:opacity-50 text-sm"
            >
              <span className="flex items-center gap-2">
                {busy === t.type ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="text-buy" />}
                {t.label}
              </span>
              <span className="text-[10px] text-muted">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-bold text-base mb-3">Status</h2>
        {!status ? <div className="text-sub text-sm">Loading…</div> : (
          <div className="text-xs text-sub space-y-1.5">
            <div>Last daily: <span className="text-text">{fmtTs(status.last_daily_sync)}</span></div>
            <div>Last weekly: <span className="text-text">{fmtTs(status.last_weekly_sync)}</span></div>
            {status.api_usage && (
              <>
                <div className="border-t border-border my-2" />
                <div>Monthly API: <span className="text-text">{status.api_usage.monthly_calls_used} / {status.api_usage.monthly_limit}</span></div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
