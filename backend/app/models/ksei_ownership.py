"""KSEI monthly ownership composition — parsed from monthly KSEI PDF disclosures."""

import uuid
from datetime import date
from decimal import Decimal
from sqlalchemy import String, BigInteger, Numeric, Date, ForeignKey, Boolean, Integer, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class KseiOwnership(Base, TimestampMixin):
    """One row per (stock, snapshot_month, holder) entry from the KSEI monthly PDF.

    KSEI publishes monthly stockholder rosters listing every >=5% holder plus
    summary aggregates by entity type. This table stores the per-holder rows;
    aggregates are computed on demand by the endpoint.
    """
    __tablename__ = "ksei_ownership"
    __table_args__ = (
        UniqueConstraint("stock_id", "snapshot_month", "holder_name", name="uq_ksei_ownership_holder"),
        Index("ix_ksei_ownership_month", "snapshot_month"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=False, index=True)
    snapshot_month: Mapped[date] = mapped_column(Date, nullable=False)

    holder_name: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)        # Lokal | Asing
    entity_type: Mapped[str] = mapped_column(String(50), nullable=True)    # Corporate | Individual | MutualFund | Insurance | Bank | Pension | Foundation | Other
    shares: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    percentage: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=True)
    is_controlling: Mapped[bool] = mapped_column(Boolean, default=False)

    stock = relationship("Stock", backref="ksei_ownership")


class KseiSidHistory(Base, TimestampMixin):
    """Single Investor ID (SID) count per month — proxy for retail interest."""
    __tablename__ = "ksei_sid_history"
    __table_args__ = (
        UniqueConstraint("stock_id", "snapshot_month", name="uq_ksei_sid_stock_month"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=False, index=True)
    snapshot_month: Mapped[date] = mapped_column(Date, nullable=False)

    sid_count: Mapped[int] = mapped_column(Integer, nullable=True)
    scripless_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=True)

    stock = relationship("Stock", backref="ksei_sid_history")
