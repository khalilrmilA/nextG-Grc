#!/usr/bin/env bash
# Build the GRCEye product datasheet PDF from its hand-written HTML source.
#   Source : frontend/public/GRCEye_Datasheet_2026.html (logo-horizontal.png is relative to it)
#   Output : GRCEye_Datasheet_2026.pdf at the repo root (or $1), then copied to
#            frontend/public/datasheets/ and marketing/public/datasheets/ (skip with NO_COPY=1).
# Needs google-chrome and network access (Inter is loaded from Google Fonts).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/frontend/public/GRCEye_Datasheet_2026.html"
OUT="${1:-$ROOT/GRCEye_Datasheet_2026.pdf}"
cd "$ROOT/frontend/public"
google-chrome --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer \
  --run-all-compositor-stages-before-draw --virtual-time-budget=15000 \
  --print-to-pdf="$OUT" "file://$SRC"
if [ "${NO_COPY:-0}" != "1" ]; then
  for d in "$ROOT/frontend/public/datasheets" "$ROOT/marketing/public/datasheets"; do
    mkdir -p "$d"; cp "$OUT" "$d/GRCEye_Datasheet_2026.pdf"
  done
fi
command -v pdfinfo >/dev/null && pdfinfo "$OUT" | grep -E '^Pages' || true
