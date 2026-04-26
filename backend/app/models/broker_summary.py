"""Broker summary and entries - AGGREGATED over date range from broker-summary API."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Numeric, Date, DateTime, ForeignKey, BigInteger, Boolean, Text, UniqueConstraint, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class BrokerSummary(Base, TimestampMixin):
    """Aggregated broker summary for a stock over a date range.
    Source: /api/market-detector/broker-summary/{symbol}?from=X&to=Y
    
    This is AGGREGATED data, not per-day snapshots.
    Each record = one date range (e.g., 7-day week) for one stock.
    """
    __tablename__ = "broker_summaries"
    __table_args__ = (UniqueConstraint("stock_id", "date_from", "date_to", name="uq_broker_summary_range"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=False, index=True)
    date_from: Mapped[date] = mapped_column(Date, nullable=False)
    date_to: Mapped[date] = mapped_column(Date, nullable=False)
    range_days: Mapped[int] = mapped_column(Integer, nullable=True)

    # Bandar detector summary (from API response top level)
    avg_price: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=True)
    avg_accdist: Mapped[str] = mapped_column(String(50), nullable=True)  # Big Dist, Small Dist, Neutral, etc.
    avg_amount: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    avg_percent: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=True)
    avg_vol: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    broker_accdist: Mapped[str] = mapped_column(String(50), nullable=True)  # Dist, Acc, Neutral
    total_buyer: Mapped[int] = mapped_column(Integer, nullable=True)
    total_seller: Mapped[int] = mapped_column(Integer, nullable=True)
    total_value: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    total_volume: Mapped[int] = mapped_column(Integer, nullable=True)

    # Relationship
    stock = relationship("Stock", back_populates="broker_summaries")
    entries = relationship("BrokerEntry", back_populates="summary", cascade="all, delete-orphan", lazy="selectin")

    def __repr__(self):
        return f"<BrokerSummary(stock_id={self.stock_id}, {self.date_from} to {self.date_to})>"


class BrokerEntry(Base, TimestampMixin):
    """Individual broker entry within a summary.
    Source: brokers_buy[] and brokers_sell[] arrays from broker-summary API.
    
    Maps API fields:
    - brokers_buy: blot → lots, bval → value, netbs_buy_avg_price → avg_price, type → investor_type
    - brokers_sell: slot (negative) → lots, sval → value, netbs_sell_avg_price → avg_price, type → investor_type
    """
    __tablename__ = "broker_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    summary_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("broker_summaries.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Broker identification
    broker_code: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(4), nullable=False)  # BUY or SELL
    investor_type: Mapped[str] = mapped_column(String(20), nullable=True)  # Asing, Lokal, Pemerintah
    is_whale: Mapped[bool] = mapped_column(Boolean, default=False)  # Calculated from brokers.yaml

    # Trading data
    lots: Mapped[int] = mapped_column(Integer, nullable=True)  # blot (buy) or abs(slot) (sell)
    value: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)  # bval or abs(sval)
    avg_price: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=True)  # netbs_buy_avg_price or netbs_sell_avg_price
    frequency: Mapped[int] = mapped_column(Integer, nullable=True)  # freq (number of transactions)

    # Relationship
    summary = relationship("BrokerSummary", back_populates="entries")

    def __repr__(self):
        return f"<BrokerEntry({self.side} {self.broker_code} lots={self.lots})>"