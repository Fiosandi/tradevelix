import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricPillProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  description?: string;
  color?: 'whale' | 'retail' | 'floor' | 'default';
  size?: 'sm' | 'md';
}

const MetricPill: React.FC<MetricPillProps> = ({
  label,
  value,
  icon,
  trend,
  description,
  color = 'default',
  size = 'md',
}) => {
  const colorClasses = {
    whale: {
      bg: 'bg-[var(--whale)]/10',
      border: 'border-[var(--whale)]/30',
      text: 'text-[var(--whale)]',
    },
    retail: {
      bg: 'bg-[var(--retail)]/10',
      border: 'border-[var(--retail)]/30',
      text: 'text-[var(--retail)]',
    },
    floor: {
      bg: 'bg-[var(--floor)]/10',
      border: 'border-[var(--floor)]/30',
      text: 'text-[var(--floor)]',
    },
    default: {
      bg: 'bg-[var(--bg-tertiary)]',
      border: 'border-[var(--border-color)]',
      text: 'text-[var(--text-secondary)]',
    },
  };

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-2 text-sm',
  };

  const trendIcon = () => {
    if (trend === 'up') return <TrendingUp size={14} className="text-[var(--bullish)]" />;
    if (trend === 'down') return <TrendingDown size={14} className="text-[var(--bearish)]" />;
    return <Minus size={14} className="text-[var(--text-muted)]" />;
  };

  const colors = colorClasses[color];

  return (
    <div className={`rounded-lg border ${colors.bg} ${colors.border} ${sizeClasses[size]} flex items-center gap-2 shadow-theme`}>
      {icon && <span className={colors.text}>{icon}</span>}
      <div className="flex flex-col">
        <span className="text-[var(--text-muted)] text-xs">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-[var(--text-primary)]">{value}</span>
          {trend && trendIcon()}
        </div>
        {description && (
          <span className="text-[var(--text-muted)] text-[10px]">{description}</span>
        )}
      </div>
    </div>
  );
};

export default MetricPill;
