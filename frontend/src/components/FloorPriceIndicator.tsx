import React from 'react';

interface FloorPriceIndicatorProps {
  currentPrice: number | string;
  floorPrice: number | string;
  distanceToFloor: number | string;
}

const FloorPriceIndicator: React.FC<FloorPriceIndicatorProps> = ({
  currentPrice,
  floorPrice,
  distanceToFloor,
}) => {
  const numCurrentPrice = typeof currentPrice === 'string' ? parseFloat(currentPrice) : currentPrice;
  const numFloorPrice = typeof floorPrice === 'string' ? parseFloat(floorPrice) : floorPrice;
  const numDistance = typeof distanceToFloor === 'string' ? parseFloat(distanceToFloor) : distanceToFloor;

  // Calculate position percentage for the marker
  // Assume range: 0% to 15% (anything above 15% is max)
  const maxRange = 15;
  const position = Math.min(Math.max(numDistance, 0), maxRange);
  const positionPercent = (position / maxRange) * 100;

  // Determine zone color
  const getZoneColor = () => {
    if (numDistance < 2) return 'bg-[var(--watch)]'; // Caution zone (< 2%)
    if (numDistance <= 10) return 'bg-[var(--bullish)]'; // Good zone (2-10%)
    return 'bg-[var(--neutral)]'; // Excellent zone (> 10%)
  };

  const getZoneLabel = () => {
    if (numDistance < 2) return 'Near Floor - High Risk';
    if (numDistance <= 10) return 'Sweet Spot';
    return 'Safe Distance';
  };

  const formatPrice = (price: number): string => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  return (
    <div className="w-full">
      {/* Price labels */}
      <div className="flex justify-between text-xs text-[var(--text-muted)] mb-2">
        <span>Floor: {formatPrice(numFloorPrice)}</span>
        <span>Current: {formatPrice(numCurrentPrice)}</span>
      </div>

      {/* Visual bar */}
      <div className="relative h-3 bg-[var(--bg-tertiary)] rounded-full overflow-hidden border border-[var(--border-color)]">
        {/* Zones */}
        <div className="absolute inset-0 flex">
          <div className="w-[13.3%] h-full bg-[var(--watch)]/20" title="< 2% (Caution)" />
          <div className="w-[53.3%] h-full bg-[var(--bullish)]/20" title="2-10% (Sweet Spot)" />
          <div className="w-[33.4%] h-full bg-[var(--neutral)]/20" title="> 10% (Safe)" />
        </div>

        {/* Current position marker */}
        <div
          className="absolute top-0 bottom-0 w-1 bg-[var(--text-primary)] shadow-[0_0_8px_rgba(0,0,0,0.3)] transition-all duration-300"
          style={{ left: `${positionPercent}%` }}
        >
          <div className="absolute -top-1 -left-1 w-3 h-3 rounded-full bg-[var(--text-primary)] shadow-lg" />
        </div>
      </div>

      {/* Zone labels */}
      <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
        <span>0%</span>
        <span className="flex-1 text-center">{getZoneLabel()}</span>
        <span>15%+</span>
      </div>

      {/* Distance badge */}
      <div className="flex items-center gap-2 mt-3">
        <span className={`text-sm font-mono font-semibold ${getZoneColor().replace('bg-', 'text-')}`}>
          {numDistance.toFixed(2)}%
        </span>
        <span className="text-xs text-[var(--text-muted)]">above floor</span>
      </div>
    </div>
  );
};

export default FloorPriceIndicator;
