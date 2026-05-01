"""Trade signals, alerts, sync logs, and upload jobs."""

import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Numeric, DateTime, ForeignKey, Text, Boolean, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class TradeSignal(Base, TimestampMixin):
    """Generated trade signals from weekly analysis."""
    __tablename__ = "trade_signals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(10), nullable=False)  # BUY, SELL, HOLD, WATCH
    entry_price: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    stop_loss: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    target_1: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    target_2: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=True)
    confidence: Mapped[int] = mapped_column(Integer, nullable=True)  # 0-100
    pattern_type: Mapped[str] = mapped_column(String(50), nullable=True)
    key_bullets: Mapped[dict] = mapped_column(JSONB, nullable=True)
    whale_brokers: Mapped[dict] = mapped_column(JSONB, nullable=True)  # List of whale broker codes
    retail_exit_percent: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=True)
    volume_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")  # ACTIVE, HIT_T1, HIT_T2, STOPPED_OUT, EXPIRED
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    stock = relationship("Stock", back_populates="trade_signals")


class Alert(Base, TimestampMixin):
    """User-defined alert conditions."""
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    stock_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stocks.id"), nullable=True, index=True)
    alert_type: Mapped[str] = mapped_column(String(30), nullable=False)  # RETAIL_EXIT, WHALE_ENTRY, FLOOR_PRICE, BREAKOUT
    condition: Mapped[dict] = mapped_column(JSONB, nullable=True)  # {"threshold": 50, "direction": "above"}
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    triggered_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SyncLog(Base, TimestampMixin):
    """Track API sync runs and call usage."""
    __tablename__ = "sync_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sync_type: Mapped[str] = mapped_column(String(30), nullable=False)  # DAILY_PRICES, WEEKLY_BROKER, WEEKLY_SIGNALS, etc.
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    records_synced: Mapped[int] = mapped_column(Integer, default=0)
    api_calls_used: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING, SUCCESS, PARTIAL, FAILED
    error_message: Mapped[str] = mapped_column(Text, nullable=True)


class UploadJob(Base, TimestampMixin):
    """Manual KSEI PDF upload tracking."""
    __tablename__ = "upload_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # KSEI_SID, KSEI_LK
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING, PROCESSING, COMPLETED, FAILED
    records_processed: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ExternalCredential(Base, TimestampMixin):
    """Encrypted credentials for external scraped services (Stockbit, RTI, etc.).

    Cookies are Fernet-encrypted before storage using STOCKBIT_FERNET_KEY from .env.
    `service_name` is the unique key — one row per service, paste-to-overwrite.
    """
    __tablename__ = "external_credentials"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service_name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    encrypted_blob: Mapped[str] = mapped_column(Text, nullable=False)  # Fernet token (base64 ASCII)
    note: Mapped[str] = mapped_column(String(200), nullable=True)
    last_used_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str] = mapped_column(String(20), nullable=True)  # VALID, EXPIRED, INVALID
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ApiRawResponse(Base, TimestampMixin):
    """Store raw API responses for debugging and later analysis.
    Every API call response is saved here before processing.
    """
    __tablename__ = "api_raw_responses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    endpoint: Mapped[str] = mapped_column(String(200), nullable=False)  # e.g., "/api/chart/BBCA/daily"
    params_hash: Mapped[str] = mapped_column(String(64), nullable=True)  # SHA256 of params for dedup
    stock_ticker: Mapped[str] = mapped_column(String(10), nullable=True, index=True)
    response_data: Mapped[dict] = mapped_column(JSONB, nullable=False)  # Full API response JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)