"""In-memory pub/sub for sync progress events.

Used to stream live request/response/progress events to the admin UI via SSE.
Events are best-effort — if a subscriber's queue fills up, events are dropped
for that subscriber rather than blocking the producer (sync code).
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)

_subscribers: set[asyncio.Queue] = set()
_QUEUE_MAX = 500


def emit(event_type: str, **data: Any) -> None:
    """Fire-and-forget publish to all current subscribers."""
    payload = {"ts": datetime.utcnow().isoformat() + "Z", "type": event_type, **data}
    for q in list(_subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


async def subscribe() -> AsyncIterator[dict]:
    """Yield events as they arrive. Caller is responsible for cleanup via async-for break."""
    q: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAX)
    _subscribers.add(q)
    try:
        while True:
            yield await q.get()
    finally:
        _subscribers.discard(q)


def subscriber_count() -> int:
    return len(_subscribers)
