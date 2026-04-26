import React from 'react';
import type { TopWhaleBroker } from '../types';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface WhaleBrokerListProps {
  brokers: TopWhaleBroker[];
  compact?: boolean;
  maxBrokers?: number;
}

const WhaleBrokerList: React.FC<WhaleBrokerListProps> = ({
  brokers,
  compact = false,
  maxBrokers = 3,
}) => {
  if (!brokers || brokers.length === 0) {
    return (
      <div className="text-xs text-[var(--text-muted)] italic">
        No whale activity
      </div>
    );
  }

  const displayBrokers = brokers.slice(0, maxBrokers);
  const totalLots = displayBrokers.reduce((sum, b) => sum + Math.abs(b.lots), 0);

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {displayBrokers.map((broker) => (
          <div
            key={broker.code}
            className="flex items-center gap-1 px-2 py-1 bg-[var(--whale)]/10 rounded border border-[var(--whale)]/30"
          >
            <span className="text-xs font-semibold text-[var(--whale)]">
              {broker.code}
            </span>
            <span className={`text-xs ${broker.side === 'BUY' ? 'text-[var(--bullish)]' : 'text-[var(--bearish)]'}`}>
              {broker.side === 'BUY' ? '+' : '-'}
              {(Math.abs(broker.lots) / 1000).toFixed(1)}K
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {displayBrokers.map((broker) => {
        const percentage = totalLots > 0 ? (Math.abs(broker.lots) / totalLots) * 100 : 0;
        const isBuy = broker.side === 'BUY';

        return (
          <div key={broker.code} className="flex items-center gap-3">
            {/* Broker code */}
            <div className="w-12 h-8 flex items-center justify-center bg-[var(--whale)]/10 rounded text-sm font-bold text-[var(--whale)] border border-[var(--whale)]/20">
              {broker.code}
            </div>

            {/* Bar chart */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  {isBuy ? 'Buying' : 'Selling'}
                </span>
                <span className="text-xs font-mono text-[var(--text-primary)]">
                  {(Math.abs(broker.lots) / 1000).toFixed(1)}K lots
                </span>
              </div>
              <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden border border-[var(--border-color)]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isBuy ? 'bg-[var(--bullish)]' : 'bg-[var(--bearish)]'
                  }`}
                  style={{ width: `${Math.max(percentage, 10)}%` }}
                />
              </div>
            </div>

            {/* Side indicator */}
            <div className={`flex items-center gap-1 ${isBuy ? 'text-[var(--bullish)]' : 'text-[var(--bearish)]'}`}>
              {isBuy ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WhaleBrokerList;
