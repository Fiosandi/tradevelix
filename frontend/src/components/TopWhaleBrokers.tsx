import React from 'react';
import type { TopWhaleBroker } from '../types';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface TopWhaleBrokersProps {
  brokers: TopWhaleBroker[];
  compact?: boolean;
}

const TopWhaleBrokers: React.FC<TopWhaleBrokersProps> = ({ brokers, compact = false }) => {
  if (!brokers || brokers.length === 0) {
    return <span className="text-[var(--text-muted)] text-sm">No data</span>;
  }

  const formatValue = (value: number): string => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}B`;
    } else if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    } else if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toString();
  };

  const formatLots = (lots: number): string => {
    const absLots = Math.abs(lots);
    if (absLots >= 1_000_000) {
      return `${(absLots / 1_000_000).toFixed(1)}M`;
    } else if (absLots >= 1_000) {
      return `${(absLots / 1_000).toFixed(1)}K`;
    }
    return absLots.toLocaleString();
  };

  if (compact) {
    return (
      <div className="flex flex-col gap-1">
        {brokers.slice(0, 3).map((broker, index) => (
          <div key={index} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-[var(--whale)]">{broker.code}</span>
              {broker.side === 'BUY' ? (
                <ArrowUpRight className="w-3 h-3 text-[var(--bullish)]" />
              ) : (
                <ArrowDownRight className="w-3 h-3 text-[var(--bearish)]" />
              )}
            </div>
            <span className={`${broker.side === 'BUY' ? 'text-[var(--bullish)]' : 'text-[var(--bearish)]'}`}>
              {formatLots(broker.lots)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-color)]">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Top Whale Brokers</h3>
      <div className="space-y-3">
        {brokers.slice(0, 3).map((broker, index) => (
          <div key={index} className="flex items-center justify-between p-2 bg-[var(--bg-tertiary)]/50 rounded border border-[var(--border-color)]">
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-[var(--whale)] text-lg">{broker.code}</span>
              <div className={`flex items-center gap-1 ${broker.side === 'BUY' ? 'text-[var(--bullish)]' : 'text-[var(--bearish)]'}`}>
                {broker.side === 'BUY' ? (
                  <ArrowUpRight className="w-4 h-4" />
                ) : (
                  <ArrowDownRight className="w-4 h-4" />
                )}
                <span className="font-medium">{broker.side}</span>
              </div>
            </div>
            <div className="text-right">
              <div className={`font-mono font-bold ${broker.side === 'BUY' ? 'text-[var(--bullish)]' : 'text-[var(--bearish)]'}`}>
                {formatLots(broker.lots)} lots
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                Rp {formatValue(broker.value)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TopWhaleBrokers;
