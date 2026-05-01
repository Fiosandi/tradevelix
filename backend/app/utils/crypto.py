"""Symmetric encryption for at-rest secrets (e.g. scraped-service session cookies).

Uses Fernet (AES-128-CBC + HMAC) from `cryptography`. Key is read once from
settings.STOCKBIT_FERNET_KEY. Generate a fresh one with:

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If the env var is missing, encrypt/decrypt raise loudly so we never silently
store plaintext.
"""

import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

logger = logging.getLogger(__name__)


class CryptoConfigError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = (settings.STOCKBIT_FERNET_KEY or "").strip()
    if not key:
        raise CryptoConfigError(
            "STOCKBIT_FERNET_KEY is not set. Generate with: "
            "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError) as e:
        raise CryptoConfigError(f"STOCKBIT_FERNET_KEY is malformed: {e}") from e


def encrypt(plaintext: str) -> str:
    """Return Fernet token as a string (base64 ASCII), suitable for Text column storage."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Reverse of encrypt(). Raises InvalidToken if the key changed or data tampered."""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning("Fernet decryption failed — key rotated or data tampered")
        raise
