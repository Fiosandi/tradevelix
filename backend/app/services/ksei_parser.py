"""KSEI monthly PDF parser — extracts stockholder rosters and SID counts.

The KSEI PDF format follows a multi-stock per file layout. The parser walks
each page's tables and yields per-stock holder rows.

Column mapping is calibrated from the legacy Streamlit project (TradingTools/idx_kepemilikan.py):
    row[1]  = stock code (e.g. "BUVA")
    row[4]  = pemegang_saham (holder name)
    row[10] = status ("Lokal" | "Asing")
    row[14] = jumlah_saham (shares, integer with thousands separators)
    row[16] = percentage (with "%" suffix)

Live KSEI files may have shifted columns or merged cells — feed a sample PDF
through `parse_ksei_pdf` and inspect logs to confirm.
"""

import logging
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)


ENTITY_KEYWORDS = [
    ("MutualFund", ["reksa dana", "mutual fund"]),
    ("Insurance",  ["asuransi", "insurance"]),
    ("Bank",       ["bank "]),
    ("Pension",    ["dana pensiun", "pension fund", "yayasan dana pensiun"]),
    ("Foundation", ["yayasan", "foundation"]),
    ("Corporate",  ["pt ", "tbk", "limited", "ltd.", "ltd ", "inc.", "corp", "corporation", "company", "investment"]),
    ("Individual", []),  # default fallback when no keyword matches
]


def _classify_entity(holder_name: str) -> str:
    """Bucket a holder name into a coarse entity type from its name."""
    n = holder_name.lower().strip()
    for entity, keywords in ENTITY_KEYWORDS:
        for kw in keywords:
            if kw in n:
                return entity
    return "Individual"


def _to_int(s: str) -> Optional[int]:
    if not s:
        return None
    cleaned = re.sub(r"[^\d]", "", str(s))
    return int(cleaned) if cleaned else None


def _to_decimal(s: str) -> Optional[Decimal]:
    if not s:
        return None
    cleaned = re.sub(r"[^\d.,\-]", "", str(s)).replace(",", ".")
    if not cleaned or cleaned in (".", "-"):
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _parse_row(row: list, snapshot_month: date) -> Optional[dict]:
    """Map a raw PDF table row to an ownership dict, or None if unparseable.

    Tolerant to column-shift: if standard offsets fail, scans the row for
    the first cell that looks like a ticker (3-4 uppercase letters)."""
    if not row or len(row) < 5:
        return None

    ticker = None
    holder = None
    status = None
    shares = None
    percentage = None

    if len(row) >= 17:
        ticker = (row[1] or "").strip() if row[1] else None
        holder = (row[4] or "").strip() if row[4] else None
        status = (row[10] or "").strip() if row[10] else None
        shares = _to_int(row[14])
        percentage = _to_decimal(row[16])

    if not ticker or not re.match(r"^[A-Z]{3,5}$", ticker):
        for cell in row:
            if cell and re.match(r"^[A-Z]{3,5}$", str(cell).strip()):
                ticker = str(cell).strip()
                break

    if not ticker or not holder:
        return None

    if status not in ("Lokal", "Asing"):
        status = "Lokal" if any(k in (holder or "").upper() for k in ["PT ", "TBK", "INDONESIA"]) else "Asing"

    return {
        "ticker": ticker,
        "snapshot_month": snapshot_month,
        "holder_name": holder[:300],
        "status": status,
        "entity_type": _classify_entity(holder),
        "shares": shares or 0,
        "percentage": percentage,
        "is_controlling": bool(percentage and percentage >= Decimal("5")),
    }


def parse_ksei_pdf(file_path: str | Path, snapshot_month: date) -> Iterator[dict]:
    """Yield ownership dicts parsed from a KSEI monthly PDF.

    Args:
        file_path: absolute path to the uploaded PDF
        snapshot_month: the calendar month the report covers (day=1)
    """
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber not installed — run pip install -r requirements.txt")

    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(str(path))

    yielded = 0
    with pdfplumber.open(path) as pdf:
        for page_num, page in enumerate(pdf.pages, start=1):
            try:
                tables = page.extract_tables() or []
            except Exception as e:
                logger.warning("KSEI parse: page %d table extraction failed: %s", page_num, e)
                continue

            for tbl in tables:
                for raw_row in tbl:
                    parsed = _parse_row(raw_row, snapshot_month)
                    if parsed and parsed["shares"] > 0:
                        yielded += 1
                        yield parsed

    logger.info("KSEI parse: extracted %d ownership rows from %s", yielded, path.name)


def parse_sid_summary(file_path: str | Path, snapshot_month: date) -> Iterator[dict]:
    """Yield SID count dicts. KSEI sometimes publishes SID counts on a summary page;
    when not present, this yields nothing and the SID chart simply skips this month.

    Looks for rows where one cell is a ticker and another contains a SID count
    (commonly labelled 'Jumlah Pemegang Saham' or 'SID')."""
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber not installed")

    path = Path(file_path)
    if not path.exists():
        return

    seen_tickers: set[str] = set()
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            try:
                text = page.extract_text() or ""
            except Exception:
                continue
            if "SID" not in text and "Pemegang Saham" not in text:
                continue
            try:
                tables = page.extract_tables() or []
            except Exception:
                continue

            for tbl in tables:
                for row in tbl:
                    if not row:
                        continue
                    ticker = next(
                        (str(c).strip() for c in row if c and re.match(r"^[A-Z]{3,5}$", str(c).strip())),
                        None,
                    )
                    if not ticker or ticker in seen_tickers:
                        continue
                    sid = next((_to_int(c) for c in row if c and _to_int(c) and _to_int(c) > 100), None)
                    if sid is None:
                        continue
                    seen_tickers.add(ticker)
                    yield {
                        "ticker": ticker,
                        "snapshot_month": snapshot_month,
                        "sid_count": sid,
                        "scripless_pct": None,
                    }
