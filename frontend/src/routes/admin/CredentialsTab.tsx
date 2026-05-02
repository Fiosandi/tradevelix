import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Save, Trash2, Terminal } from 'lucide-react';
import { adminApi } from '../../api';
import { fmtTs } from '../../lib/fmt';

interface StockbitStatus {
  present: boolean;
  status: 'VALID' | 'EXPIRED' | string | null;
  last_used_at: string | null;
  note: string | null;
  created_at?: string | null;
  expires_at?: string | null;
}

export const CredentialsTab: React.FC<{ toast: (msg: string) => void }> = ({ toast }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <StockbitCard toast={toast} />
      <LiveLogCard />
    </div>
  );
};

const StockbitCard: React.FC<{ toast: (msg: string) => void }> = ({ toast }) => {
  const [status, setStatus] = useState<StockbitStatus | null>(null);
  const [paste, setPaste]   = useState('');
  const [note, setNote]     = useState('');
  const [busy, setBusy]     = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await adminApi.getStockbitStatus()); } catch { /* silent */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const raw = paste.trim();
    if (!raw) { toast('Paste your Stockbit bearer token first'); return; }
    const cleaned = raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : raw;
    if (!cleaned.includes('eyJ')) { toast('Token must contain a JWT (starts with eyJ)'); return; }

    setBusy(true);
    let saved = false;
    try {
      const r = await adminApi.saveStockbitToken(cleaned, note || undefined);
      saved = true;
      const exp = r.expires_at ? ` · expires ${fmtTs(r.expires_at)}` : '';
      toast(`Saved Stockbit token${exp} — kicking off backfill…`);
      setPaste(''); setNote('');
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.response?.statusText || e?.message || 'unknown error';
      console.error('Stockbit save failed:', e);
      toast(`Failed to save: ${msg}`);
    }
    if (saved) {
      try {
        await adminApi.triggerSync('broker-summary');
        await adminApi.triggerBrokerHistory(20);
        toast('Backfill running: YTD weekly + 5-month history. Watch the live log →');
      } catch (e: any) {
        const msg = e?.response?.data?.detail || e?.message || 'unknown error';
        console.error('Auto-backfill trigger failed:', e);
        toast(`Token saved but backfill failed to start: ${msg}`);
      }
    }
    setBusy(false);
  };

  const clear = async () => {
    if (!confirm('Delete stored Stockbit session?')) return;
    try { await adminApi.deleteStockbitToken(); toast('Stockbit session removed'); load(); }
    catch (e: any) { toast(`Failed: ${e?.response?.data?.detail || e.message}`); }
  };

  const badgeClass =
    status?.status === 'VALID'   ? 'bg-buy-dim   text-buy   border-buy/30'   :
    status?.status === 'EXPIRED' ? 'bg-sell-dim  text-sell  border-sell/30'  :
    status?.present              ? 'bg-watch-dim text-watch border-watch/30' :
                                   'bg-wait-dim  text-sub   border-border';
  const badgeLabel = !status?.present ? 'NOT SET' : (status.status || 'UNKNOWN');

  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-base">Stockbit Session</h2>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      <p className="text-xs text-sub leading-relaxed">
        Paste your Stockbit bearer JWT (broker-summary scraper). Encrypted at rest.
        Saving immediately triggers <span className="text-text font-semibold">YTD weekly broker sync</span> +{' '}
        <span className="text-text font-semibold">5-month history backfill</span>.
      </p>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted uppercase tracking-wider font-bold text-[10px]">
          How to capture
        </summary>
        <ol className="mt-2 pl-5 list-decimal text-sub leading-relaxed space-y-1">
          <li>Log in to <code className="text-floor">stockbit.com</code> in your browser (handles 2FA).</li>
          <li>Open DevTools → Network. Visit any stock page (e.g. <code className="text-floor">stockbit.com/symbol/BBCA</code>).</li>
          <li>Find a request to <code className="text-floor">exodus.stockbit.com</code> and copy the <code className="text-floor">Authorization</code> header value (the long <code className="text-floor">eyJ…</code> string).</li>
          <li>Paste below and Save.</li>
        </ol>
      </details>

      {status?.present && (
        <div className="text-[11px] text-muted font-mono">
          last used: {status.last_used_at ? fmtTs(status.last_used_at) : '—'}
          {status.expires_at && <> · expires: {fmtTs(status.expires_at)}</>}
          {status.note && <> · note: {status.note}</>}
        </div>
      )}

      <textarea
        value={paste}
        onChange={e => setPaste(e.target.value)}
        placeholder='eyJhbGciOiJSUzI1NiIs… (with or without "Bearer " prefix)'
        rows={4}
        disabled={busy}
        className="bg-surface border border-border rounded-lg p-2.5 text-[11px] font-mono resize-y min-h-[80px] focus:border-floor focus:outline-none disabled:opacity-50"
      />

      <input
        type="text"
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="optional note (browser/device used)"
        disabled={busy}
        className="bg-surface border border-border rounded-lg px-3 py-2 text-xs focus:border-floor focus:outline-none disabled:opacity-50"
      />

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !paste.trim()}
          className="flex-1 flex items-center justify-center gap-2 bg-buy-dim text-buy border border-buy/30 rounded-lg py-2 text-sm font-bold hover:bg-buy hover:text-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {busy ? 'Saving…' : 'Save & Backfill'}
        </button>
        {status?.present && (
          <button
            onClick={clear}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-sell/30 text-sell hover:bg-sell-dim disabled:opacity-50"
          >
            <Trash2 size={14} /> Clear
          </button>
        )}
      </div>
    </div>
  );
};

interface LogLine { ts: string; type: string; text: string }

const LiveLogCard: React.FC = () => {
  const [lines, setLines]   = useState<LogLine[]>([]);
  const [open, setOpen]     = useState(false);
  const esRef               = useRef<EventSource | null>(null);
  const scrollRef           = useRef<HTMLDivElement>(null);

  const start = () => {
    if (esRef.current) return;
    const es = adminApi.openSyncStream();
    esRef.current = es;
    setOpen(true);
    es.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data);
        const text =
          data.type === 'api_request'  ? `→ ${data.endpoint}${data.ticker ? ` [${data.ticker}]` : ''}` :
          data.type === 'api_response' ? `← ${data.endpoint} ${data.status} ${data.size || ''}` :
          data.type === 'api_error'    ? `✗ ${data.endpoint} ${data.status || ''} ${data.message || ''}` :
          data.type === 'sync_start'   ? `▶ ${data.sync_type} started` :
          data.type === 'sync_done'    ? `✓ ${data.sync_type}: ${data.records_synced} records, ${data.api_calls_used} calls` :
                                          JSON.stringify(data);
        setLines(prev => [...prev.slice(-300), {
          ts: new Date().toISOString(),
          type: data.type || 'event',
          text,
        }]);
      } catch {
        setLines(prev => [...prev.slice(-300), { ts: new Date().toISOString(), type: 'raw', text: ev.data }]);
      }
    };
    es.onerror = () => {
      setLines(prev => [...prev, { ts: new Date().toISOString(), type: 'error', text: 'stream disconnected — click Reconnect' }]);
      es.close();
      esRef.current = null;
      setOpen(false);
    };
  };

  const stop = () => { esRef.current?.close(); esRef.current = null; setOpen(false); };

  useEffect(() => () => { esRef.current?.close(); }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3 min-h-[400px]">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-base flex items-center gap-2"><Terminal size={16} /> Live sync log</h2>
        <div className="flex gap-2">
          {open
            ? <button onClick={stop} className="text-xs text-sell hover:underline">Disconnect</button>
            : <button onClick={start} className="text-xs text-buy hover:underline">Connect</button>}
          {lines.length > 0 && (
            <button onClick={() => setLines([])} className="text-xs text-sub hover:underline">Clear</button>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 bg-bg/50 border border-border rounded-lg p-3 font-mono text-[11px] leading-relaxed overflow-auto max-h-[480px]"
      >
        {lines.length === 0
          ? <div className="text-muted">{open ? 'Waiting for events…' : 'Click Connect to stream sync events.'}</div>
          : lines.map((l, i) => (
              <div key={i} className={`whitespace-pre-wrap ${
                l.type === 'api_error' ? 'text-sell' :
                l.type === 'api_response' ? 'text-buy' :
                l.type === 'api_request'  ? 'text-floor' :
                l.type === 'sync_start' || l.type === 'sync_done' ? 'text-watch' :
                'text-sub'
              }`}>
                <span className="text-muted">{l.ts.slice(11, 19)}</span> {l.text}
              </div>
            ))}
      </div>
    </div>
  );
};
