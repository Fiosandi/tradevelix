/** Indonesian-locale formatting helpers — used everywhere in the UI. */

export const fmtIdr = (v: number | string | null | undefined): string => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6)  return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3)  return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('id-ID');
};

export const fmtLot = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('id-ID');
};

export const fmtPct = (v: number | string | null | undefined, digits = 1): string => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

export const fmtPrice = (v: number | string | null | undefined): string => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (n == null || !Number.isFinite(n)) return '—';
  return `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
};

/** dd MMM yy */
export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

/** dd MMM yy HH:mm */
export const fmtTs = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

export type SignalTone = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'WAIT' | 'SELL' | 'STRONG_SELL';

/** Tailwind classes for the signal pill — uses our @theme tokens. */
export const signalClasses = (s: string | null | undefined) => {
  switch (s) {
    case 'STRONG_BUY':  return 'bg-buy text-bg';
    case 'BUY':         return 'bg-buy-dim text-buy';
    case 'WATCH':       return 'bg-watch-dim text-watch';
    case 'WAIT':        return 'bg-wait-dim text-sub';
    case 'SELL':        return 'bg-sell-dim text-sell';
    case 'STRONG_SELL': return 'bg-sell text-bg';
    default:            return 'bg-wait-dim text-sub';
  }
};
