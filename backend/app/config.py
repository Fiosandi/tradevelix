"""Application configuration from environment variables."""

import os
from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings


def _find_env_file() -> str:
    """Find the .env file - search current dir, then parent dirs."""
    # Search from current directory upward
    current = Path.cwd()
    for _ in range(3):  # Check up to 3 levels
        env_path = current / ".env"
        if env_path.exists():
            return str(env_path)
        current = current.parent
    return ".env"  # Fallback to current dir


ENV_FILE = _find_env_file()


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    # Application
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    LOG_LEVEL: str = "INFO"

    # Database
    POSTGRES_DB: str = "remora"
    POSTGRES_USER: str = "remora"
    POSTGRES_PASSWORD: str = "remora_password"
    DATABASE_URL: str = "postgresql+asyncpg://remora:remora_password@localhost:5432/remora"

    # Symmetric encryption key for stored scraped-service cookies (Fernet, base64).
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    STOCKBIT_FERNET_KEY: str = ""

    # Market Reaper API
    RAPIDAPI_KEY: str = ""
    RAPIDAPI_KEYS: str = ""  # Comma-separated list of keys for rotation
    RAPIDAPI_RESERVED_KEYS: str = ""  # Comma-separated 1-based indices held in reserve (e.g. "3")
    RAPIDAPI_HOST: str = "indonesia-stock-exchange-idx.p.rapidapi.com"
    API_PLAN: str = "FREE"
    API_RATE_LIMIT_SECONDS: float = 2.0
    API_MONTHLY_CALL_LIMIT: int = 1000  # Fallback per-key limit; overridden per-key by upstream X-RateLimit-Requests-Limit header
    API_DAILY_CALL_LIMIT: int = 150

    @property
    def rapidapi_keys_list(self) -> List[str]:
        """All API keys available for rotation."""
        if self.RAPIDAPI_KEYS:
            keys = [k.strip() for k in self.RAPIDAPI_KEYS.split(",") if k.strip()]
            if keys:
                return keys
        return [self.RAPIDAPI_KEY] if self.RAPIDAPI_KEY else []

    @property
    def rapidapi_reserved_indices(self) -> set[int]:
        """0-based indices of keys held in reserve (only used if all others are exhausted)."""
        out: set[int] = set()
        if not self.RAPIDAPI_RESERVED_KEYS:
            return out
        for token in self.RAPIDAPI_RESERVED_KEYS.split(","):
            token = token.strip()
            if not token:
                continue
            try:
                idx = int(token) - 1  # config is 1-based, internal is 0-based
                if idx >= 0:
                    out.add(idx)
            except ValueError:
                pass
        return out

    # Watchlist
    WATCHLIST: str = "BUVA,BIPI,VKTR,BUMI,BRMS,ENRG,SUPA,COCO,PTRO,CUAN,IMPC,INDY"

    @property
    def watchlist_list(self) -> List[str]:
        return [s.strip() for s in self.WATCHLIST.split(",") if s.strip()]

    # Broker Classification
    WHALE_BROKERS: str = "AI,BK,YU,BB,AS,SS,CS"
    RETAIL_BROKERS: str = "YP,XL,PD,XC,CP,AB"

    @property
    def whale_brokers_list(self) -> List[str]:
        return [s.strip() for s in self.WHALE_BROKERS.split(",") if s.strip()]

    @property
    def retail_brokers_list(self) -> List[str]:
        return [s.strip() for s in self.RETAIL_BROKERS.split(",") if s.strip()]

    # Sync Schedule
    SYNC_DAILY_HOUR: int = 18
    SYNC_DAILY_MINUTE: int = 0
    SYNC_WEEKLY_DAY: str = "saturday"
    SYNC_WEEKLY_HOUR: int = 10

    # Data Retention
    DATA_RETENTION_MONTHS: int = 12

    # Frontend
    VITE_API_URL: str = "http://localhost:8000/api/v1"

    model_config = {"env_file": ENV_FILE, "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()