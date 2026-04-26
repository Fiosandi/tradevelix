"""Daily price model - OHLCV with foreign flow from /chart/daily API."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Numeric, Date, DateTime, ForeignKey, BigInteger, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class DailyPrice(Base, TimestampMixin):
    """EOD OHLCV data with foreign flow. Source: /api/chart/{symbol}/daily"""
    __tablename__ = "daily_prices"
    __table_args__ = (UniqueConstraint("stock_id", "date", name="uq_daily_price_stock_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    # OHLCV
    open: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    high: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    low: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    close: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=True)
    value: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)

    # Foreign flow (from API)
    foreign_buy: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    foreign_sell: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    foreign_flow: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)

    # Additional
    frequency: Mapped[int] = mapped_column(Integer, nullable=True)
    shares_outstanding: Mapped[int] = mapped_column(BigInteger, nullable=True)

    # Relationship
    stock = relationship("Stock", back_populates="daily_prices")

    def __repr__(self):
        return f"<DailyPrice(stock_id={self.stock_id}, date={self.date}, close={self.close})>"