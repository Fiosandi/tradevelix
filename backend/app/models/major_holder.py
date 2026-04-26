"""Major holder movement model — 5%+ ownership disclosure from IDX/KSEI."""

import uuid
from datetime import date
from decimal import Decimal
from sqlalchemy import String, BigInteger, Numeric, Date, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class MajorHolderMovement(Base, TimestampMixin):
    """Ownership disclosure movements sourced from IDX/KSEI via Market Reaper API.
    Populated during weekly sync. Only stores 5%+ (and notable sub-5%) events.
    """
    __tablename__ = "major_holder_movements"
    __table_args__ = (
        UniqueConstraint("stock_id", "holder_id", "disclosure_date", name="uq_major_holder_stock_id_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=False, index=True)

    holder_id: Mapped[str] = mapped_column(String(50), nullable=False)
    holder_name: Mapped[str] = mapped_column(String(200), nullable=False)
    disclosure_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    prev_shares: Mapped[int] = mapped_column(BigInteger, nullable=True)
    prev_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=True)
    curr_shares: Mapped[int] = mapped_column(BigInteger, nullable=True)
    curr_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=True)
    change_shares: Mapped[int] = mapped_column(BigInteger, nullable=True)
    change_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=True)

    nationality: Mapped[str] = mapped_column(String(30), nullable=True)   # FOREIGN, DOMESTIC
    action_type: Mapped[str] = mapped_column(String(10), nullable=True)   # BUY, SELL
    source: Mapped[str] = mapped_column(String(10), nullable=True)        # IDX, KSEI
    price_at_disclosure: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)

    stock = relationship("Stock", backref="major_holder_movements")
