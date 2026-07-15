---
name: fix-e2e-test
description: Fix a specific flaky or failing Positron e2e test. Given a test name, surface its recent failure modes over a lookback window, pull the evidence (trace, screenshots, logs) for each distinct mode, and give a test-drift vs. product-regression read plus a concrete fix or bug repro. Test-centric counterpart to e2e-failure-analyzer (which is run-centric).
disable-model-invocation: true
---

# Fix E2E Test

Test-centric triage: start from a test name (not a CI run), find its recent
distinct failure modes, fetch the evidence for each, and decide fix-the-test vs.
file-a-bug.

## When to Use

- You picked up a specific flaky or failing e2e test to fix.
- You want its recent failure history and evidence without hunting for the runs
  by hand.

For triaging a whole CI run instead, use `e2e-failure-analyzer` (run-centric).

## Prerequisites

- `E2E_INSIGHTS_API_KEY` set (for the history query).
- Node.js and `unzip` on PATH (the S3 processor extracts zip attachments).

## Scripts

This skill reuses the `e2e-failure-analyzer` scripts verbatim (no copies). Run
them from the positron repo root:

- `.claude/skills/e2e-failure-analyzer/scripts/e2e-query-history.js` - queries
  the `test-health` API. Call with `--occurrences-per-pattern 2` to get
  representative occurrences (with their S3 report URLs) per failure pattern.
- `.claude/skills/e2e-failure-analyzer/scripts/e2e-process-s3.js` - given a
  CloudFront report URL, downloads and parses the trace, screenshots,
  error-context page snapshot, and mines the logs.

## Input

A test name or spec path. Optional: `--branch` (default `main`) and
`--lookback-days` (default 14, max 30).

## Steps

### 1. Build the test key

The API keys tests as `testName|||specPath`. If you only have a partial name,
grep `test/e2e/tests/` to find the exact title and spec path first.

### 2. Query failure history

```bash
node .claude/skills/e2e-failure-analyzer/scripts/e2e-query-history.js \
  --repo positron \
  --test-keys "<testName>|||<specPath>" \
  --branch main \
  --lookback-days 14 \
  --occurrences-per-pattern 2
```

The response's `failure_patterns[]` is your map: each entry is a distinct
failure mode (count-descending), with `count`, `percentage`, and up to two
representative `occurrences` carrying `sha`, `os`, `browser`, `outcome`
(`failed` | `flaky`), `run_url`, and `report_url`.

If the response is `{}` the API was unreachable (or the key is unset); say so
and stop rather than guessing.

If the test has no failures or flakes in the window (`failure_patterns` is empty
and `history` shows a clean record), report the clean bill of health -- "no
failures for this test in the last N days on `<branch>`" -- and stop. There is
nothing to triage.

### 3. Summarize the failure modes FIRST

Before downloading anything, present the shape so the engineer can triage:

> Test X has 2 distinct failure modes over 14 days:
> (a) locator timeout on chromium x8, (b) kernel-startup error on win x3.

### 4. Pull evidence per pattern

For each pattern's representative `report_url`, run the S3 processor. The API's
`report_url` ends in `/index.html`, but `e2e-process-s3.js --report-url` expects
the base **directory** URL (it appends `index.html` itself, so passing the full
URL yields a malformed `.../index.html/index.html`). Strip the trailing
`index.html` first:

```bash
# report_url = https://d38p2avprg8il3.cloudfront.net/playwright-report-.../index.html
base_url="${report_url%index.html}"   # -> https://d38p2avprg8il3.cloudfront.net/playwright-report-.../
node .claude/skills/e2e-failure-analyzer/scripts/e2e-process-s3.js \
  --report-url "$base_url" \
  --output-dir <scratch-dir>/<pattern-n> \
  --cleanup
```

This yields the trace timeline, screenshots, the error-context page snapshot,
and mined log excerpts for that mode.

If an occurrence has `report_url: null`, state it explicitly (e.g. "3 of 8
occurrences have no report available") rather than assuming the pattern is fully
covered by the reports that do exist.

### 5. Fix-oriented verdict per pattern

For each failure mode:

1. State what it is, citing the evidence (trace step, log line, screenshot).
2. Give a **test-drift vs. product-regression** read. The error-context page
   snapshot is the key signal: did the test's locator drift (the element moved,
   was renamed, or the selector is stale) while the product still works -> fix
   the test; or did the product actually break (the expected state never
   appears in the snapshot) -> product regression.
3. Then either propose a concrete test fix, or, if it is a product bug, give the
   repro and recommend filing an issue.

## Non-goals

- No new S3 uploads or API changes -- consumes the existing `test-health`
  endpoint and existing S3 reports.
- No changes to `e2e-process-s3.js` or the `e2e-failure-analyzer` skill.
- No run-level triage -- that is `e2e-failure-analyzer`'s job.
