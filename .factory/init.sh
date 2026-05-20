#!/bin/bash
# Factory init.sh — runs at the start of each worker session
# Must be idempotent — safe to run multiple times

set -e

echo "[init] Setting up environment..."

# Ensure Node.js 20 is active
if command -v nvm &> /dev/null; then
  nvm use 2>/dev/null || true
fi

# Install dependencies if node_modules is missing or outdated
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
  echo "[init] Installing dependencies..."
  npm install
fi

# Generate Prisma client (always — fast if already generated)
echo "[init] Generating Prisma client..."
npm run db:generate 2>/dev/null || true

# Check PostgreSQL is available
if pg_isready -h localhost -p 5432 &>/dev/null; then
  echo "[init] PostgreSQL is running on :5432"
else
  echo "[init] WARNING: PostgreSQL not detected on :5432. Some features may not work."
fi

echo "[init] Environment ready."
