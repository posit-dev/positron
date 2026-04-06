---
name: e2e-failure-analyzer
description: Analyze e2e test failures from a GitHub Actions run. Provide a run ID or URL to download reports, extract traces/screenshots/logs, identify root causes, and get suggested actions. Works with both posit-dev/positron and posit-dev/positron-builds repos.
---

# E2E Failure Analyzer

Analyzes Playwright e2e test failures from a GitHub Actions run using JSON reports, trace files, screenshots, and test logs to identify root causes and suggest next actions.

## When to Use

- A CI run has failed and you want to understand why
- Triaging e2e test failures from `Test: Merge to branch`, `Test: Full Suite`, or `Positron Build: Daily Release`
- Investigating flaky tests from a specific run

## Prerequisites

- GitHub CLI (`gh`) authenticated
- `@playwright/test` available via npx (for merging blob reports, positron repo only)

## Helper Scripts

Scripts live alongside this skill in `scripts/` (referenced below as `$SKILL_DIR/scripts/`). Resolve `$SKILL_DIR` from the skill's base directory shown at load time. All scripts are cross-platform (Windows, macOS, Linux) and require only Node.js with no external dependencies.

- **`e2e-extract-failures.js`** - Extracts failures from a merged Playwright JSON report
- **`e2e-parse-trace.js`** - Parses a `trace.trace` file into an action timeline with errors and last screenshot hash
- **`e2e-inspect-blobs.js`** - Scans blob report zips to find failed test IDs and their trace/log resource hashes

## Input

Run ID or URL from either repo:
- `https://github.com/posit-dev/positron/actions/runs/23610137774`
- `https://github.com/posit-dev/positron-builds/actions/runs/23938334846`

## Step 1: Parse Input and Determine Repo

Extract the run ID and repo from the URL. The two repos have different data access patterns:

- **`posit-dev/positron`**: Uses sharded blob reports uploaded as GitHub artifacts. Requires downloading and merging.
- **`posit-dev/positron-builds`**: Non-sharded single-job runs. HTML reports uploaded to S3 at CloudFront. No blob report artifacts.

```bash
# Extract repo from URL (posit-dev/positron or posit-dev/positron-builds)
gh api repos/<REPO>/actions/runs/<RUN_ID> --jq '{name: .name, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha}'
```

Check for blob report artifacts:
```bash
gh api repos/<REPO>/actions/runs/<RUN_ID>/artifacts --jq '.artifacts[] | select(.name | test("^blob-report-")) | "\(.id) \(.name)"'
```

- If blob reports found -> use **Path A** (positron repo flow)
- If no blob reports found -> use **Path B** (positron-builds flow)

---

## Path A: posit-dev/positron (Sharded Blob Reports)

### A1: Download and Merge Reports

Group blob artifacts by project (e.g., `e2e-windows`, `e2e-electron`, `e2e-chromium`).

```bash
gh run download <RUN_ID> --repo posit-dev/positron \
  -p "blob-report-<PROJECT>-*" -D /tmp/blob-reports-<PROJECT>

mkdir -p /tmp/blob-merged-<PROJECT>
cp /tmp/blob-reports-<PROJECT>/blob-report-<PROJECT>-*/* /tmp/blob-merged-<PROJECT>/

PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/report-<PROJECT>.json \
  npx playwright merge-reports --reporter=json /tmp/blob-merged-<PROJECT>
```

Run downloads in parallel for multiple projects. Merge sequentially (npx changes cwd).

### A2: Check for Failures

```bash
node scripts/check-soft-fail-failures.js /tmp/report-<PROJECT>.json
```

### A3: Extract Failure Details from JSON Report

```bash
node "$SKILL_DIR/scripts/e2e-extract-failures.js" /tmp/report-<PROJECT>.json
```

Outputs a JSON array with each failure's title, file, tags, suite, project, and error details.

### A4: Extract Traces, Screenshots, and Logs from Blob Reports

Each blob zip contains `report.jsonl` and `resources/*.zip`.

**Find failed tests across all blobs:**
```bash
node "$SKILL_DIR/scripts/e2e-inspect-blobs.js" /tmp/blob-merged-<PROJECT>
```

This outputs JSON with `failedTests` (testId, title, file, status, blob).

**Find trace/log resource hashes for specific failed test IDs:**
```bash
node "$SKILL_DIR/scripts/e2e-inspect-blobs.js" /tmp/blob-merged-<PROJECT> --test-ids <TEST_ID_1>,<TEST_ID_2>
```

This outputs JSON with `attachments` (testId, name, contentType, resourceHash, blob).

**Extract and read trace:**
```bash
unzip -o /tmp/blob-merged-<PROJECT>/<BLOB>.zip "resources/<TRACE_HASH>.zip" -d /tmp/trace-extract
mkdir -p /tmp/trace-contents && cd /tmp/trace-contents
unzip -o /tmp/trace-extract/resources/<TRACE_HASH>.zip trace.trace
```

Parse the trace action timeline:
```bash
node "$SKILL_DIR/scripts/e2e-parse-trace.js" /tmp/trace-contents/trace.trace
```

Outputs the last 30 actions with selectors/errors, last screenshot sha1, and error summary. Use `--last N` to adjust.

Extract and view the last screenshot with the Read tool:
```bash
unzip -o /tmp/trace-extract/resources/<TRACE_HASH>.zip "resources/<LAST_SCREENSHOT>.jpeg" -d /tmp/trace-contents
```

**Extract logs:**
```bash
unzip -o /tmp/blob-merged-<PROJECT>/<BLOB>.zip "resources/<LOGS_HASH>.zip" -d /tmp/logs-extract
mkdir -p /tmp/logs-contents && cd /tmp/logs-contents && unzip -o /tmp/logs-extract/resources/<LOGS_HASH>.zip
```

---

## Path B: posit-dev/positron-builds (S3 HTML Reports)

### B1: Identify Failed Jobs

```bash
gh api repos/posit-dev/positron-builds/actions/runs/<RUN_ID>/jobs --paginate \
  --jq '.jobs[] | select(.conclusion == "failure") | {id: .id, name: .name}'
```

### B2: Extract Failure Details from Job Logs

The job logs contain full Playwright test output including error messages, stack traces, and attachment paths:

```bash
gh api repos/posit-dev/positron-builds/actions/jobs/<JOB_ID>/logs 2>&1 | grep -A 20 -E "^\s+\d+\) \[" | head -100
```

This gives the full test failure output including:
- Test name and tags
- Error messages and stack traces
- Attachment paths (trace, logs, screenshots)

### B3: Get Report URL from Job Logs

The job log contains the S3 report URL:

```bash
gh api repos/posit-dev/positron-builds/actions/jobs/<JOB_ID>/logs 2>&1 | grep -oE 'REPORT_DIR=playwright-report-[^ ]+' | head -1
```

The base URL pattern is: `https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/`

### B4: Download Screenshots from S3

The HTML report's `data/` directory contains PNGs (on-test-end screenshots) and ZIPs (traces, logs). Find PNG filenames from the upload log:

```bash
gh api repos/posit-dev/positron-builds/actions/jobs/<JOB_ID>/logs 2>&1 | grep -oE 'data/[a-f0-9]+\.png' | sort -u
```

Download and view each PNG with the Read tool:
```bash
curl -s -o /tmp/pw-screenshot-N.png "https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/data/<HASH>.png"
```

There are typically only 5-15 PNGs per job (one per failed/flaky test attempt). Download all and view them.

### B5: Download Traces from S3

Find trace zips by checking sizes of data/ zips (traces are typically >1MB while logs are <500KB):

```bash
# Get all data zip hashes from upload log
ZIPS=$(gh api repos/posit-dev/positron-builds/actions/jobs/<JOB_ID>/logs 2>&1 | grep -oE 'data/[a-f0-9]+\.zip' | sort -u)

# Check sizes to find traces (>1MB)
for hash in $(echo "$ZIPS" | sed 's|data/||' | head -30); do
  size=$(curl -sI "https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/data/${hash}" | grep -i content-length | awk '{print $2}' | tr -d '\r')
  [ "$size" -gt 1000000 ] 2>/dev/null && echo "$size $hash"
done | sort -rn
```

Download and verify trace zips:
```bash
curl -s -o /tmp/pw-trace.zip "https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/data/<HASH>.zip"
unzip -l /tmp/pw-trace.zip | head -5  # Should show trace.trace + resources/*.jpeg
```

Then extract and parse the trace using the same script as Path A:
```bash
mkdir -p /tmp/trace-contents && unzip -o /tmp/pw-trace.zip trace.trace -d /tmp/trace-contents
node "$SKILL_DIR/scripts/e2e-parse-trace.js" /tmp/trace-contents/trace.trace
```

Extract the last screenshot from the trace zip using the sha1 from the script output:
```bash
unzip -o /tmp/pw-trace.zip "resources/<LAST_SCREENSHOT>.jpeg" -d /tmp/trace-contents
```

### B6: Download Logs from S3

Logs zips are typically 300-500KB and contain `e2e-test-runner.log`, `main.log`, `window1/` directory, etc:

```bash
curl -s -o /tmp/pw-logs.zip "https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/data/<HASH>.zip"
unzip -l /tmp/pw-logs.zip | head -5  # Should show e2e-test-runner.log, main.log, etc.
```

---

## Step 7: Analyze and Present Results

Using all the data gathered (failures, trace actions, screenshots, logs), analyze the failures. For each failure (or group of related failures), determine:

1. **Root cause category** - one of: flaky test, infrastructure issue, product regression, test environment issue, timeout, test logic bug
2. **Brief explanation** - 1-2 sentences on what likely went wrong, referencing specific evidence from traces/screenshots/logs
3. **Suggested action** - what a developer should do next

When analyzing, consider:
- Multiple tests failing in the same file/suite likely share a root cause
- `timedOut` status often indicates flakiness or infrastructure slowness
- Errors mentioning "locator" or "expect" timeouts are usually test/product issues
- Errors during app startup (e.g., waiting for workbench) are usually infrastructure
- Check if the failing test has `:soft-fail` tag (known flaky)
- The screenshot at failure is often the most revealing piece of evidence

Also use context from the repo when helpful:
- Read the failing test file to understand what it does
- Check `git log` for recent changes to the test or related product code
- Search for related issues

Key log files to check:
- `window1/renderer.log` - Main window renderer process logs
- `window1/exthost/exthost.log` - Extension host logs
- `window1/exthost/positron.positron-supervisor/Python Kernel.log` - Python kernel logs
- `window1/exthost/positron.positron-r/R Language Pack.log` - R runtime logs
- `e2e-test-runner.log` - Test runner output
- `main.log` - Electron main process logs

For each failure, include the **platform** (OS and project/browser) where it occurred. This information comes from:
- **Path A**: The project name (e.g., `e2e-windows`, `e2e-electron`, `e2e-chromium`) and the workflow name
- **Path B**: The job name (e.g., "electron (macOS)", "electron (ubuntu)") and Playwright project in the test output (e.g., `[e2e-macOS-ci]`)

When multiple projects/platforms are analyzed in a single run, note which platforms each failure occurred on and whether the same test passed on other platforms.

Present the analysis in a summary table that includes columns for: test name, platform, root cause category, and severity. Then provide detailed analysis for each failure below the table.

Offer to:
- Open the relevant test files
- Search for related recent changes
- Create GitHub issues

## Cleanup

```bash
rm -rf /tmp/blob-reports-* /tmp/blob-merged-* /tmp/blob-jsonl-* /tmp/report-*.json /tmp/trace-extract /tmp/trace-contents /tmp/logs-extract /tmp/logs-contents /tmp/blob-inspect* /tmp/pw-screenshot-* /tmp/pw-trace* /tmp/pw-logs* /tmp/pw-report*
```
