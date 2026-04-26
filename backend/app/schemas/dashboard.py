"""Pydantic schemas for dashboard endpoints."""

from datetime import date, datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field, model_validator
from decimal import Decimal


class DashboardSummaryResponse(BaseModel):
    """Overview dashboard response."""
    stocks_tracked: int = 0
    stocks_with_data: int = 0
    last_daily_sync: Optional[datetime] = None
    last_weekly_sync: Optional[datetime] = None
    api_usage: dict = Field(default_factory=dict)
    watchlist: List[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class TopWhaleBrokerInfo(BaseModel):
    """Top whale broker info."""
    code: str
    lots: int
    value: float
    side: str

    model_config = {"from_attributes": True}


class LeaderboardEntry(BaseModel):
    """Single stock entry in the leaderboard."""
    ticker: str
    name: Optional[str] = None
    overall_signal: Optional[str] = None
    confidence_score: Optional[int] = None
    whale_net_lots: Optional[int] = None
    retail_exit_percent: Optional[Decimal] = None
    kekompakan_score: Optional[Decimal] = None
    vpa_signal: Optional[str] = None
    Bandar_floor_price: Optional[Decimal] = None
    current_price: Optional[Decimal] = None
    distance_to_floor_pct: Optional[Decimal] = None
    api_accumulation_score: Optional[Decimal] = None
    week_start: Optional[date] = None
    week_end: Optional[date] = None
    top_whale_brokers: Optional[List[Dict[str, Any]]] = None  # Top 3 smart money brokers
    pump_score: Optional[float] = None

    model_config = {"from_attributes": True, "arbitrary_types_allowed": True}

    @model_validator(mode='before')
    @classmethod
    def parse_top_whale_brokers(cls, data):
        """Ensure top_whale_brokers is properly parsed."""
        if isinstance(data, dict):
            if 'top_whale_brokers' in data:
                brokers = data['top_whale_brokers']
                if brokers is not None:
                    if isinstance(brokers, list):
                        # Convert each dict to TopWhaleBrokerInfo then back to dict
                        data['top_whale_brokers'] = [
                            dict(TopWhaleBrokerInfo(**b)) if isinstance(b, dict) else b
                            for b in brokers
                        ]
        return data


class LeaderboardResponse(BaseModel):
    """Leaderboard response with ranked stocks."""
    entries: List[LeaderboardEntry] = Field(default_factory=list)
    sort_by: str = "overall_signal"
    week_start: Optional[date] = None
    week_end: Optional[date] = None
    total_stocks: int = 0

    model_config = {"from_attributes": True}