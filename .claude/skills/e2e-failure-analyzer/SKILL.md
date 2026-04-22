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

Scripts live alongside this skill in `scripts/`. Use the base directory path shown above when the skill loads (the "Base directory for this skill: ..." line) as `$SKILL_DIR`. Scripts require Node.js and are cross-platform (Windows via Git Bash, macOS, Linux). Scripts that extract from zip files require `unzip` to be available in PATH (included in Git Bash on Windows).

### Consolidated scripts (preferred -- fewer tool calls)

- **`e2e-gather-run-info.js`** - Gathers all run metadata, failed jobs, artifacts, non-e2e job log excerpts, and commit info in one call. Replaces multiple `gh api` invocations.
- **`e2e-process-project.js`** - Processes a merged blob report project end-to-end: extracts failures, scans blobs, extracts/parses traces, extracts screenshots and error-context. Replaces multiple script + unzip invocations.

### Standalone scripts (used by consolidated scripts internally, or for ad-hoc debugging)

- **`e2e-extract-failures.js`** - Extracts failures from a merged Playwright JSON report
- **`e2e-parse-trace.js`** - Parses a `trace.trace` file into an action timeline with errors and last screenshot hash
- **`e2e-inspect-blobs.js`** - Scans blob report zips to find failed test IDs and their trace/log resource hashes
- **`e2e-query-history.js`** - Queries the e2e-test-insights API for historical test health data (requires `E2E_INSIGHTS_API_KEY` env var)

## Input

Run ID or URL from either repo:
- `https://github.com/posit-dev/positron/actions/runs/23610137774`
- `https://github.com/posit-dev/positron-builds/actions/runs/23938334846`

## Step 1: Gather Run Info (single script call)

The consolidated `e2e-gather-run-info.js` script handles everything: run metadata, failed jobs, blob report artifacts, non-e2e job log excerpts, and commit info.

```bash
node "$SKILL_DIR/scripts/e2e-gather-run-info.js" <RUN_URL>
```

Output JSON contains:
- `repo`, `runId` - parsed from URL
- `run` - metadata (name, conclusion, html_url, head_sha, branch)
- `failedJobs` - array of `{id, name, isE2e}` for all failed jobs
- `nonE2eJobLogs` - map of job ID to failure log excerpts (for non-e2e jobs)
- `artifacts` - sorted list of blob report artifact names
- `projects` - unique project names extracted from artifacts (e.g., `e2e-chromium`, `e2e-windows`)
- `commit` - `{message, author, files}` for the head commit

Use `projects` to determine what to process:
- If projects list is non-empty -> use **Path A** (positron repo flow) for each project
- If empty -> use **Path B** (positron-builds flow)

The two repos have different data access patterns:
- **`posit-dev/positron`**: Uses sharded blob reports uploaded as GitHub artifacts. Requires downloading and merging.
- **`posit-dev/positron-builds`**: Non-sharded single-job runs. HTML reports uploaded to S3 at CloudFront. No blob report artifacts.

---

## Path A: posit-dev/positron (Sharded Blob Reports)

### A1+A2: Download, Merge, and Process (single script call)

The `e2e-process-project.js` script handles everything in one call: downloads blob report artifacts, copies shards into a merged directory, runs `npx playwright merge-reports`, then extracts failures, scans blobs, extracts/parses traces, and extracts screenshots. Use `--cleanup` to remove intermediate download/merge artifacts automatically.

For **each** project from Step 1, run:

```bash
node "$SKILL_DIR/scripts/e2e-process-project.js" \
  --download --run-id <RUN_ID> --repo <REPO> --project <PROJECT> \
  --output-dir /tmp/e2e-analysis-<PROJECT> --cleanup
```

If there are multiple projects, run them sequentially (each call uses npx internally).

**Fallback**: If blob reports were already downloaded and merged (e.g., for debugging), you can skip `--download` and pass the directories directly:

```bash
node "$SKILL_DIR/scripts/e2e-process-project.js" \
  /tmp/blob-merged-<PROJECT> /tmp/report-<PROJECT>.json \
  --output-dir /tmp/e2e-analysis-<PROJECT>
```

Output JSON contains:
- `outputDir` - path where screenshots and error-context files were saved
- `failures` - array of final failures (tests that failed all retries) with title, file, tags, suite, project, errors
- `failedTests` - array of all failed test attempts (including those that passed on retry) with testId, title, file, status, blob
- `testDetails` - array of per-test objects, each containing:
  - `testId`, `title`, `file`, `status`, `blob`, `attemptCount`
  - `attempts` - array of per-attempt objects with:
    - `trace` - parsed trace data: `timeline` (human-readable string), `errors` (array), `lastScreenshotSha1`
    - `screenshotPath` - path to extracted last screenshot JPEG (view with Read tool)
    - `errorContextPath` - path to extracted page snapshot markdown (view with Read tool if needed)
  - `logHashes` - array of `{resourceHash, blob}` for logs (extract manually if needed)

**IMPORTANT: View screenshots** using the `screenshotPath` fields with the Read tool. You MUST Read **all** screenshots in a **single message** with multiple parallel Read tool calls -- this results in only one approval prompt instead of one per screenshot. View all attempts; comparing across retries reveals whether a failure is consistent or intermittent. Screenshots are the most revealing evidence for diagnosing failures.

**View error context** with the Read tool using `errorContextPath` paths if the screenshot and trace timeline are insufficient for diagnosis.

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

For tests that **failed all retries** (not just flaky), inspect the head commit using the `commit` field from Step 1's `e2e-gather-run-info.js` output (already includes message, author, and changed files).

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

Present the analysis in a summary table that includes columns for: test name, platform, root cause category, and severity. In the severity column, clearly distinguish tests that **failed all retries** (hard failures) from tests that **passed on retry** (flaky). This distinction comes from comparing `failures` (final failures after all retries) vs `failedTests` (all attempts including those that recovered). Then provide detailed analysis for each failure below the table.

Include **non-e2e job failures** (unit tests, integration tests, build failures) in the summary table as well, with the job name as the test name and a brief description of the failure extracted from the job logs.

Offer to:
- Open the relevant test files
- Search for related recent changes
- Create GitHub issues

## Cleanup

**Path A**: If you used `--cleanup` with `e2e-process-project.js`, the download/merge artifacts are already removed. Only the `--output-dir` remains (screenshots and error-context). Remove it with exact paths (no globs):

```bash
rm -rf /tmp/e2e-analysis-<PROJECT>
```

**Path B**: Remove artifacts with exact paths:
```bash
rm -rf /tmp/pw-screenshots /tmp/pw-traces /tmp/pw-logs
```
