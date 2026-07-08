#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
TOKEN="${GITHUB_TOKEN:-xyz}"               # set GITHUB_TOKEN in env, or replace xyz
OWNER="posit-dev"
REPO="positron-builds"
# Optional: set TAG to force a specific release (e.g., TAG=2025.10.0-88)
TAG="${TAG:-}"                             

# Detect/override architecture suffix for asset name
# (arm64 -> arm64, x86_64/amd64 -> x64)
if [[ -n "${ARCH_SUFFIX:-}" ]]; then
  case "$ARCH_SUFFIX" in
    amd64|x86_64)  ARCH="x64"   ;;
    *)             ARCH="$ARCH_SUFFIX" ;;
  esac
else
  case "$(uname -m)" in
    aarch64|arm64) ARCH="arm64" ;;
    x86_64|amd64)  ARCH="x64"   ;;
    *) echo "Unsupported arch: $(uname -m)"; exit 1 ;;
  esac
fi

api() {
  curl -fsSL \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

# --- Get release JSON: latest or by tag ---
if [[ -n "$TAG" ]]; then
  echo "Fetching release by tag: $TAG"
  rel_json="$(api "https://api.github.com/repos/$OWNER/$REPO/releases/tags/$TAG")"
else
  echo "Fetching latest release list (index 0)"
  # releases API returns an array; pick the first (most recent)
  releases="$(api "https://api.github.com/repos/$OWNER/$REPO/releases")"
  rel_json="$(printf '%s' "$releases" | jq '.[0]')"
  TAG="$(printf '%s' "$rel_json" | jq -r '.tag_name')"
fi

echo "Selected release tag: $TAG"

# --- Pick the Workbench server tarball for our arch ---
# Expected pattern: positron-workbench-linux-<arch>-<tag>.tar.gz
asset_json="$(printf '%s' "$rel_json" | jq -r --arg arch "$ARCH" '
  .assets[]
  | select(.name
      | test("^positron-workbench-linux-" + $arch + "-[0-9.\\-]+\\.tar\\.gz$"))
')"

if [[ -z "$asset_json" ]]; then
  echo "No matching Workbench tarball found for arch '$ARCH' in release $TAG"
  echo "Available assets:"
  printf '%s' "$rel_json" | jq -r '.assets[].name'
  exit 1
fi

name="$(printf '%s' "$asset_json" | jq -r '.name')"
asset_api_url="$(printf '%s' "$asset_json" | jq -r '.url')"
size="$(printf '%s' "$asset_json" | jq -r '.size')"

echo "Downloading asset: $name (size: ${size} bytes) via Assets API..."
curl -fL --retry 3 --retry-all-errors \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/octet-stream" \
  -o "$name" \
  "$asset_api_url"

tar -xzf "$name" --strip-components=1