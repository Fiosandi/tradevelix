import React from 'react';
import type { SignalType } from '../types';

// Simple self-contained badge — no dependency on removed type exports
interface Props {
  signal: SignalType | string;
  confidence?: number;
  size?: 'sm' | 'md';
}

const COLORS: Record<string, { color: string; bg: string }> = {
  STRONG_BUY:  { color: '#34d399', bg: 'rgba(52,211,153,.12)' },
  BUY:         { color: '#34d399', bg: 'rgba(52,211,153,.08)' },
  WATCH:       { color: '#fb923c', bg: 'rgba(251,146,60,.10)' },
  WAIT:        { color: '#64748b', bg: 'rgba(100,116,139,.08)' },
  SELL:        { color: '#fb7185', bg: 'rgba(251,113,133,.10)' },
  STRONG_SELL: { color: '#f43f5e', bg: 'rgba(244,63,94,.12)'  },
};

const SignalBadge: React.FC<Props> = ({ signal, confidence, size = 'md' }) => {
  const c = COLORS[signal] ?? COLORS.WAIT;
  const pad = size === 'sm' ? '2px 8px' : '4px 12px';
  const fs  = size === 'sm' ? 10 : 11;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: pad, borderRadius: 100, fontSize: fs, fontWeight: 700,
      letterSpacing: '0.04em', color: c.color, background: c.bg,
      border: `1px solid ${c.color}40`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.color, display: 'inline-block' }} />
      {String(signal).replace(/_/g, ' ')}
      {confidence != null && confidence > 0 && (
        <span style={{ opacity: 0.7 }}>{confidence}%</span>
      )}
    </span>
  );
};

export default SignalBadge;
