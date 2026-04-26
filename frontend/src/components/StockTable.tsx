import React, { useState, useMemo } from 'react';
import type { LeaderboardEntry, SignalType } from '../types';
import SignalBadge from './SignalBadge';
import PriceDisplay from './PriceDisplay';
import FloorPriceIndicator from './FloorPriceIndicator';
import WhaleBrokerList from './WhaleBrokerList';
import { ChevronDown, ChevronUp, ArrowUpDown, TrendingUp } from 'lucide-react';

type SortField = 'ticker' | 'price' | 'signal' | 'change' | 'floor' | 'whale_net' | 'retail_exit';
type SortDirection = 'asc' | 'desc';

interface StockTableProps {
  entries: LeaderboardEntry[];
  onStockClick?: (ticker: string) => void;
}

const StockTable: React.FC<StockTableProps> = ({
  entries,
  onStockClick,
}) => {
  const [sortField, setSortField] = useState<SortField>('signal');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedEntries = useMemo(() => {
    const signalOrder: Record<SignalType, number> = {
      STRONG_BUY: 0,
      BUY: 1,
      WATCH: 2,
      WAIT: 3,
      SELL: 4,
      STRONG_SELL: 5,
    };

    return [...entries].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'ticker':
          comparison = a.ticker.localeCompare(b.ticker);
          break;
        case 'price':
          comparison = (Number(a.current_price) || 0) - (Number(b.current_price) || 0);
          break;
        case 'signal':
          comparison = signalOrder[a.overall_signal] - signalOrder[b.overall_signal];
          if (comparison === 0) {
            comparison = b.confidence_score - a.confidence_score;
          }
          break;
        case 'floor':
          comparison = (Number(a.distance_to_floor_pct) || 0) - (Number(b.distance_to_floor_pct) || 0);
          break;
        case 'whale_net':
          comparison = a.whale_net_lots - b.whale_net_lots;
          break;
        case 'retail_exit':
          comparison = (Number(a.retail_exit_percent) || 0) - (Number(b.retail_exit_percent) || 0);
          break;
        default:
          comparison = 0;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [entries, sortField, sortDirection]);

  const toggleRow = (ticker: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(ticker)) {
      newExpanded.delete(ticker);
    } else {
      newExpanded.add(ticker);
    }
    setExpandedRows(newExpanded);
  };

  const formatNumber = (num: number | string | undefined): string => {
    if (num === undefined || num === null) return '-';
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (Math.abs(n) >= 1_000_000) {
      return `${(n / 1_000_000).toFixed(1)}M`;
    } else if (Math.abs(n) >= 1_000) {
      return `${(n / 1_000).toFixed(1)}K`;
    }
    return n.toLocaleString();
  };

  const SortHeader: React.FC<{ field: SortField; label: string; align?: 'left' | 'right' }> = ({
    field,
    label,
    align = 'left',
  }) => (
    <th
      className={`px-4 py-3 text-${align} text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-primary)] transition-colors group`}
      onClick={() => handleSort(field)}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <ArrowUpDown
          size={14}
          className={`opacity-0 group-hover:opacity-50 transition-opacity ${
            sortField === field ? 'opacity-100' : ''
          }`}
        />
      </div>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-[var(--bg-tertiary)]/50 border-b border-[var(--border-color)]">
            <SortHeader field="ticker" label="Stock" />
            <SortHeader field="signal" label="Signal" />
            <SortHeader field="price" label="Price" align="right" />
            <SortHeader field="floor" label="Floor Distance" align="right" />
            <SortHeader field="whale_net" label="Whale Net" align="right" />
            <SortHeader field="retail_exit" label="Retail Exit" align="right" />
            <th className="px-4 py-3 text-center text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              Details
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-color)]">
          {sortedEntries.map((entry) => {
            const isExpanded = expandedRows.has(entry.ticker);
            const isPositiveWhale = entry.whale_net_lots > 0;

            return (
              <React.Fragment key={entry.ticker}>
                <tr
                  className="hover:bg-[var(--bg-tertiary)]/50 transition-colors cursor-pointer group"
                  onClick={() => onStockClick?.(entry.ticker)}
                >
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--whale)]/10 flex items-center justify-center border border-[var(--whale)]/20">
                        <span className="text-sm font-bold text-[var(--whale)]">{entry.ticker.slice(0, 2)}</span>
                      </div>
                      <div>
                        <div className="font-bold text-[var(--text-primary)]">{entry.ticker}</div>
                        <div className="text-xs text-[var(--text-muted)] line-clamp-1 max-w-[120px]">{entry.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <SignalBadge
                      signal={entry.overall_signal}
                      confidence={entry.confidence_score}
                      size="sm"
                    />
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    <PriceDisplay
                      price={entry.current_price}
                      size="sm"
                      showCurrency={false}
                    />
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className={`font-mono text-sm ${
                        Number(entry.distance_to_floor_pct) < 2 
                          ? 'text-[var(--watch)]' 
                          : Number(entry.distance_to_floor_pct) <= 10 
                            ? 'text-[var(--bullish)]' 
                            : 'text-[var(--neutral)]'
                      }`}>
                        {Number(entry.distance_to_floor_pct).toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    <div className={`font-mono font-semibold text-sm ${isPositiveWhale ? 'text-[var(--bullish)]' : 'text-[var(--bearish)]'}`}>
                      {isPositiveWhale ? '+' : ''}{formatNumber(entry.whale_net_lots)}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right">
                    <div className={`font-mono text-sm ${
                      Number(entry.retail_exit_percent) >= 50 ? 'text-[var(--bullish)]' : 'text-[var(--text-secondary)]'
                    }`}>
                      {Number(entry.retail_exit_percent).toFixed(1)}%
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRow(entry.ticker);
                      }}
                      className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-[var(--bg-tertiary)]/30">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Floor Price Section */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                            <TrendingUp size={16} className="text-[var(--floor)]" />
                            Floor Price Analysis
                          </h4>
                          <FloorPriceIndicator
                            currentPrice={entry.current_price}
                            floorPrice={entry.Bandar_floor_price}
                            distanceToFloor={entry.distance_to_floor_pct}
                          />
                        </div>

                        {/* Whale Brokers Section */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
                            <TrendingUp size={16} className="text-[var(--whale)]" />
                            Top Whale Brokers
                          </h4>
                          <WhaleBrokerList brokers={entry.top_whale_brokers} />
                        </div>

                        {/* Additional Metrics */}
                        <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-color)]">
                            <div className="text-xs text-[var(--text-muted)] mb-1">VPA Signal</div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">{entry.vpa_signal}</div>
                          </div>
                          <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-color)]">
                            <div className="text-xs text-[var(--text-muted)] mb-1">Kekompakan</div>
                            <div className="text-sm font-medium text-[var(--whale)]">
                              {Number(entry.kekompakan_score).toFixed(1)}
                            </div>
                          </div>
                          <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-color)]">
                            <div className="text-xs text-[var(--text-muted)] mb-1">Accumulation Score</div>
                            <div className="text-sm font-medium text-[var(--bullish)]">
                              {Number(entry.api_accumulation_score).toFixed(1)}
                            </div>
                          </div>
                          <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-color)]">
                            <div className="text-xs text-[var(--text-muted)] mb-1">Whale Value</div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">
                              Rp {formatNumber(entry.whale_net_value)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default StockTable;
