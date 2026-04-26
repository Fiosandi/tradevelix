"""Weekly metrics model - our Three Doors analysis results."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Numeric, Date, DateTime, ForeignKey, Text, UniqueConstraint, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class WeeklyMetric(Base, TimestampMixin):
    """Calculated weekly metrics from our Three Doors analysis.
    Populated after weekly broker sync + calculation engine run.
    """
    __tablename__ = "weekly_metrics"
    __table_args__ = (UniqueConstraint("stock_id", "week_start", name="uq_weekly_metric_stock_week"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=False, index=True)
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    week_end: Mapped[date] = mapped_column(Date, nullable=False)

    # Door 1: Who (broker identification)
    whale_net_lots: Mapped[int] = mapped_column(Integer, nullable=True)
    whale_net_value: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    whale_count: Mapped[int] = mapped_column(Integer, nullable=True)  # Number of active whale brokers

    # Door 2: What (transaction patterns)
    retail_exit_percent: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=True)
    retail_participation_pct: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=True)

    # Door 3: Coordination (kekompakan)
    kekompakan_score: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=True)

    # VPA (from daily_prices for this week)
    vpa_signal: Mapped[str] = mapped_column(String(20), nullable=True)  # UP_TREND, DOWN_TREND, NEUTRAL
    price_change_week: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=True)  # % change
    volume_change_week: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=True)  # % change vs prior week

    # Bandar analysis
    bandar_floor_price: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    distance_to_floor_pct: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=True)
    # Top 3 whale brokers sorted by net accumulation (buy lots)
    # Format: [{"code": "BK", "lots": 209000, "value": 24500000000, "side": "BUY"}, ...]
    top_whale_brokers: Mapped[dict] = mapped_column(JSONB, nullable=True)

    # Composite signal
    overall_signal: Mapped[str] = mapped_column(String(20), nullable=True)  # STRONG_BUY, BUY, WATCH, WAIT, SELL
    confidence_score: Mapped[int] = mapped_column(Integer, nullable=True)  # 0-100

    # API pre-computed signals (for comparison/corroboration)
    api_accumulation_score: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=True)
    api_distribution_score: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=True)
    api_sentiment_status: Mapped[str] = mapped_column(String(30), nullable=True)
    api_smart_money_status: Mapped[str] = mapped_column(String(30), nullable=True)

    # Relationship
    stock = relationship("Stock", back_populates="weekly_metrics")

    def __repr__(self):
        return f"<WeeklyMetric(stock={self.stock_id}, week={self.week_start}, signal={self.overall_signal})>"