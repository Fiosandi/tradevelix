"""Dependencies for FastAPI endpoints."""

from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get database session for request."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()