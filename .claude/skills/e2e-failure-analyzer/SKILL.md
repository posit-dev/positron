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
- Triaging a whole run's hard failures (for deep per-test investigation of one flaky/failing test, use the `triage-e2e-test` skill instead)

## Prerequisites

- GitHub CLI (`gh`) authenticated
- `@playwright/test` available via npx (for merging blob reports, positron repo only)

## Helper Scripts

Scripts live alongside this skill in `scripts/`. Use the base directory path shown above when the skill loads (the "Base directory for this skill: ..." line) as `$SKILL_DIR`. Scripts require Node.js and are cross-platform (Windows via Git Bash, macOS, Linux). Scripts that extract from zip files require `unzip` to be available in PATH (included in Git Bash on Windows).

### Consolidated scripts (preferred -- fewer tool calls)

- **`e2e-gather-run-info.js`** - Gathers all run metadata, failed jobs, artifacts, non-e2e job log excerpts, and commit info in one call. Replaces multiple `gh api` invocations.
- **`e2e-process-project.js`** - **Path A.** Processes a merged blob report project end-to-end: extracts failures, scans blobs, extracts/parses traces, extracts screenshots and error-context. Replaces multiple script + unzip invocations.
- **`e2e-process-s3.js`** - **Path B.** Processes a CloudFront-hosted Playwright HTML report end-to-end: fetches `index.html`, decodes the embedded base64 `report.zip`, downloads trace + error-context attachments from S3, parses traces, and extracts screencast frames. Produces the same JSON shape as `e2e-process-project.js` so the downstream analyzer treats both paths identically.

### Standalone scripts (used by consolidated scripts internally, or for ad-hoc debugging)

- **`e2e-extract-failures.js`** - Extracts failures from a merged Playwright JSON report
- **`e2e-parse-trace.js`** - Parses a `trace.trace` file into an action timeline with errors and last screenshot hash, plus a DOM-presence report and a console digest near the failure (see **Reading the DOM-presence and console-digest sections** below)
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
    - `trace` - parsed trace data: `timeline` (human-readable string), `errors` (array), `screenshotShas` (array of `{sha1, timestamp}` in chronological order), `lastScreenshotSha1` (legacy: same as last entry of `screenshotShas`). The `timeline` ends with two derived sections when the trace carries the data (see **Reading the DOM-presence and console-digest sections** below): a **DOM presence** report (did the failing selector's target ever enter the DOM across the frame snapshots) and a **console digest** (command executions + runtime-startup phase transitions near the failure).
    - `screenshotPaths` - chronological array of paths to extracted screenshot JPEGs (view with Read tool); the last entry is the failure-state frame, earlier entries show the moments before it
    - `screenshotPath` - legacy alias pointing to the last entry of `screenshotPaths`
    - `errorContextPath` - path to the extracted **page snapshot** markdown: Playwright's accessibility-tree snapshot of the page at the moment of failure (including content inside same-origin webview iframes), plus the failing selector and the relevant test source. Primary evidence for locator-not-found / not-visible / element-count / text-or-attribute failures -- Read it to tell a stale test selector from a real product regression (see the [analysis rubric](rubric.md))
  - `logHashes` - array of `{resourceHash, blob}` for logs (extract manually if needed)

**IMPORTANT: View screenshots** using the `screenshotPaths` arrays with the Read tool. You MUST Read **all** screenshots in a **single message** with multiple parallel Read tool calls -- this results in only one approval prompt instead of one per screenshot. View all attempts and all frames per attempt; comparing across retries reveals whether a failure is consistent or intermittent, and comparing the trailing frames *within* an attempt often shows where the test went wrong before the visible error. Screenshots are the most revealing evidence for diagnosing failures. Default frame count per attempt is 3 (configurable via `--screenshots N` on `e2e-process-project.js`).

**View the error-context page snapshot** with the Read tool using `errorContextPath` paths. For any locator-not-found, "not visible", element-count, or text/attribute failure, Read it FIRST (not as a last resort): it captures the failure-state accessibility tree -- the only evidence that distinguishes a stale test selector from a real product regression, since a screenshot cannot. See the [analysis rubric](rubric.md).

**Reading the DOM-presence and console-digest sections.** These two derived sections are appended to each attempt's `trace.timeline` (no extra file to open). They exist to separate a product open-path bug from an environment flake when a click/keypress "does nothing":

- **DOM presence** substring-matches the failing selector's class/id token across all frame snapshots. `present in N/M snapshots` means the element WAS in the DOM (so a visibility/timeout error is a timing or dismiss race, not a never-render). `NEVER present` is **ambiguous on its own** -- the exact class never matched, which fits BOTH a never-rendered element AND locator drift (the element rendered under different markup). Do not read `NEVER present` as "product bug" by itself; disambiguate with the console digest and the error-context snapshot's stable text/label.
- **Console digest** lists renderer `CommandService#executeCommand <id>` lines (a command actually firing) and `[Runtime startup] Phase changed` transitions near the failure. A command that fired while the target UI stayed `NEVER present` points at the command's handler (a product open-path bug), not the click or the environment; a startup phase flipping to `complete` just before the failing action is a timing-race tell.

The decision rule that combines these -- and the requirement that the command-fired signal (or a confirmed-absent stable label), not DOM-absence alone, is what justifies a product-open-path verdict -- lives in the [analysis rubric](rubric.md) under "Action fired but nothing rendered."

---

## Path B: posit-dev/positron-builds (S3 HTML Reports)

### Process the HTML report (single script call)

The `e2e-process-s3.js` script handles everything in one call: fetches the report's `index.html`, decodes the embedded base64 `report.zip`, walks failures + per-file detail JSONs, downloads trace and error-context attachments from S3, parses traces, and extracts trailing screencast frames.

For **each** failed e2e job from Step 1, resolve the job's `REPORT_DIR` from its logs (the workflow logs both an unresolved template line containing literal `${IDENTIFIER}` / `${OS_SUFFIX}` and the expanded value -- ignore the template), then run:

```bash
node "$SKILL_DIR/scripts/e2e-process-s3.js" \
  --report-url https://d38p2avprg8il3.cloudfront.net/<REPORT_DIR>/ \
  --output-dir /tmp/e2e-analysis-<JOB_LABEL> \
  --cleanup
```

For interactive / ad-hoc use, you can call the script directly with any CloudFront-hosted Playwright HTML report URL -- no run ID required.

Output JSON is identical to Path A's `e2e-process-project.js` (see the field list above), so the same screenshot-reading and analysis flow applies. The `blob` field is the report directory name (last path segment of the S3 URL) rather than a zip filename, since Path B has no blob zips.

**IMPORTANT: View screenshots** the same way as Path A -- Read all `screenshotPaths` arrays in a single message with multiple parallel Read tool calls. Read the `errorContextPath` page snapshot FIRST for any locator-not-found / not-visible / attribute / text failure (it is the primary evidence for stale-selector vs product-regression -- see the [analysis rubric](rubric.md)), not just when screenshots and traces fall short.

---

## Step 6: Query Historical Test Health (optional)

If `E2E_INSIGHTS_API_KEY` is set, query the e2e-test-insights dashboard for historical failure data. This step is optional -- if the API is unavailable, skip it and proceed with analysis. See [`scripts/README.md`](scripts/README.md) for auth, the `repo_id` convention, the test-key format, and how to read the response (`insight.type`, `environment_breakdown`, etc.) -- this section only covers the run-centric option specific to this skill.

### Option 1: Query by workflow run ID (preferred)

If the GitHub run ID is available, use `--run-id` to get history for all tests that failed or flaked in this run:

```bash
node "$SKILL_DIR/scripts/e2e-query-history.js" --repo positron --run-id <RUN_ID> --lookback-days 14 --branch <BRANCH>
```

The branch is important -- a test may be `rare_flake` on `main` but `known_flaky` on a release branch. Get the branch from the run metadata (Step 1) or the `onProject` event in blob reports. Common branches: `main`, `release/YYYY.MM`.

### Option 2: Query by test keys

If the run isn't in the dashboard yet, construct test keys manually from extracted failures -- see [`scripts/README.md`](scripts/README.md#building-a-test-key) for the key format and the JSON-array requirement:

```bash
node "$SKILL_DIR/scripts/e2e-query-history.js" --repo positron \
  --test-keys '["testName1|||specPath1", "testName2|||specPath2"]' --lookback-days 14
```

### History line format

Include a **History** line in each failure's analysis, e.g.:
- "History: failed 4/18 runs (22%) over last 14 days, same error pattern -- known flaky"
- "History: passed 15/15 runs over last 14 days -- **new regression**"
- "History: **0% pass rate on chromium** (10/10 failed since Apr 02), 100% on electron -- deterministic platform regression, not flaky"
- "History: known flaky across all platforms, worst on win/electron (88% pass rate)"
- "History: no data available (API unreachable)"

---

## Step 7: Analyze and Present Results

For each failure (or group of related failures), apply the shared **[analysis rubric](rubric.md)** to determine its root-cause category, a 1-2 sentence evidence-based explanation, and a suggested action. `rubric.md` is the single source of truth for the root-cause categories, the evidence-reading order (screenshots, trace timeline, test source, and the error-context page snapshot -- read FIRST for any locator/visibility/attribute/text failure), the locator-drift-vs-product-regression decision, historical-data interpretation, and head-commit correlation. The **same file is injected verbatim into the analyzer Action's system prompt**, so local skill runs and the Action reason identically -- edit the rubric there, not here.

Include a **Commit** line in the detailed analysis when the head commit is relevant (per the rubric), e.g. "Commit: modified `notebookCellList.ts` (notebook cell rendering) -- **plausible cause**" or "Commit: no files related to this test's feature area -- unlikely cause".

### Additional repo context

Also use context from the repo when helpful:
- Read the failing test file to understand what it does
- Read the **product source** the failure exercises (`src/` and `extensions/`) to settle a code-vs-test attribution -- e.g. confirm an open-path bug in the handler behind a fired command, or compare a test helper against the product function it re-derives (see the rubric's "duplicated logic drift"). Do this only to CONFIRM a hypothesis the evidence already points to; prefer Grep and read narrowly. (In the Action, `src/` and `extensions/` are checked out for exactly this.)
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

Deep-analyze the **hard failures** -- tests that **failed all retries** (`failures` in the extractor output, as opposed to `failedTests`, which includes attempts that recovered). Present them in a summary table with columns: test name, platform, root cause category, and severity (`hard`), then give the detailed per-failure analysis below the table.

**Flaky tests** (passed on retry) are not deep-analyzed here: they recovered on the same run, so they didn't break it, and per-test flaky investigation is the `triage-e2e-test` skill's specialty. List them compactly under a short "Flaky (passed on retry)" section (name + one-line history) and point to `triage-e2e-test` for any worth chasing -- unless the user explicitly asks you to dig into a flaky one. This keeps the run-centric analysis focused (and, in the Action, keeps token cost to the hard failures that actually need it).

Include **non-e2e job failures** (unit tests, integration tests, build failures) in the summary table as well, with the job name as the test name and a brief description of the failure extracted from the job logs.

Offer to:
- Open the relevant test files
- Search for related recent changes
- Create GitHub issues

## Cleanup

**Path A and Path B**: If you used `--cleanup` with `e2e-process-project.js` / `e2e-process-s3.js`, the intermediate download/unzip dirs are already removed. Only the `--output-dir` remains (screenshots and error-context). Remove it with exact paths (no globs):

```bash
rm -rf /tmp/e2e-analysis-<PROJECT_OR_JOB_LABEL>
```
