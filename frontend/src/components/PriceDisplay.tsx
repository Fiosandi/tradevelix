import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

interface PriceDisplayProps {
  price: number | string;
  change?: number | string;
  currency?: string;
  showCurrency?: boolean;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right';
}

const PriceDisplay: React.FC<PriceDisplayProps> = ({
  price,
  change,
  currency = 'Rp',
  showCurrency = true,
  size = 'md',
  align = 'right',
}) => {
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  const numChange = typeof change === 'string' ? parseFloat(change) : change;
  
  const isPositive = numChange !== undefined && numChange > 0;
  const isNegative = numChange !== undefined && numChange < 0;

  const sizeClasses = {
    sm: {
      price: 'text-sm',
      change: 'text-xs',
    },
    md: {
      price: 'text-base',
      change: 'text-sm',
    },
    lg: {
      price: 'text-2xl',
      change: 'text-base',
    },
  };

  const formatPrice = (value: number): string => {
    if (value >= 1_000_000) {
      return `${currency} ${(value / 1_000_000).toFixed(2)}M`;
    } else if (value >= 1_000) {
      return `${currency} ${(value / 1_000).toFixed(1)}K`;
    }
    return `${currency} ${value.toLocaleString('id-ID')}`;
  };

  const formatChange = (value: number): string => {
    const absValue = Math.abs(value);
    const sign = value > 0 ? '+' : '-';
    return `${sign}${absValue.toFixed(2)}%`;
  };

  const getChangeColor = () => {
    if (isPositive) return 'text-[var(--bullish)]';
    if (isNegative) return 'text-[var(--bearish)]';
    return 'text-[var(--text-muted)]';
  };

  const getArrow = () => {
    if (isPositive) return <ArrowUp size={size === 'lg' ? 16 : 12} />;
    if (isNegative) return <ArrowDown size={size === 'lg' ? 16 : 12} />;
    return <Minus size={size === 'lg' ? 16 : 12} />;
  };

  return (
    <div className={`flex flex-col ${align === 'right' ? 'items-end' : 'items-start'}`}>
      <span className={`font-mono font-semibold text-[var(--text-primary)] ${sizeClasses[size].price}`}>
        {showCurrency ? formatPrice(numPrice) : numPrice.toLocaleString('id-ID')}
      </span>
      {numChange !== undefined && (
        <div className={`flex items-center gap-1 ${getChangeColor()} ${sizeClasses[size].change}`}>
          {getArrow()}
          <span className="font-mono">{formatChange(numChange)}</span>
        </div>
      )}
    </div>
  );
};

export default PriceDisplay;
