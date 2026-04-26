"""Stock model - master list of tracked stocks."""

import uuid
from datetime import datetime, date
from sqlalchemy import String, Integer, Boolean, DateTime, Date, BigInteger, Numeric, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Stock(Base, TimestampMixin):
    """Master stock list synced from API."""
    __tablename__ = "stocks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticker: Mapped[str] = mapped_column(String(10), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=True)
    sector_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sectors.id"), nullable=True)
    subsector: Mapped[str] = mapped_column(String(255), nullable=True)
    listing_date: Mapped[date] = mapped_column(Date, nullable=True)
    shares_outstanding: Mapped[int] = mapped_column(BigInteger, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    # Relationships
    sector = relationship("Sector", back_populates="stocks")
    daily_prices = relationship("DailyPrice", back_populates="stock", lazy="selectin")
    broker_summaries = relationship("BrokerSummary", back_populates="stock", lazy="selectin")
    weekly_metrics = relationship("WeeklyMetric", back_populates="stock", lazy="selectin")
    trade_signals = relationship("TradeSignal", back_populates="stock", lazy="selectin")
    api_signals = relationship("ApiSignal", back_populates="stock", lazy="selectin")

    def __repr__(self):
        return f"<Stock(ticker={self.ticker}, name={self.name})>"