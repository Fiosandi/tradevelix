"""API Signals model - pre-computed analysis from /bandar/accumulation, /bandar/distribution, /sentiment APIs."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Numeric, Date, DateTime, ForeignKey, Text, UniqueConstraint, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class ApiSignal(Base, TimestampMixin):
    """Pre-computed analysis signals from Market Reaper API.
    Sources: /bandar/accumulation, /bandar/distribution, /bandar/smart-money, /sentiment, /bandar/pump-dump
    """
    __tablename__ = "api_signals"
    __table_args__ = (UniqueConstraint("stock_id", "date", "signal_type", name="uq_api_signal_stock_date_type"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    
    # Signal type: accumulation, distribution, smart_money, pump_dump, sentiment
    signal_type: Mapped[str] = mapped_column(String(30), nullable=False)

    # Core signal data
    score: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=True)  # accumulation_score, distribution_score
    status: Mapped[str] = mapped_column(String(30), nullable=True)  # NEUTRAL, ACCUMULATING, DISTRIBUTING
    confidence: Mapped[int] = mapped_column(Integer, nullable=True)  # 0-100
    recommendation: Mapped[str] = mapped_column(String(20), nullable=True)  # BUY, HOLD, SELL
    risk_level: Mapped[str] = mapped_column(String(20), nullable=True)  # LOW, MEDIUM, HIGH

    # Entry zone (from accumulation/distribution)
    entry_ideal_price: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    entry_max_price: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    current_price: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)

    # Top brokers
    top_brokers: Mapped[dict] = mapped_column(JSONB, nullable=True)  # List of broker codes

    # Full indicators object (stored as JSON for flexibility)
    indicators: Mapped[dict] = mapped_column(JSONB, nullable=True)
    
    # Timeframe analysis
    timeframe_analysis: Mapped[dict] = mapped_column(JSONB, nullable=True)

    # Relationship
    stock = relationship("Stock", back_populates="api_signals")

    def __repr__(self):
        return f"<ApiSignal(stock={self.stock_id}, type={self.signal_type}, score={self.score})>"