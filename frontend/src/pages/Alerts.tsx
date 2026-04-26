import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { alertsApi, type AlertItem } from '../api';
import { useAuth } from '../context/AuthContext';
import { Bell, BellRing, Trash2, RotateCcw, Plus, Play } from 'lucide-react';

const WATCHLIST = ['BUVA','BIPI','VKTR','BUMI','BRMS','ENRG','SUPA','COCO','PTRO','CUAN','IMPC','INDY','MBSS','PSKT','PANI','CBDK','ITMG','INKP','TKIM','BNBR','WIFI','INET','ESSA','BULL'];

const ALERT_TYPES: { value: string; label: string; hint: string; valueLabel?: string; placeholder?: string }[] = [
  { value: 'RETAIL_EXIT_ABOVE',   label: 'Retail exit above',         hint: 'Fires when retail_exit_percent exceeds threshold', valueLabel: 'Threshold (%)', placeholder: '65' },
  { value: 'WHALE_NET_ABOVE',     label: 'Whale net lots above',      hint: 'Fires when whale_net_lots exceeds threshold (accumulation)', valueLabel: 'Lots', placeholder: '50000' },
  { value: 'WHALE_NET_BELOW',     label: 'Whale net lots below',      hint: 'Fires when whale_net_lots drops below threshold (distribution)', valueLabel: 'Lots', placeholder: '-50000' },
  { value: 'FLOOR_DISTANCE_BELOW',label: 'Distance to floor below',   hint: 'Fires when price gets close to bandar floor', valueLabel: 'Distance %', placeholder: '5' },
  { value: 'PRICE_ABOVE',         label: 'Price above',               hint: 'Fires when latest close exceeds threshold', valueLabel: 'Price (Rp)', placeholder: '1500' },
  { value: 'PRICE_BELOW',         label: 'Price below',               hint: 'Fires when latest close drops below threshold', valueLabel: 'Price (Rp)', placeholder: '800' },
  { value: 'SIGNAL_EQUALS',       label: 'Signal equals',             hint: 'Fires when overall_signal matches a value (STRONG_BUY, BUY, etc.)', valueLabel: 'Signal' },
];

const SIGNAL_OPTIONS = ['STRONG_BUY', 'BUY', 'WATCH', 'WAIT', 'SELL', 'STRONG_SELL'];

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const Alerts: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = (user as any)?.is_admin;
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  // Form state
  const [ticker, setTicker]   = useState('BUVA');
  const [type, setType]       = useState('RETAIL_EXIT_ABOVE');
  const [val, setVal]         = useState('');

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const load = async () => {
    setLoading(true);
    try { setAlerts(await alertsApi.list()); }
    catch (e: any) { showToast(`Failed: ${e?.response?.data?.detail || e.message}`); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!val) { showToast('Failed: enter a value'); return; }
    const condition = type === 'SIGNAL_EQUALS' ? { value: val } : { threshold: Number(val) };
    try {
      await alertsApi.create(ticker, type, condition);
      showToast('Alert created');
      setVal('');
      load();
    } catch (e: any) { showToast(`Failed: ${e?.response?.data?.detail || e.message}`); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this alert?')) return;
    try { await alertsApi.remove(id); showToast('Deleted'); load(); }
    catch (e: any) { showToast(`Failed: ${e?.response?.data?.detail || e.message}`); }
  };

  const rearm = async (id: string) => {
    try { await alertsApi.rearm(id); showToast('Re-armed'); load(); }
    catch (e: any) { showToast(`Failed: ${e?.response?.data?.detail || e.message}`); }
  };

  const evaluateNow = async () => {
    try {
      const r = await alertsApi.evaluateNow();
      showToast(`Checked ${r.checked} · Fired ${r.fired}`);
      load();
    } catch (e: any) { showToast(`Failed: ${e?.response?.data?.detail || e.message}`); }
  };

  const fmtCondition = (a: AlertItem) => {
    const c = a.condition || {};
    if (a.alert_type === 'SIGNAL_EQUALS') return `= ${c.value}`;
    return `${c.threshold ?? '—'}`;
  };

  const triggered = alerts.filter(a => a.triggered_at);
  const armed     = alerts.filter(a => !a.triggered_at);

  const currentType = ALERT_TYPES.find(t => t.value === type)!;

  return (
    <Layout subtitle="ALERTS">
      <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>

        {toast && (
          <div style={{
            marginBottom: 16, padding: '11px 16px', borderRadius: 8, fontSize: 12,
            background: toast.startsWith('Failed') ? 'var(--sell-dim)' : 'var(--buy-dim)',
            border: `1px solid ${toast.startsWith('Failed') ? 'var(--sell)' : 'var(--buy)'}`,
            color: toast.startsWith('Failed') ? 'var(--sell)' : 'var(--buy)',
          }}>{toast}</div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>Alerts</h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Conditions evaluated after every weekly sync · {armed.length} armed · {triggered.length} triggered
            </p>
          </div>
          {isAdmin && (
            <button onClick={evaluateNow} style={evalBtn}>
              <Play size={12} /> Evaluate now
            </button>
          )}
        </div>

        {/* Create form */}
        <section style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>New alert</div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 200px auto', gap: 10, alignItems: 'center' }}>
            <select value={ticker} onChange={e => setTicker(e.target.value)} style={input}>
              {WATCHLIST.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={type} onChange={e => { setType(e.target.value); setVal(''); }} style={input}>
              {ALERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {type === 'SIGNAL_EQUALS' ? (
              <select value={val} onChange={e => setVal(e.target.value)} style={input}>
                <option value="">— select signal —</option>
                {SIGNAL_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input
                type="number"
                placeholder={currentType.placeholder}
                value={val}
                onChange={e => setVal(e.target.value)}
                style={input}
              />
            )}
            <button onClick={create} style={primaryBtn}>
              <Plus size={13} /> Add
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{currentType.hint}</div>
        </section>

        {/* Triggered */}
        {triggered.length > 0 && (
          <Section title="Triggered" icon={<BellRing size={14} />} accent="var(--buy)">
            {triggered.map(a => (
              <AlertRow key={a.id} a={a} fmtCondition={fmtCondition} onRemove={remove} onRearm={rearm} />
            ))}
          </Section>
        )}

        {/* Armed */}
        <Section title="Armed" icon={<Bell size={14} />} accent="var(--sub)">
          {loading ? (
            <div style={{ color: 'var(--muted)', padding: 20 }}>Loading…</div>
          ) : armed.length === 0 ? (
            <div style={{ color: 'var(--muted)', padding: 20 }}>No armed alerts. Create one above.</div>
          ) : (
            armed.map(a => (
              <AlertRow key={a.id} a={a} fmtCondition={fmtCondition} onRemove={remove} onRearm={rearm} />
            ))
          )}
        </Section>
      </div>
    </Layout>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; icon: React.ReactNode; accent: string; children: React.ReactNode }> = ({ title, icon, accent, children }) => (
  <section style={{ marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 11, fontWeight: 700, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      {icon} {title}
    </div>
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {children}
    </div>
  </section>
);

const AlertRow: React.FC<{ a: AlertItem; fmtCondition: (a: AlertItem) => string; onRemove: (id: string) => void; onRearm: (id: string) => void }> = ({ a, fmtCondition, onRemove, onRearm }) => {
  const fired = !!a.triggered_at;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '80px 1fr 100px 180px auto',
      gap: 12, alignItems: 'center',
      padding: '12px 16px', borderBottom: '1px solid var(--border)',
      background: fired ? 'var(--buy-dim)' : 'transparent',
    }}>
      <span style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--text)' }}>{a.ticker}</span>
      <span style={{ fontSize: 12, color: 'var(--sub)' }}>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{a.alert_type.replace(/_/g, ' ').toLowerCase()}</span>
        <span style={{ marginLeft: 8, fontFamily: 'monospace', color: 'var(--muted)' }}>{fmtCondition(a)}</span>
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
        background: fired ? 'var(--buy)' : 'var(--surface)',
        color: fired ? '#000' : 'var(--sub)',
        border: '1px solid var(--border)', textAlign: 'center',
      }}>
        {fired ? 'TRIGGERED' : 'ARMED'}
      </span>
      <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)' }}>
        {fired ? `fired ${fmtTime(a.triggered_at)}` : `armed ${fmtTime(a.created_at)}`}
      </span>
      <span style={{ display: 'flex', gap: 6 }}>
        {fired && (
          <button onClick={() => onRearm(a.id)} title="Re-arm" style={iconBtn}>
            <RotateCcw size={13} />
          </button>
        )}
        <button onClick={() => onRemove(a.id)} title="Delete" style={{ ...iconBtn, color: 'var(--sell)' }}>
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  );
};

const input: React.CSSProperties = {
  height: 34, padding: '0 10px', borderRadius: 7,
  background: 'var(--surface)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 12, outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 16px', borderRadius: 8,
  border: '1px solid var(--buy)', background: 'var(--buy-dim)', color: 'var(--buy)',
  fontWeight: 700, fontSize: 12, cursor: 'pointer',
};

const evalBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
  border: '1px solid var(--floor)', background: 'var(--floor-dim)', color: 'var(--floor)',
  fontWeight: 700, fontSize: 12, cursor: 'pointer',
};

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--sub)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export default Alerts;
