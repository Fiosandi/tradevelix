"""Local dry-run for the KSEI PDF parser — no DB writes.

Usage:
    cd backend
    python scripts/test_ksei_parser.py /path/to/ksei_2026_03.pdf 2026-03-01

Prints:
- per-page table count
- a sample of the first 30 parsed rows (ticker, status, entity_type, shares, %)
- aggregate counts: total rows parsed, unique tickers, controlling holders, SID rows
- any rows where shares=0 or percentage is missing (likely column-drift candidates)

Use this BEFORE uploading through Admin to confirm column offsets are correct.
If counts look off, paste the first 30 rows here and we'll tune `_parse_row` offsets.
"""

import argparse
import os
import sys
from collections import Counter
from datetime import date
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.ksei_parser import parse_ksei_pdf, parse_sid_summary


def main():
    p = argparse.ArgumentParser(description="Dry-run the KSEI parser on a local PDF (no DB writes).")
    p.add_argument("pdf", help="Path to the KSEI monthly PDF file")
    p.add_argument("month", help="Snapshot month as ISO date, e.g. 2026-03-01")
    p.add_argument("--limit", type=int, default=30, help="How many sample rows to print (default 30)")
    p.add_argument("--ticker", help="Filter sample to one ticker")
    args = p.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        print(f"ERROR: PDF not found at {pdf_path}", file=sys.stderr)
        sys.exit(1)

    try:
        snapshot = date.fromisoformat(args.month).replace(day=1)
    except ValueError:
        print(f"ERROR: month must be ISO date YYYY-MM-DD, got {args.month}", file=sys.stderr)
        sys.exit(1)

    print(f"\n{'═' * 78}")
    print(f"  KSEI PARSER DRY-RUN")
    print(f"{'═' * 78}")
    print(f"  File:           {pdf_path}")
    print(f"  Size:           {pdf_path.stat().st_size / 1024:.1f} KB")
    print(f"  Snapshot month: {snapshot}")
    print(f"{'─' * 78}\n")

    # ─── Parse ownership rows ────────────────────────────────────────
    print("Parsing ownership rows…")
    rows = list(parse_ksei_pdf(pdf_path, snapshot))

    if not rows:
        print("\n⚠  No rows parsed. The column offsets are likely wrong for this PDF.")
        print("   Open the PDF and look at the column layout, then update _parse_row offsets")
        print("   in backend/app/services/ksei_parser.py.\n")
        sys.exit(2)

    if args.ticker:
        rows = [r for r in rows if r["ticker"] == args.ticker.upper()]

    # ─── Summary stats ───────────────────────────────────────────────
    tickers = Counter(r["ticker"] for r in rows)
    statuses = Counter(r["status"] for r in rows)
    entity_types = Counter(r["entity_type"] for r in rows)
    controlling = sum(1 for r in rows if r["is_controlling"])
    zero_shares = sum(1 for r in rows if not r["shares"])
    null_pct = sum(1 for r in rows if r["percentage"] is None)

    print(f"\n  TOTAL ROWS PARSED:    {len(rows):>6}")
    print(f"  UNIQUE TICKERS:       {len(tickers):>6}")
    print(f"  CONTROLLING (≥5%):    {controlling:>6}")
    print(f"  ROWS WITH 0 SHARES:   {zero_shares:>6}  {'(suspicious — column drift?)' if zero_shares > len(rows) * 0.1 else ''}")
    print(f"  ROWS WITH NULL %:     {null_pct:>6}  {'(suspicious — column drift?)' if null_pct > len(rows) * 0.1 else ''}")

    print("\n  STATUS BREAKDOWN:")
    for s, c in statuses.most_common():
        print(f"    {s:<10} {c:>6}")

    print("\n  ENTITY-TYPE BREAKDOWN:")
    for et, c in entity_types.most_common():
        print(f"    {et:<14} {c:>6}")

    print("\n  TOP 15 TICKERS BY ROW COUNT:")
    for t, c in tickers.most_common(15):
        print(f"    {t:<8} {c:>4} rows")

    # ─── Sample rows ─────────────────────────────────────────────────
    print(f"\n  SAMPLE — first {min(args.limit, len(rows))} rows:")
    print(f"  {'TICKER':<8}{'STATUS':<7}{'ENTITY':<14}{'SHARES':>15}  {'PCT':>7}  HOLDER")
    print(f"  {'─' * 8}{'─' * 7}{'─' * 14}{'─' * 15}  {'─' * 7}  {'─' * 40}")
    for r in rows[: args.limit]:
        pct_str = f"{float(r['percentage']):.2f}%" if r["percentage"] else "—"
        holder = (r["holder_name"] or "")[:50]
        flag = " 👑" if r["is_controlling"] else ""
        print(f"  {r['ticker']:<8}{r['status']:<7}{(r['entity_type'] or '—'):<14}{r['shares']:>15,}  {pct_str:>7}  {holder}{flag}")

    # ─── SID summary ─────────────────────────────────────────────────
    print(f"\n  Parsing SID summary rows…")
    sid_rows = list(parse_sid_summary(pdf_path, snapshot))
    print(f"  SID ROWS:             {len(sid_rows):>6}")
    if sid_rows:
        print(f"\n  SAMPLE — first 10 SID rows:")
        for r in sid_rows[:10]:
            print(f"    {r['ticker']:<8} sid={r['sid_count']:>10,}  scripless={r.get('scripless_pct') or '—'}")

    print(f"\n{'═' * 78}\n")
    print("  Parse looks healthy if: zero_shares < 10% and null_pct < 10%.")
    print("  If you see suspicious counts, paste the first 30 rows above for tuning.\n")


if __name__ == "__main__":
    main()
