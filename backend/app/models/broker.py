"""Broker model - master list with whale/retail classification."""

import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Broker(Base, TimestampMixin):
    """Broker codes with whale/retail classification."""
    __tablename__ = "brokers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=True)
    broker_type: Mapped[str] = mapped_column(String(20), default="RETAIL")  # WHALE, RETAIL, MIXED, GOVERNMENT
    investor_type: Mapped[str] = mapped_column(String(20), nullable=True)  # Asing, Lokal, Pemerintah (from API)
    source: Mapped[str] = mapped_column(String(20), default="API")  # API, MANUAL
    last_synced: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    def __repr__(self):
        return f"<Broker(code={self.code}, name={self.name}, type={self.broker_type})>"