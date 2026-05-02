import React, { useState, useEffect, useCallback, useRef } from 'react';
import { adminApi, dashboardApi } from '../api';
import { Layout } from '../components/Layout';
import { RefreshCw, Play, Database, Activity, Key, Clock, Users, Settings, Shield, Terminal, X, Trash2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SyncLog {
  id: string; sync_type: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'PENDING';
  started_at: string; completed_at?: string;
  records_synced: number; api_calls_used: number; error_message?: string;
}
interface ApiKeyUsage {
  key_index: number; key_preview: string;
  calls_used: number; calls_limit: number; calls_remaining: number;
  active: boolean; last_call_at: string | null; header_observed: boolean;
  flag?: string | null;
  reserved?: boolean;
}
interface SyncStatus {
  recent_syncs: SyncLog[];
  api_usage: {
    monthly_calls_used: number; monthly_limit: number; monthly_remaining: number;
    total_syncs_this_month: number; plan: string;
    per_key?: ApiKeyUsage[];
    active_key?: number;
  };
  last_daily_sync?: string; last_weekly_sync?: string;
}
interface UserStats {
  total: number; active: number; admins: number; paid: number; new_this_week: number;
  recent: { id: string; username: string; email: string; is_active: boolean; is_admin: boolean; is_paid: boolean; created_at: string | null; last_login: string | null }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
};
const statusColor = (s: string) => ({ SUCCESS: 'var(--buy)', PARTIAL: 'var(--watch)', FAILED: 'var(--sell)', PENDING: 'var(--floor)' })[s] ?? 'var(--sub)';
const statusBg    = (s: string) => ({ SUCCESS: 'var(--buy-dim)', PARTIAL: 'var(--watch-dim)', FAILED: 'var(--sell-dim)', PENDING: 'var(--floor-dim)' })[s] ?? 'var(--card)';

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: React.ReactNode; color: string; icon?: React.ReactNode }> = ({ label, value, color, icon }) => (
  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      {icon && <span style={{ color, opacity: 0.7 }}>{icon}</span>}
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
    </div>
    <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color }}>{value}</div>
  </div>
);

const SyncCard: React.FC<{
  label: string; description: string; callsEst: string; color?: string;
  running: boolean; onRun: () => void; children?: React.ReactNode;
}> = ({ label, description, callsEst, color = 'var(--buy)', running, onRun, children }) => (
  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--sub)', lineHeight: 1.5 }}>{description}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>~{callsEst} API calls</div>
    </div>
    {children}
    <button onClick={onRun} disabled={running} style={{
      alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 16px', borderRadius: 8, fontWeight: 700, fontSize: 12,
      border: `1px solid ${color}40`, background: `${color}15`, color,
      cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.7 : 1,
    }}>
      {running ? <><RefreshCw size={13} className="spin" /> Running...</> : <><Play size={13} /> Run</>}
    </button>
  </div>
);

// ─── Tab 1: Members ───────────────────────────────────────────────────────────

const MembersTab: React.FC<{ userStats: UserStats | null; toast: (msg: string) => void; reload: () => void }> = ({ userStats, toast, reload }) => {
  if (!userStats) return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <StatCard label="Total Registered" value={userStats.total}         color="var(--text)"   icon={<Users size={14} />} />
        <StatCard label="Active"            value={userStats.active}        color="var(--buy)"    icon={<Activity size={14} />} />
        <StatCard label="New This Week"     value={userStats.new_this_week} color="#22d3ee"       icon={<Users size={14} />} />
        <StatCard label="Admins"            value={userStats.admins}        color="var(--floor)"  icon={<Shield size={14} />} />
        <StatCard label="Paid"              value={userStats.paid}          color="var(--watch)"  icon={<Key size={14} />} />
      </div>

      {/* User table */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={14} style={{ color: 'var(--floor)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>All Users</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{userStats.recent.length} most recent</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--surface)' }}>
                {['Username', 'Email', 'Registered', 'Last Login', 'Role', 'Paid Access'].map(h => (
                  <th key={h} style={{
                    padding: '10px 16px', textAlign: 'left',
                    fontSize: 9, fontWeight: 700, color: 'var(--muted)',
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    borderBottom: '1px solid var(--border)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {userStats.recent.map((u, i) => (
                <tr key={u.id}
                  style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--card-hi)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-hi)')}
                  onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--card-hi)')}
                >
                  <td style={{ padding: '10px 16px', fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>{u.username}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--sub)' }}>{u.email}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: 11 }}>{u.created_at ? u.created_at.slice(0, 10) : '—'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: 11 }}>{u.last_login ? u.last_login.slice(0, 10) : '—'}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{
                      fontSize: 9, padding: '3px 8px', borderRadius: 100, fontWeight: 700,
                      background: u.is_admin ? 'var(--floor-dim)' : u.is_active ? 'var(--buy-dim)' : 'var(--sell-dim)',
                      color:      u.is_admin ? 'var(--floor)'     : u.is_active ? 'var(--buy)'     : 'var(--sell)',
                    }}>{u.is_admin ? '⚡ Admin' : u.is_active ? '● Active' : '○ Inactive'}</span>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <button
                      onClick={async () => {
                        try {
                          await (dashboardApi as any).toggleUserPaid(u.id);
                          toast(`${u.username} — paid access ${u.is_paid ? 'removed' : 'granted'}`);
                          reload();
                        } catch { toast('Failed to update'); }
                      }}
                      style={{
                        fontSize: 10, padding: '4px 10px', borderRadius: 100, fontWeight: 700,
                        cursor: 'pointer', border: 'none', transition: 'all 0.1s',
                        background: u.is_paid ? 'var(--watch-dim)' : 'var(--card-hi)',
                        color:      u.is_paid ? 'var(--watch)'     : 'var(--muted)',
                      }}
                    >{u.is_paid ? '★ Paid' : '○ Free'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Tab 2: System ────────────────────────────────────────────────────────────

const SystemTab: React.FC<{
  status: SyncStatus | null; loading: boolean;
  running: string; setRunning: (s: string) => void;
  toast: (msg: string) => void; reload: () => void;
}> = ({ status, loading, running, setRunning, toast, reload }) => {
  const usage = status?.api_usage;
  const totalPct = usage ? Math.min((usage.monthly_calls_used / (usage.monthly_limit || 2700)) * 100, 100) : 0;
  const budgetColor = totalPct > 80 ? 'var(--sell)' : totalPct > 60 ? 'var(--watch)' : 'var(--buy)';

  const run = async (endpoint: string, label: string) => {
    setRunning(endpoint);
    try {
      await adminApi.triggerSync(endpoint);
      toast(`${label} started — check logs below`);
      setTimeout(reload, 3000);
    } catch (e: any) {
      toast(`Failed: ${e?.response?.data?.detail || e.message}`);
    } finally { setRunning(''); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* API metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="API Calls This Month"  value={usage?.monthly_calls_used?.toLocaleString() ?? '—'} color={budgetColor}       icon={<Key size={14} />} />
        <StatCard label="Budget Remaining"       value={usage?.monthly_remaining?.toLocaleString()  ?? '—'} color={budgetColor}       icon={<Database size={14} />} />
        <StatCard label="Syncs This Month"       value={usage?.total_syncs_this_month?.toString()   ?? '—'} color="var(--whale)"     icon={<Activity size={14} />} />
        <StatCard label="Last Daily Sync"        value={status?.last_daily_sync ? fmtTime(status.last_daily_sync).split(',')[0] : '—'} color="var(--floor)" icon={<Clock size={14} />} />
      </div>

      {/* Budget bar */}
      {usage && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--sub)', fontWeight: 600 }}>Monthly API Budget</span>
            <span style={{ color: budgetColor, fontWeight: 700, fontFamily: 'monospace' }}>
              {usage.monthly_calls_used} / {usage.monthly_limit} calls · {(100 - totalPct).toFixed(0)}% remaining
            </span>
          </div>
          <div style={{ height: 10, background: 'var(--border)', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${totalPct}%`, background: budgetColor, borderRadius: 5, transition: 'width 0.5s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
            <span>0</span>
            <span>{(usage.per_key?.length || 3)} keys · {usage.monthly_limit.toLocaleString()} calls / month</span>
            <span>{usage.monthly_limit.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Per-key breakdown */}
      {usage?.per_key && usage.per_key.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sub)' }}>Per-Key Usage</span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              From RapidAPI <code style={{ fontFamily: 'monospace', background: 'var(--surface)', padding: '1px 5px', borderRadius: 3 }}>X-RateLimit-Requests-Remaining</code> headers
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {usage.per_key.map(k => {
              const pct  = k.calls_limit > 0 ? Math.min((k.calls_used / k.calls_limit) * 100, 100) : 0;
              const col  = pct > 80 ? 'var(--sell)' : pct > 60 ? 'var(--watch)' : 'var(--buy)';
              return (
                <div key={k.key_index}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        background: k.active ? 'var(--buy-dim)' : 'var(--surface)',
                        color: k.active ? 'var(--buy)' : 'var(--sub)', border: '1px solid var(--border)',
                      }}>KEY #{k.key_index}{k.active ? ' · ACTIVE' : ''}</span>
                      <code style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>{k.key_preview}</code>
                      {k.reserved && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                          background: 'var(--watch-dim)', color: 'var(--watch)', border: '1px solid var(--watch)40',
                        }} title="Reserved — only used when other keys are exhausted">RESERVED</span>
                      )}
                      {k.flag && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                          background: 'var(--sell-dim)', color: 'var(--sell)', border: '1px solid var(--sell)40',
                        }} title={`Flagged: ${k.flag}`}>{k.flag.toUpperCase()}</span>
                      )}
                      {!k.header_observed && (
                        <span style={{ fontSize: 9, color: 'var(--muted)', fontStyle: 'italic' }}>(no calls yet — header not observed)</span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: col, fontWeight: 700 }}>
                      {k.calls_used.toLocaleString()} / {k.calls_limit.toLocaleString()} · {k.calls_remaining.toLocaleString()} left
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${pct}%`, background: col, borderRadius: 3,
                      transition: 'width 0.5s',
                    }} />
                  </div>
                  {k.last_call_at && (
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3, fontFamily: 'monospace' }}>
                      last call: {fmtTime(k.last_call_at)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sync cards grid */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
          Sync Controls
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          <SyncCard label="Daily Sync" callsEst="24" color="var(--buy)"
            description="Fetch OHLCV prices for all 24 stocks + movers. Runs automatically at 18:00 WIB."
            running={running === 'daily'} onRun={() => run('daily', 'Daily Sync')} />
          <SyncCard label="Weekly Sync" callsEst="90+" color="var(--whale)"
            description="Full weekly package: broker summaries + API signals + Three Doors calculations. Auto Saturday 10:00 WIB."
            running={running === 'weekly'} onRun={() => run('weekly', 'Weekly Sync')} />
          <SyncCard label="Recalculate" callsEst="0" color="#22d3ee"
            description="Re-run Three Doors calculations using existing data. Regenerates signals. No API calls."
            running={running === 'calculate'} onRun={() => run('calculate', 'Recalculate')} />
          <SyncCard label="Broker Codes" callsEst="1" color="var(--floor)"
            description="Refresh master list of all IDX broker codes and names."
            running={running === 'broker-codes'} onRun={() => run('broker-codes', 'Broker Codes')} />
          <SyncCard label="Stock Info" callsEst="24" color="var(--floor)"
            description="Refresh company names, sectors and metadata for all 24 watchlist stocks."
            running={running === 'stock-info'} onRun={() => run('stock-info', 'Stock Info')} />
          <SyncCard label="Major Holders" callsEst="24" color="var(--floor)"
            description="Sync 5%+ ownership disclosures from IDX/KSEI for all stocks."
            running={running === 'major_holders'} onRun={() => run('major-holders', 'Major Holders')} />

          {/* Price history backfill */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>Price History Backfill</div>
            <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 10, lineHeight: 1.5 }}>
              Fetch OHLCV history for all 24 stocks. 24 API calls regardless of days selected.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[{ label: '120 days', days: 120, color: 'var(--buy)' }, { label: '252 days', days: 252, color: 'var(--watch)' }].map(opt => (
                <button key={opt.days}
                  onClick={async () => {
                    setRunning(`history_${opt.days}`);
                    try {
                      const r = await adminApi.triggerPriceHistory(opt.days);
                      toast(r.message || `Price history ${opt.days}d started`);
                      setTimeout(reload, 3000);
                    } catch (e: any) { toast(`Failed: ${e?.response?.data?.detail || e.message}`); }
                    finally { setRunning(''); }
                  }}
                  disabled={running === `history_${opt.days}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8,
                    border: `1px solid ${opt.color}40`, background: `${opt.color}15`, color: opt.color,
                    cursor: running === `history_${opt.days}` ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12,
                  }}>
                  {running === `history_${opt.days}` ? <><RefreshCw size={12} className="spin" /> Running...</> : <><Play size={12} /> {opt.label}</>}
                </button>
              ))}
            </div>
          </div>

          {/* Broker history backfill */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>Broker History Backfill</div>
            <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 10, lineHeight: 1.5 }}>
              Fetch weekly broker summaries for past N weeks. Required for Inventory chart broker lines.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[{ label: '4 weeks', weeks: 4, color: 'var(--buy)' }, { label: '12 weeks', weeks: 12, color: 'var(--watch)' }].map(opt => (
                <button key={opt.weeks}
                  onClick={async () => {
                    setRunning(`broker_history_${opt.weeks}`);
                    try {
                      const r = await adminApi.triggerSync(`broker-history?weeks=${opt.weeks}`);
                      toast(r.message || `Broker history ${opt.weeks}w started`);
                      setTimeout(reload, 3000);
                    } catch (e: any) { toast(`Failed: ${e?.response?.data?.detail || e.message}`); }
                    finally { setRunning(''); }
                  }}
                  disabled={running === `broker_history_${opt.weeks}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8,
                    border: `1px solid ${opt.color}40`, background: `${opt.color}15`, color: opt.color,
                    cursor: running === `broker_history_${opt.weeks}` ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12,
                  }}>
                  {running === `broker_history_${opt.weeks}` ? <><RefreshCw size={12} className="spin" /> Running...</> : <><Play size={12} /> {opt.label}</>}
                </button>
              ))}
            </div>
          </div>

          {/* KSEI Ownership PDF upload */}
          <KseiUploadCard toast={toast} openTerminal={() => setRunning('ksei_upload')} />

          {/* Stockbit Session — Phase 2 broker scraper */}
          <StockbitSessionCard toast={toast} />
        </div>
      </div>

      {/* Sync logs */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Recent Sync Logs</span>
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--muted)' }}>
            <span>Scheduler: Daily 18:00 WIB · Sat 10:00 WIB</span>
          </div>
        </div>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--surface)' }}>
                {['Type', 'Status', 'Records', 'API Calls', 'Started', 'Duration'].map((h, i) => (
                  <th key={h} style={{
                    padding: '10px 16px', textAlign: i >= 2 ? 'right' : 'left',
                    fontSize: 9, fontWeight: 700, color: 'var(--muted)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    borderBottom: '1px solid var(--border)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>Loading...</td></tr>
              ) : !status?.recent_syncs?.length ? (
                <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>No sync logs</td></tr>
              ) : status.recent_syncs.slice(0, 20).map((log, i) => {
                const dur = log.completed_at
                  ? (() => { const ms = new Date(log.completed_at!).getTime() - new Date(log.started_at).getTime(); return ms < 60000 ? `${(ms/1000).toFixed(0)}s` : `${(ms/60000).toFixed(1)}m`; })()
                  : '—';
                return (
                  <tr key={log.id || i} style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--card-hi)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '9px 16px', fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace', fontSize: 11 }}>{log.sync_type}</td>
                    <td style={{ padding: '9px 16px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: statusColor(log.status), background: statusBg(log.status) }}>
                        {log.status}
                      </span>
                    </td>
                    <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>{log.records_synced?.toLocaleString() ?? '—'}</td>
                    <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{log.api_calls_used?.toLocaleString() ?? '—'}</td>
                    <td style={{ padding: '9px 16px', textAlign: 'right', color: 'var(--sub)', fontSize: 11 }}>{fmtTime(log.started_at)}</td>
                    <td style={{ padding: '9px 16px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--sub)' }}>{dur}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Live Terminal (SSE) ─────────────────────────────────────────────────────

interface SyncEvent {
  ts: string;
  type: 'hello' | 'sync_start' | 'sync_complete' | 'api_request' | 'api_response' | 'api_error' | 'key_event'
      | 'ksei_upload_start' | 'ksei_parse_progress' | 'ksei_upload_complete';
  sync_type?: string;
  endpoint?: string;
  params?: Record<string, any>;
  ticker?: string | null;
  key_index?: number;
  status?: number | string;
  remaining?: number | null;
  limit?: number | null;
  used?: number | null;
  size?: string;
  retried?: boolean;
  action?: string;
  reason?: string;
  message?: string;
  subscribers?: number;
  // KSEI fields
  file_name?: string;
  snapshot_month?: string;
  size_kb?: number;
  phase?: string;
  rows?: number;
  ownership_rows?: number;
  sid_rows?: number;
  unknown?: number;
}

const fmtTs = (iso?: string) => {
  if (!iso) return new Date().toLocaleTimeString('en-GB', { hour12: false });
  const d = new Date(iso);
  if (isNaN(d.getTime())) return new Date().toLocaleTimeString('en-GB', { hour12: false });
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
};

const renderEventLine = (e: SyncEvent): { color: string; text: React.ReactNode } => {
  const t = fmtTs(e.ts);
  const tickerTag = e.ticker ? ` ${e.ticker}` : '';
  const keyTag = e.key_index ? ` key#${e.key_index}` : '';
  switch (e.type) {
    case 'hello':
      return { color: '#9ca3af', text: <>{t}  · stream connected ({e.subscribers} subscriber{e.subscribers === 1 ? '' : 's'})</> };
    case 'sync_start':
      return { color: '#22d3ee', text: <><b>{t}  ▶ START</b>  {e.sync_type}</> };
    case 'sync_complete':
      if (e.status === 'SUCCESS')
        return { color: '#34d399', text: <><b>{t}  ✓ DONE</b>  {e.sync_type}</> };
      return { color: '#f87171', text: <><b>{t}  ✗ FAIL</b>  {e.sync_type} — {e.message}</> };
    case 'api_request': {
      const params = e.params && Object.keys(e.params).length
        ? '  ' + Object.entries(e.params).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ')
        : '';
      return { color: '#9ca3af', text: <>{t}  →  {e.endpoint}{tickerTag}{params}{keyTag}</> };
    }
    case 'api_response': {
      // Prefer used/limit from upstream headers; fall back to remaining for older events.
      const quota = e.used != null && e.limit
        ? ` ${e.used}/${e.limit}`
        : e.remaining != null ? `, ${e.remaining} left` : '';
      const retry = e.retried ? ' (retry)' : '';
      return { color: '#86efac', text: <>{t}  ←  {e.status}  {e.size}{tickerTag}  key#{e.key_index}{quota}{retry}</> };
    }
    case 'api_error':
      return { color: '#fca5a5', text: <>{t}  ✗  {e.status}  {e.endpoint}{tickerTag}{keyTag}  — {e.message}</> };
    case 'key_event':
      return { color: '#fbbf24', text: <>{t}  🔑  key#{e.key_index} {e.action} ({e.reason})</> };
    case 'ksei_upload_start':
      return { color: '#22d3ee', text: <><b>{t}  ▶ KSEI UPLOAD</b>  {e.file_name} ({e.size_kb} KB) for {e.snapshot_month}</> };
    case 'ksei_parse_progress':
      return { color: '#9ca3af', text: <>{t}  ··  parsed {e.rows} {e.phase === 'ownership_done' ? 'rows (ownership done)' : `rows · ${e.ticker}`}</> };
    case 'ksei_upload_complete':
      if (e.status === 'SUCCESS')
        return { color: '#34d399', text: <><b>{t}  ✓ KSEI DONE</b>  {e.ownership_rows} ownership + {e.sid_rows} SID{e.unknown ? ` (skipped ${e.unknown} unknown tickers)` : ''}</> };
      return { color: '#f87171', text: <><b>{t}  ✗ KSEI FAIL</b>  — {e.message}</> };
    default:
      return { color: '#9ca3af', text: <>{t}  {JSON.stringify(e)}</> };
  }
};

const LiveTerminal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const es = adminApi.openSyncStream();
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = ev => {
      try {
        const data: SyncEvent = JSON.parse(ev.data);
        setEvents(prev => {
          const next = [...prev, data];
          return next.length > 1000 ? next.slice(-1000) : next;
        });
      } catch { /* ignore malformed */ }
    };
    return () => { es.close(); esRef.current = null; setConnected(false); };
  }, [open]);

  useEffect(() => {
    if (autoscroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events, autoscroll]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, width: 'min(720px, 95vw)', height: 360,
      background: '#0a0e14', border: '1px solid #1f2937', borderRadius: 10,
      boxShadow: '0 10px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
      zIndex: 1000, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', background: '#111827', borderBottom: '1px solid #1f2937',
      }}>
        <Terminal size={13} style={{ color: '#34d399' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#e5e7eb', fontFamily: 'monospace' }}>
          live-sync
        </span>
        <span style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 3, fontWeight: 700,
          background: connected ? '#064e3b' : '#7f1d1d', color: connected ? '#34d399' : '#fca5a5',
        }}>{connected ? '● CONNECTED' : '○ OFFLINE'}</span>
        <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', marginLeft: 'auto' }}>
          {events.length} events
        </span>
        <label style={{ fontSize: 10, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoscroll} onChange={e => setAutoscroll(e.target.checked)} style={{ margin: 0 }} />
          autoscroll
        </label>
        <button onClick={() => setEvents([])} title="Clear" style={{
          background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer',
          padding: 2, display: 'flex', alignItems: 'center',
        }}><Trash2 size={12} /></button>
        <button onClick={onClose} title="Close" style={{
          background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer',
          padding: 2, display: 'flex', alignItems: 'center',
        }}><X size={14} /></button>
      </div>
      <div ref={bodyRef} style={{
        flex: 1, overflowY: 'auto', padding: '8px 12px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11, lineHeight: 1.55, color: '#d1d5db',
      }}>
        {events.length === 0 ? (
          <div style={{ color: '#4b5563', fontStyle: 'italic' }}>
            Waiting for events. Trigger a sync above to see live request/response activity.
          </div>
        ) : events.map((e, i) => {
          const r = renderEventLine(e);
          return <div key={i} style={{ color: r.color, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{r.text}</div>;
        })}
      </div>
    </div>
  );
};

// ─── KSEI Upload Card ────────────────────────────────────────────────────────

interface UploadJob {
  id: string;
  file_name: string;
  source: string;
  status: string;
  records_processed: number;
  created_at: string | null;
  error_message: string | null;
}

interface KseiResult {
  kind: 'ok' | 'err';
  ownership_rows?: number;
  sid_rows?: number;
  unknown_tickers?: string[];
  message?: string;
  at: number;
}

// ─── Stockbit Session Card (Phase 2 broker scraper) ─────────────────────────

interface StockbitStatus {
  present: boolean;
  status: string | null;
  last_used_at: string | null;
  note: string | null;
  created_at?: string | null;
  expires_at?: string | null;
}

const StockbitSessionCard: React.FC<{ toast: (msg: string) => void }> = ({ toast }) => {
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
    if (!raw) { toast('Failed: paste your Stockbit bearer token first'); return; }
    // Strip "Bearer " if pasted from a header
    const cleaned = raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : raw;
    if (!cleaned.includes('eyJ')) {
      toast('Failed: token must contain a JWT (starts with eyJ)');
      return;
    }
    setBusy(true);
    try {
      const r = await adminApi.saveStockbitToken(cleaned, note || undefined);
      const exp = r.expires_at ? ` · expires ${fmtTs(r.expires_at)}` : '';
      toast(`Saved Stockbit token${exp}`);
      setPaste('');
      setNote('');
      load();
    } catch (e: any) {
      toast(`Failed: ${e?.response?.data?.detail || e.message}`);
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!confirm('Delete stored Stockbit session?')) return;
    try { await adminApi.deleteStockbitToken(); toast('Stockbit session removed'); load(); }
    catch (e: any) { toast(`Failed: ${e?.response?.data?.detail || e.message}`); }
  };

  const badgeColor =
    status?.status === 'VALID'   ? 'var(--buy)'
    : status?.status === 'EXPIRED' ? 'var(--sell)'
    : status?.present              ? 'var(--watch)'
    : 'var(--muted)';
  const badgeLabel =
    !status?.present       ? 'NOT SET'
    : status.status || 'UNKNOWN';

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Stockbit Session</div>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
          background: `${badgeColor}25`, color: badgeColor, border: `1px solid ${badgeColor}40`,
        }}>{badgeLabel}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 8, lineHeight: 1.5 }}>
        Paste your Stockbit bearer JWT (broker-summary scraper, Phase 2). Encrypted at rest. Token validity is ~24h — re-paste when it expires.
      </div>
      <details style={{ marginBottom: 8 }}>
        <summary style={{ fontSize: 10, color: 'var(--muted)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          How to capture
        </summary>
        <ol style={{ fontSize: 11, color: 'var(--sub)', marginTop: 6, paddingLeft: 18, lineHeight: 1.5 }}>
          <li>Log in to <code>stockbit.com</code> in your browser (handles 2FA).</li>
          <li>Open DevTools → Network tab. Visit any stock page (e.g. <code>stockbit.com/symbol/BBCA</code>).</li>
          <li>Find a request to <code>exodus.stockbit.com</code> and copy the <code>Authorization</code> header value (the long <code>eyJ…</code> string, with or without the <code>Bearer</code> prefix).</li>
          <li>Paste below, hit Save.</li>
        </ol>
      </details>
      {status?.present && (
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', marginBottom: 8 }}>
          last used: {status.last_used_at ? fmtTs(status.last_used_at) : '—'}
          {status.expires_at && <> · expires: {fmtTs(status.expires_at)}</>}
          {status.note && <> · note: {status.note}</>}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          value={paste}
          onChange={e => setPaste(e.target.value)}
          placeholder='eyJhbGciOiJSUzI1NiIs… (paste the full JWT, with or without "Bearer " prefix)'
          rows={4}
          disabled={busy}
          style={{
            padding: '8px 10px', borderRadius: 7, fontSize: 10, fontFamily: 'monospace',
            background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
            resize: 'vertical', minHeight: 60,
          }}
        />
        <input
          type="text"
          placeholder="optional note (e.g. browser/device used)"
          value={note}
          onChange={e => setNote(e.target.value)}
          disabled={busy}
          style={{
            height: 28, padding: '0 10px', borderRadius: 7, fontSize: 11,
            background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={submit}
            disabled={busy || !paste.trim()}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px 13px', borderRadius: 8, fontWeight: 700, fontSize: 12,
              border: '1px solid var(--floor)40', background: 'var(--floor-dim)', color: 'var(--floor)',
              cursor: busy || !paste.trim() ? 'not-allowed' : 'pointer',
              opacity: busy || !paste.trim() ? 0.5 : 1,
            }}>
            {busy ? <><RefreshCw size={12} className="spin" /> Saving…</> : <><Play size={12} /> Save</>}
          </button>
          {status?.present && (
            <button
              onClick={clear}
              disabled={busy}
              style={{
                padding: '8px 13px', borderRadius: 8, fontWeight: 700, fontSize: 12,
                border: '1px solid var(--sell)40', background: 'transparent', color: 'var(--sell)',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const KseiUploadCard: React.FC<{ toast: (msg: string) => void; openTerminal: () => void }> = ({ toast, openTerminal }) => {
  const [file, setFile]       = useState<File | null>(null);
  const [month, setMonth]     = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase]     = useState<'idle' | 'uploading' | 'parsing'>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [result, setResult]   = useState<KseiResult | null>(null);
  const [jobs, setJobs]       = useState<UploadJob[]>([]);

  const loadJobs = useCallback(async () => {
    try { setJobs(await adminApi.getKseiJobs()); } catch { /* silent */ }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const submit = async () => {
    if (!file) { toast('Failed: choose a PDF first'); return; }
    setUploading(true);
    setResult(null);
    setUploadPct(0);
    setPhase('uploading');
    openTerminal();
    try {
      const r = await adminApi.uploadKseiPdf(file, month, pct => {
        setUploadPct(pct);
        if (pct >= 100) setPhase('parsing');
      });
      setResult({
        kind: 'ok',
        ownership_rows: r.ownership_rows,
        sid_rows: r.sid_rows,
        unknown_tickers: r.unknown_tickers || [],
        at: Date.now(),
      });
      toast(`Parsed ${r.ownership_rows} rows + ${r.sid_rows} SID`);
      setFile(null);
      loadJobs();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e.message || 'Upload failed';
      setResult({ kind: 'err', message: msg, at: Date.now() });
      toast(`Failed: ${msg}`);
      loadJobs();
    } finally {
      setUploading(false);
      setPhase('idle');
    }
  };

  const phaseLabel = phase === 'uploading' ? `Uploading… ${uploadPct}%`
                    : phase === 'parsing' ? 'Parsing PDF…'
                    : 'Upload & Parse';

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>KSEI Ownership Upload</div>
      <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 10, lineHeight: 1.5 }}>
        Upload monthly KSEI stockholder PDF. Parser extracts every ≥1% holder + classifies entity type. Powers /ownership page.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="month"
          value={month.slice(0, 7)}
          onChange={e => setMonth(`${e.target.value}-01`)}
          disabled={uploading}
          style={{
            height: 32, padding: '0 10px', borderRadius: 7,
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: 12, fontFamily: 'monospace',
          }}
        />
        <input
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onChange={e => setFile(e.target.files?.[0] || null)}
          style={{ fontSize: 11, color: 'var(--sub)' }}
        />
        <button
          onClick={submit}
          disabled={!file || uploading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 13px', borderRadius: 8,
            border: '1px solid var(--floor)40', background: 'var(--floor-dim)', color: 'var(--floor)',
            cursor: !file || uploading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12,
            opacity: !file || uploading ? 0.5 : 1,
          }}>
          {uploading ? <><RefreshCw size={12} className="spin" /> {phaseLabel}</> : <><Play size={12} /> Upload & Parse</>}
        </button>

        {/* Live upload progress bar */}
        {phase === 'uploading' && (
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${uploadPct}%`, background: 'var(--floor)', transition: 'width 0.15s' }} />
          </div>
        )}
        {phase === 'parsing' && (
          <div style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>
            File uploaded. Server is now parsing — open the terminal to see live progress.
          </div>
        )}

        {/* Persistent inline result block — does NOT auto-clear */}
        {result && (
          <div style={{
            marginTop: 4, padding: '10px 12px', borderRadius: 7, fontSize: 11, lineHeight: 1.5,
            background: result.kind === 'ok' ? 'var(--buy-dim)' : 'var(--sell-dim)',
            border: `1px solid ${result.kind === 'ok' ? 'var(--buy)' : 'var(--sell)'}40`,
            color: result.kind === 'ok' ? 'var(--buy)' : 'var(--sell)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                {result.kind === 'ok' ? (
                  <>
                    <div style={{ fontWeight: 700 }}>✓ Upload complete</div>
                    <div style={{ fontFamily: 'monospace', marginTop: 3, color: 'var(--text)' }}>
                      {result.ownership_rows} ownership rows · {result.sid_rows} SID rows
                    </div>
                    {result.unknown_tickers && result.unknown_tickers.length > 0 && (
                      <div style={{ fontSize: 10, marginTop: 3, color: 'var(--muted)' }}>
                        Skipped {result.unknown_tickers.length} unknown ticker{result.unknown_tickers.length === 1 ? '' : 's'}: {result.unknown_tickers.slice(0, 8).join(', ')}{result.unknown_tickers.length > 8 ? '…' : ''}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700 }}>✗ Upload failed</div>
                    <div style={{ fontSize: 10, marginTop: 3, color: 'var(--text)', wordBreak: 'break-word' }}>
                      {result.message}
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => setResult(null)} style={{
                background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer',
                padding: 0, opacity: 0.6,
              }}><X size={12} /></button>
            </div>
          </div>
        )}

        {/* Recent jobs */}
        {jobs.length > 0 && (
          <details style={{ marginTop: 6 }}>
            <summary style={{
              fontSize: 10, color: 'var(--muted)', cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700,
            }}>Recent uploads ({jobs.length})</summary>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, fontFamily: 'monospace' }}>
              {jobs.slice(0, 5).map(j => {
                const ok = j.status === 'COMPLETED';
                const fail = j.status === 'FAILED';
                const col = ok ? 'var(--buy)' : fail ? 'var(--sell)' : 'var(--watch)';
                return (
                  <div key={j.id} style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--sub)' }}>
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      background: `${col}25`, color: col, minWidth: 60, textAlign: 'center',
                    }}>{j.status}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.file_name}
                    </span>
                    <span style={{ color: 'var(--muted)' }}>{j.records_processed} rows</span>
                    <span style={{ color: 'var(--muted)' }}>{j.created_at ? j.created_at.slice(5, 16).replace('T', ' ') : '—'}</span>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
};


// ─── Admin Page ───────────────────────────────────────────────────────────────

type Tab = 'members' | 'system';

const Admin: React.FC = () => {
  const [tab, setTab]         = useState<Tab>('members');
  const [status, setStatus]   = useState<SyncStatus | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState('');
  const [toast, setToast]     = useState('');
  const [terminalOpen, setTerminalOpen] = useState(false);

  const handleSetRunning = (s: string) => {
    setRunning(s);
    if (s) setTerminalOpen(true);  // any sync trigger opens the terminal
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [d, u] = await Promise.all([
        adminApi.getSyncStatus(),
        (dashboardApi as any).getAdminUsers?.().catch(() => null),
      ]);
      setStatus(d);
      if (u) setUserStats(u);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'members', label: 'Member Management', icon: <Users size={14} /> },
    { id: 'system',  label: 'API & System',      icon: <Settings size={14} /> },
  ];

  return (
    <Layout title="Admin Panel">
      <div style={{ padding: '20px 28px' }}>

        {/* Header + tab nav */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>Admin Panel</h1>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>Tradevelix system management</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setTerminalOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 8, background: terminalOpen ? 'var(--buy-dim)' : 'var(--card)',
                border: `1px solid ${terminalOpen ? 'var(--buy)' : 'var(--border)'}`,
                color: terminalOpen ? 'var(--buy)' : 'var(--sub)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
                <Terminal size={13} /> {terminalOpen ? 'Hide Terminal' : 'Show Terminal'}
              </button>
              <button onClick={load} disabled={loading} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)',
                color: 'var(--sub)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
                <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 18px', borderRadius: 7, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
                background: tab === t.id ? 'var(--floor)' : 'transparent',
                color: tab === t.id ? 'white' : 'var(--sub)',
                transition: 'all 0.15s',
              }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            marginBottom: 16, padding: '11px 16px', borderRadius: 8, fontSize: 12,
            background: toast.startsWith('Failed') ? 'var(--sell-dim)' : 'var(--buy-dim)',
            border: `1px solid ${toast.startsWith('Failed') ? 'var(--sell)' : 'var(--buy)'}`,
            color: toast.startsWith('Failed') ? 'var(--sell)' : 'var(--buy)',
          }}>{toast}</div>
        )}

        {/* Tab content */}
        {tab === 'members' && (
          <MembersTab userStats={userStats} toast={showToast} reload={load} />
        )}
        {tab === 'system' && (
          <SystemTab
            status={status} loading={loading}
            running={running} setRunning={handleSetRunning}
            toast={showToast} reload={load}
          />
        )}
      </div>
      <LiveTerminal open={terminalOpen} onClose={() => setTerminalOpen(false)} />
    </Layout>
  );
};

export default Admin;
