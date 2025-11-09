#!/usr/bin/env bash
set -euo pipefail

# Compression benchmark script for CI. Creates artifacts with gzip -1, pigz (if available),
# and zstd (if available), then measures extract and chown times.

ROOT_DIR="$(pwd)"
ARTDIR="/tmp/artifacts"
EXDIR="/tmp/extracts"
REPO_BASE="$(basename "$ROOT_DIR")"

mkdir -p "$ARTDIR" "$EXDIR"

echo "Starting compression benchmark in: $ROOT_DIR"
echo "Artifacts: $ARTDIR, Extracts: $EXDIR"

time_ms() { date +%s%3N; }

echo "Commands available: pigz: $(command -v pigz || echo 'missing'), zstd: $(command -v zstd || echo 'missing')"

# Ensure tools are present where possible (tolerant)
if command -v apt-get >/dev/null 2>&1; then
  echo "Installing pigz and zstd (if not present)"
  DEBIAN_FRONTEND=noninteractive apt-get update -y || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y pigz zstd || true
fi

echo; echo "=== gzip -1 ==="
start=$(time_ms)
GZIP=-1 tar -C "$(dirname "$ROOT_DIR")" -czf "$ARTDIR/${REPO_BASE}-gzip.tar.gz" "$REPO_BASE" --exclude='.git' || true
end=$(time_ms)
echo "Compress time: $((end-start)) ms"
ls -lh "$ARTDIR/${REPO_BASE}-gzip.tar.gz" || true

if command -v pigz >/dev/null 2>&1; then
  echo; echo "=== pigz ==="
  start=$(time_ms)
  tar -C "$(dirname "$ROOT_DIR")" --use-compress-program=pigz -cf "$ARTDIR/${REPO_BASE}-pigz.tar.gz" "$REPO_BASE" --exclude='.git' || true
  end=$(time_ms)
  echo "Compress time: $((end-start)) ms"
  ls -lh "$ARTDIR/${REPO_BASE}-pigz.tar.gz" || true
else
  echo "pigz not available; skipped"
fi

if command -v zstd >/dev/null 2>&1; then
  echo; echo "=== zstd -T0 -3 ==="
  start=$(time_ms)
  tar -C "$(dirname "$ROOT_DIR")" --use-compress-program='zstd -T0 -3' -cf "$ARTDIR/${REPO_BASE}-zstd.tar.zst" "$REPO_BASE" --exclude='.git' || true
  end=$(time_ms)
  echo "Compress time: $((end-start)) ms"
  ls -lh "$ARTDIR/${REPO_BASE}-zstd.tar.zst" || true
else
  echo "zstd not available; skipped"
fi

echo; echo "Extraction and chown timings"
for f in "$ARTDIR"/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  ex="$EXDIR/${name%.tar*}"
  rm -rf "$ex"
  mkdir -p "$ex"
  echo; echo "=== extract $name ==="
  start=$(time_ms)
  case "$name" in
    *.tar.gz) tar -xzf "$f" -C "$ex" ;;
    *.tar.zst) zstd -d --stdout "$f" | tar -x -C "$ex" ;;
    *.tar) tar -xf "$f" -C "$ex" ;;
    *) echo "unknown format $name"; continue ;;
  esac
  end=$(time_ms)
  echo "Extract time: $((end-start)) ms"
  echo "Extract size:"; du -sh "$ex" || true

  echo "Measuring chown -R time (simulate CI chown)"
  start=$(time_ms)
  chown -R "$(id -u):$(id -g)" "$ex" || true
  end=$(time_ms)
  echo "Chown time: $((end-start)) ms"
done

echo; echo "Benchmark complete. Artifacts:"
ls -lah "$ARTDIR" || true
echo "Extracts:"
ls -lah "$EXDIR" || true

exit 0
