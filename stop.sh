#!/usr/bin/env bash
# Remora Trading Tools - Stop Script (Bash/WSL)
# Usage: ./stop.sh

echo ""
echo "🦈 Stopping Remora Trading Tools..."

# Find and kill uvicorn processes
pkill -f "uvicorn app.main:app" 2>/dev/null && echo "   ✅ uvicorn stopped" || echo "   ℹ️  No uvicorn process found"

echo ""
echo "🦈 Remora Trading Tools stopped."