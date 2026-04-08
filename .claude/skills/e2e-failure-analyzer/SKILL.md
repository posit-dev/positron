---
name: e2e-failure-analyzer
description: Analyze e2e test failures from a GitHub Actions run. Provide a run ID or URL to download reports, extract traces/screenshots/logs, identify root causes, and get suggested actions. Works with both posit-dev/positron and posit-dev/positron-builds repos.
disable-model-invocation: true
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

Scripts live alongside this skill in `scripts/`. Use the base directory path shown above when the skill loads (the "Base directory for this skill: ..." line) as `$SKILL_DIR`. Scripts require Node.js and are cross-platform (Windows via Git Bash, macOS, Linux). The `e2e-inspect-blobs.js` script requires `unzip` to be available in PATH (included in Git Bash on Windows).

- **`e2e-extract-failures.js`** - Extracts failures from a merged Playwright JSON report
- **`e2e-parse-trace.js`** - Parses a `trace.trace` file into an action timeline with errors and last screenshot hash
- **`e2e-inspect-blobs.js`** - Scans blob report zips to find failed test IDs and their trace/log resource hashes
- **`e2e-query-history.js`** - Queries the e2e-test-insights API for historical test health data (requires `E2E_INSIGHTS_API_KEY` env var)

## Input

Run ID or URL from either repo:
- `https://github.com/posit-dev/positron/actions/runs/23610137774`
- `https://github.com/posit-dev/positron-builds/actions/runs/23938334846`

## Step 1: Parse Input, Enumerate Failed Jobs, and Determine Repo

Extract the run ID and repo from the URL. The two repos have different data access patterns:

- **`posit-dev/positron`**: Uses sharded blob reports uploaded as GitHub artifacts. Requires downloading and merging.
- **`posit-dev/positron-builds`**: Non-sharded single-job runs. HTML reports uploaded to S3 at CloudFront. No blob report artifacts.

```bash
# Get run metadata (including branch for history queries)
gh api repos/<REPO>/actions/runs/<RUN_ID> --jq '{name: .name, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha, branch: .head_branch}'
```

### Step 1a: List ALL failed jobs

Before diving into e2e reports, get the full picture of what failed:

```bash
gh api repos/<REPO>/actions/runs/<RUN_ID>/jobs --paginate \
  --jq '.jobs[] | select(.conclusion == "failure") | {id: .id, name: .name}'
```

Categorize each failed job:
- **e2e jobs** (name contains `e2e`): Analyze with Path A or B below
- **Non-e2e jobs** (e.g., `test / unit`, `test / integration`, `setup / build`): Report in the summary with a link to the job logs. Extract the failure reason from the job logs:
  ```bash
  gh api repos/<REPO>/actions/jobs/<JOB_ID>/logs 2>&1 | grep -E "(FAIL|Error|error:|##\[error\])" | tail -20
  ```

### Step 1b: Find blob report artifacts for all e2e projects

```bash
gh api repos/<REPO>/actions/runs/<RUN_ID>/artifacts --jq '.artifacts[] | select(.name | test("^blob-report-")) | .name' | sort
```

Group by project: extract unique project names from artifact names (e.g., `blob-report-e2e-chromium-1` -> `e2e-chromium`, `blob-report-e2e-windows-1` -> `e2e-windows`). Process **all** projects that have blob reports, not just one.

- If blob reports found -> use **Path A** (positron repo flow) for each project
- If no blob reports found -> use **Path B** (positron-builds flow)

---

## Path A: posit-dev/positron (Sharded Blob Reports)

Repeat the steps below for **each** e2e project that has blob report artifacts (e.g., `e2e-windows`, `e2e-electron`, `e2e-chromium`). Download all projects in parallel, then merge and analyze each.

### A1: Download and Merge Reports

```bash
gh run download <RUN_ID> --repo posit-dev/positron \
  -p "blob-report-<PROJECT>-*" -D /tmp/blob-reports-<PROJECT>

mkdir -p /tmp/blob-merged-<PROJECT>
cp /tmp/blob-reports-<PROJECT>/blob-report-<PROJECT>-*/* /tmp/blob-merged-<PROJECT>/

PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/report-<PROJECT>.json \
  npx playwright merge-reports --reporter=json /tmp/blob-merged-<PROJECT>
```

Run downloads in parallel for multiple projects. Merge sequentially (npx changes cwd).

### A2: Extract Failure Details from JSON Report

```bash
node "$SKILL_DIR/scripts/e2e-extract-failures.js" /tmp/report-<PROJECT>.json
```

Outputs a JSON array with each failure's title, file, tags, suite, project, and error details.

### A3: Extract Traces, Screenshots, and Logs from Blob Reports

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

Use the failed e2e jobs already identified in Step 1a. For each failed e2e job:

### B1: Extract Failure Details from Job Logs

The job logs contain full Playwright test output including error messages, stack traces, and attachment paths:

```bash
gh api repos/posit-dev/positron-builds/actions/jobs/<JOB_ID>/logs 2>&1 | grep -A 20 -E "^\s+\d+\) \[" | head -100
```

This gives the full test failure output including:
- Test name and tags
- Error messages and stack traces
- Attachment paths (trace, logs, screenshots)

### B2: Get Report URL from Job Logs

The job log contains the S3 report URL:

```bash
gh api repos/posit-dev/positron-builds/actions/jobs/<JOB_ID>/logs 2>&1 | grep -oE 'REPORT_DIR=playwright-report-[^ ]+' | head -1
```

The base URL pattern is: `https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/`

### B3: Download Screenshots from S3

The HTML report's `data/` directory contains PNGs (on-test-end screenshots) and ZIPs (traces, logs). Find PNG filenames from the upload log:

```bash
gh api repos/posit-dev/positron-builds/actions/jobs/<JOB_ID>/logs 2>&1 | grep -oE 'data/[a-f0-9]+\.png' | sort -u
```

Download and view each PNG with the Read tool:
```bash
curl -s -o /tmp/pw-screenshot-N.png "https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/data/<HASH>.png"
```

There are typically only 5-15 PNGs per job (one per failed/flaky test attempt). Download all and view them.

### B4: Download Traces from S3

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

### B5: Download Logs from S3

Logs zips are typically 300-500KB and contain `e2e-test-runner.log`, `main.log`, `window1/` directory, etc:

```bash
curl -s -o /tmp/pw-logs.zip "https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/data/<HASH>.zip"
unzip -l /tmp/pw-logs.zip | head -5  # Should show e2e-test-runner.log, main.log, etc.
```

---

## Step 6: Query Historical Test Health (optional)

If the `E2E_INSIGHTS_API_KEY` environment variable is set, query the e2e-test-insights dashboard for historical failure data. This step is optional -- if the API is unavailable, skip it and proceed with analysis.

The repo identifier for the API is always `positron` for both `posit-dev/positron` and `posit-dev/positron-builds`. Both repos run the same tests (positron-builds uses positron as a submodule) and test results are stored under the `positron` repo ID in the dashboard.

### Option 1: Query by workflow run ID (preferred)

If the GitHub run ID is available, use `--run-id` to get history for all tests that failed or flaked in this run:

```bash
node "$SKILL_DIR/scripts/e2e-query-history.js" --repo positron --run-id <RUN_ID> --lookback-days 14 --branch <BRANCH>
```

The branch is important -- a test may be `rare_flake` on `main` but `known_flaky` on a release branch. Get the branch from the run metadata (Step 1) or the `onProject` event in blob reports. Common branches: `main`, `release/YYYY.MM`.

### Option 2: Query by test keys

If the run isn't in the dashboard yet, construct test keys manually from extracted failures:

```bash
node "$SKILL_DIR/scripts/e2e-query-history.js" --repo positron \
  --test-keys "testName1|||specPath1,testName2|||specPath2" --lookback-days 14
```

### Using the history in analysis

The response includes per-test data. Use it to enhance the analysis:

- **`insight.type`**: `"new"` = first-time failure (likely regression), `"recurring"` / `"known_flaky"` = known pattern, `"rare_flake"` = infrequent
- **`history.pass_rate`**: Low pass rate = known flaky test, 100% pass rate before this run = regression
- **`failure_patterns`**: Compare today's error message against historical patterns -- same pattern = recurring, new pattern = potential regression even for known-flaky tests
- **`insight.first_failure_sha`** / **`insight.timing_value`**: When the failures started -- useful for bisecting

#### Interpreting `environment_breakdown` -- look across environments

The `environment_breakdown` array is often more informative than the aggregate `history` stats. **Always check per-environment pass rates** before concluding a test is "flaky":

- **0% pass rate on one environment, 100% on others** = deterministic regression on that platform, NOT flaky. Example: a test failing on all chromium runs but passing on all electron runs is a chromium-specific bug, even if the aggregate pass rate is 58%.
- **Low pass rate across all environments** = genuinely flaky
- **Low pass rate on one environment only** = platform-specific flakiness (e.g., "worse on win/electron")

When the breakdown reveals an environment-specific pattern, call it out explicitly:
- "History: **100% failure on chromium** (0/4 passed), 100% pass on electron (6/6) -- deterministic regression on chromium, not flaky"
- "History: known flaky across all platforms, worst on win/electron (88% pass rate)"

#### History line format

Include a **History** line in each failure's analysis, e.g.:
- "History: failed 4/18 runs (22%) over last 14 days, same error pattern -- known flaky"
- "History: passed 15/15 runs over last 14 days -- **new regression**"
- "History: **0% pass rate on chromium** (10/10 failed since Apr 02), 100% on electron -- deterministic platform regression"
- "History: no data available (API unreachable)"

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

### Check the triggering commit

For tests that **failed all retries** (not just flaky), inspect the head commit (from the `head_sha` in Step 1) to assess whether it could have caused the failure:

```bash
gh api repos/<REPO>/commits/<HEAD_SHA> --jq '{message: .commit.message, author: .commit.author.name, files: [.files[].filename]}'
```

Compare the changed files against:
- **The failing test file itself** and its page objects/helpers -- changes here could introduce a test logic bug
- **Product source code exercised by the test** -- changes to the feature under test could be a real product regression that the test correctly caught
- **Shared infrastructure** (startup, layout, rendering) -- changes here could alter timing or behavior enough to surface a latent flaky test

If the commit touched relevant files, read the diff and assess causality. A commit that modifies notebook cell rendering is a plausible cause for a notebook cell-count assertion failure, even if the test has flaked before. Conversely, a commit that only changes R interpreter code is unlikely to cause a Python plot test failure.

Include a **Commit** line in the detailed analysis when the commit is relevant, e.g.:
- "Commit: modified `notebookCellList.ts` (notebook cell rendering) -- **plausible cause**"
- "Commit: no files related to this test's feature area -- unlikely cause"

### Additional repo context

Also use context from the repo when helpful:
- Read the failing test file to understand what it does
- Check `git log` for recent changes to the test or related product code beyond the head commit
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

Include **non-e2e job failures** (unit tests, integration tests, build failures) in the summary table as well, with the job name as the test name and a brief description of the failure extracted from the job logs.

Offer to:
- Open the relevant test files
- Search for related recent changes
- Create GitHub issues

## Cleanup

```bash
rm -rf /tmp/blob-reports-* /tmp/blob-merged-* /tmp/blob-jsonl-* /tmp/report-*.json /tmp/trace-extract /tmp/trace-contents /tmp/logs-extract /tmp/logs-contents /tmp/blob-inspect* /tmp/pw-screenshot-* /tmp/pw-trace* /tmp/pw-logs* /tmp/pw-report*
```
