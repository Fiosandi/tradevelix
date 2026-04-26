"""Sector model for IDX sector classification."""

import uuid
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class Sector(Base, TimestampMixin):
    """IDX sectors."""
    __tablename__ = "sectors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sector_id_api: Mapped[str] = mapped_column(String(50), nullable=True, unique=True)

    stocks = relationship("Stock", back_populates="sector", lazy="selectin")

    def __repr__(self):
        return f"<Sector(name={self.name})>"