#!/usr/bin/env bash
#
# update-news.sh — record the PWB Code Server and Code OSS versions in
# rstudio-pro's release notes.
#
# Inserts (or replaces, if already present) a single line under the
# "### Dependencies" heading of the given NEWS file:
#
#   - PWB Code Server <pwb-version>, Code OSS <code-oss-version>
#
# Usage: update-news.sh <news-file> <pwb-version> <code-oss-version>
#
# When changing this script, validate the output by hand with its test:
#
#   bash .github/scripts/update-news.test.sh
#
# The test prints a before/after of the Dependencies section for each case
# and exits non-zero on failure. It is not run by CI.

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: update-news.sh <news-file> <pwb-version> <code-oss-version>" >&2
  exit 1
fi

news_file="$1"
pwb_version="$2"
code_oss_version="$3"

if [ ! -f "$news_file" ]; then
  echo "error: NEWS file not found: $news_file" >&2
  exit 1
fi

if [ -z "$pwb_version" ]; then
  echo "error: PWB Code Server version is empty" >&2
  exit 1
fi

if [ -z "$code_oss_version" ]; then
  echo "error: Code OSS version is empty" >&2
  exit 1
fi

if ! grep -q '^### Dependencies' "$news_file"; then
  echo "error: no '### Dependencies' heading in $news_file" >&2
  exit 1
fi

version_line="- PWB Code Server ${pwb_version}, Code OSS ${code_oss_version}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Single awk pass: drop any existing version line, then insert the fresh one
# immediately after the "### Dependencies" heading. Dropping first and
# re-inserting keeps the operation idempotent.
awk \
  -v version_line="$version_line" '
  /^- PWB Code Server / { next }
  {
    print
    if ($0 ~ /^### Dependencies/) {
      print version_line
    }
  }
' "$news_file" > "$tmp"

cat "$tmp" > "$news_file"
