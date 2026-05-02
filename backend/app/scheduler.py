"""APScheduler - automated data syncs on a fixed WIB schedule.

Schedule (WIB = Asia/Jakarta = UTC+7):
  Daily sync:   Mon-Fri at SYNC_DAILY_HOUR:SYNC_DAILY_MINUTE  (after IDX market close)
  Weekly sync:  SYNC_WEEKLY_DAY at SYNC_WEEKLY_HOUR:00        (weekend full reprocess)

Run standalone:  python -m app.scheduler
Docker service:  command: python -m app.scheduler
"""

import asyncio
import logging
import random
import sys

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

from app.config import settings
from app.services.sync_service import run_sync_background

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("remora.scheduler")

WIB = pytz.timezone("Asia/Jakarta")

_DAY_ABBR = {
    "monday": "mon", "tuesday": "tue", "wednesday": "wed",
    "thursday": "thu", "friday": "fri", "saturday": "sat", "sunday": "sun",
}

scheduler = AsyncIOScheduler(timezone=WIB)


def _day_abbr(day: str) -> str:
    """Convert full weekday name to APScheduler 3-letter abbreviation."""
    return _DAY_ABBR.get(day.lower(), day.lower()[:3])


def setup_jobs() -> None:
    """Register all scheduled jobs from settings."""

    # ±20-minute jitter so the schedule doesn't fire at perfectly round times,
    # which is one of the cheapest tells that a service account is automated.
    daily_jitter  = random.randint(0, 39)   # added to SYNC_DAILY_MINUTE
    weekly_jitter = random.randint(0, 39)   # minute-of-hour for weekly

    # Daily: OHLCV prices + movers (~27 API calls, Mon-Fri after close)
    scheduler.add_job(
        run_sync_background,
        CronTrigger(
            day_of_week="mon-fri",
            hour=settings.SYNC_DAILY_HOUR,
            minute=(settings.SYNC_DAILY_MINUTE + daily_jitter) % 60,
            timezone=WIB,
        ),
        args=["daily"],
        id="daily_sync",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Weekly: broker summaries + signals + Three Doors recalculation (~60 API calls)
    scheduler.add_job(
        run_sync_background,
        CronTrigger(
            day_of_week=_day_abbr(settings.SYNC_WEEKLY_DAY),
            hour=settings.SYNC_WEEKLY_HOUR,
            minute=weekly_jitter,
            timezone=WIB,
        ),
        args=["weekly"],
        id="weekly_sync",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    logger.info(
        "Jobs registered: daily=%02d:%02d WIB (Mon-Fri), weekly=%s %02d:00 WIB",
        settings.SYNC_DAILY_HOUR,
        settings.SYNC_DAILY_MINUTE,
        settings.SYNC_WEEKLY_DAY.capitalize(),
        settings.SYNC_WEEKLY_HOUR,
    )
    for job in scheduler.get_jobs():
        logger.info("  Registered job: %s", job.id)


async def main() -> None:
    logger.info("Remora Scheduler starting...")
    setup_jobs()
    scheduler.start()

    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped.")


if __name__ == "__main__":
    asyncio.run(main())
