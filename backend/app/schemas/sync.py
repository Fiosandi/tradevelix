"""Pydantic schemas for sync and admin endpoints."""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field
from decimal import Decimal


# ─── Sync Trigger Schemas ────────────────────────────────────────────

class SyncTriggerResponse(BaseModel):
    """Response after triggering a sync job."""
    status: str = Field(..., description="Status of the trigger: started, already_running, rate_limited")
    sync_type: str = Field(..., description="Type of sync triggered")
    message: str = Field(..., description="Human-readable status message")
    sync_log_id: Optional[str] = Field(None, description="ID of the created sync log")

    class Config:
        from_attributes = True


class SyncLogResponse(BaseModel):
    """Sync log entry response."""
    id: str
    sync_type: str
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    records_synced: int = 0
    api_calls_used: int = 0
    error_message: Optional[str] = None

    class Config:
        from_attributes = True


class ApiKeyUsage(BaseModel):
    """Per-key usage breakdown sourced from RapidAPI rate-limit headers."""
    key_index: int
    key_preview: str
    calls_used: int
    calls_limit: int
    calls_remaining: int
    active: bool = False
    last_call_at: Optional[str] = None
    header_observed: bool = False
    flag: Optional[str] = None
    reserved: bool = False


class ApiUsageResponse(BaseModel):
    """API usage statistics."""
    model_config = {"extra": "ignore"}

    monthly_calls_used: int = 0
    monthly_limit: int = 1000
    monthly_remaining: int = 1000
    total_syncs_this_month: int = 0
    plan: str = "FREE"
    client_monthly_calls: int = 0
    client_daily_calls: int = 0
    per_key: List[ApiKeyUsage] = []
    active_key: Optional[int] = None


class SyncStatusResponse(BaseModel):
    """Full sync status with recent logs and API usage."""
    recent_syncs: List[SyncLogResponse] = []
    api_usage: ApiUsageResponse = Field(default_factory=ApiUsageResponse)
    last_daily_sync: Optional[datetime] = None
    last_weekly_sync: Optional[datetime] = None

    class Config:
        from_attributes = True


class BulkSyncResponse(BaseModel):
    """Response after triggering a bulk sync."""
    status: str
    message: str
    sync_log_ids: List[str] = []

    class Config:
        from_attributes = True