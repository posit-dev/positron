#!/usr/bin/env node
// Gathers all run metadata, failed jobs, artifacts, and commit info in one call.
// Replaces ~6 separate `gh api` invocations from the skill's Step 1.
//
// Usage: node e2e-gather-run-info.js <run-url-or-id> [--repo <owner/repo>]
//
// Output: JSON with:
//   repo, runId, run (metadata), failedJobs (each with a `steps` summary),
//   nonE2eJobLogs, artifacts, projects, commit
//
// Each failed job's `steps` summary separates the test-execution step from the
// setup steps that ran before it. A setup step that failed while the job kept
// going (installing R, a runtime, a dependency) leaves the tests running
// against an incomplete environment, and the resulting test failures are an
// environment defect rather than a product regression -- but nothing in the
// Playwright report says so, so the step conclusions are the only evidence.

import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
let runInput = null;
let repoOverride = null;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--repo' && args[i + 1]) {
		repoOverride = args[++i];
	} else if (!runInput) {
		runInput = args[i];
	}
}

if (!runInput) {
	console.error('Usage: node e2e-gather-run-info.js <run-url-or-id> [--repo <owner/repo>]');
	process.exit(1);
}

// Extract repo and run ID from URL
let repo, runId;
const urlMatch = runInput.match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/);
if (urlMatch) {
	repo = urlMatch[1];
	runId = urlMatch[2];
} else if (/^\d+$/.test(runInput)) {
	runId = runInput;
	repo = repoOverride || 'posit-dev/positron';
} else {
	console.error('Invalid input. Provide a GitHub Actions run URL or numeric run ID.');
	process.exit(1);
}

function gh(...ghArgs) {
	try {
		// Do NOT use shell: true -- the --jq arguments contain pipe characters
		// that cmd.exe would interpret as shell pipes. This works in Git Bash
		// (Claude Code's shell on Windows) where gh resolves as a real binary.
		return execFileSync('gh', ghArgs, {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 60000,
			maxBuffer: 50 * 1024 * 1024, // 50MB - CI logs can be very large
		}).trim();
	} catch (err) {
		process.stderr.write(`Warning: gh command failed: gh ${ghArgs.join(' ')}\n`);
		process.stderr.write(`  ${(err.stderr || err.message || '').toString().trim().slice(0, 500)}\n`);
		return '';
	}
}

// 1. Get run metadata
process.stderr.write('Fetching run metadata...\n');
const runMeta = JSON.parse(
	gh('api', `repos/${repo}/actions/runs/${runId}`,
		'--jq', '{name: .name, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha, branch: .head_branch}')
	|| '{}'
);

/**
 * Fetch a job's raw log text. `--allow-escape-sequences` is required: workflow
 * steps emit colorized output, and gh's terminal-safety check otherwise exits 1
 * with "the response contains terminal escape sequences" and no stdout --
 * silently yielding an empty log. Older gh builds do not know the flag, so retry
 * without it rather than losing the log entirely.
 */
function ghJobLog(jobId) {
	const path = `repos/${repo}/actions/jobs/${jobId}/logs`;
	return gh('api', '--allow-escape-sequences', path) || gh('api', path);
}

function stripAnsi(text) {
	return String(text).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/** Strip the leading `2026-09-22T10:27:13.4942570Z ` runner timestamp. */
function stripLogTimestamp(line) {
	return line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '');
}

/**
 * A step whose name reads as "run the tests". Used only to locate the boundary
 * between setup and execution -- steps before it provisioned the environment,
 * so a failure there means the tests ran against an incomplete one. Covers the
 * names in use across both repos' e2e workflows: "Run Tests (Electron)",
 * "Run Tests on Windows (Electron)", "Run Playwright Tests",
 * "Run Playwright Jupyter Tests", "Run tests (host -> container)".
 */
const TEST_STEP_RE = /\brun(?:ning)?\b.*\btests?\b/i;

/**
 * Pick the step that actually executed the Playwright suite.
 *
 * A job can hold several steps whose names match "run ... test" -- the Windows
 * jobs run "Run Boostrap extension test" just before "Run Tests on Windows
 * (Electron)" -- so taking the first match puts the real test step on the wrong
 * side of the boundary. Prefer the LAST matching step that failed: the analyzer
 * only ever looks at runs with test failures, so the step that reported them is
 * the execution step. Fall back to the last match when none failed.
 */
function findTestStep(steps) {
	const candidates = steps.filter(st => TEST_STEP_RE.test(st.name || ''));
	if (candidates.length === 0) { return null; }
	const failed = candidates.filter(st => st.conclusion === 'failure');
	const pool = failed.length ? failed : candidates;
	return pool[pool.length - 1];
}

/**
 * Split a job's steps into the test-execution step and the failures on either
 * side of it. Returns null when the API gave us no steps (older runs, or a job
 * that never started), so callers can tell "no step data" from "no failures".
 *
 * Pre-test failures are the signal this summary exists for: GitHub keeps running
 * a job past a failed step whenever the later steps carry their own `if:`
 * conditions, so "Install R failed, the tests ran anyway" shows up in neither
 * the job conclusion nor the Playwright report.
 */
function summarizeSteps(steps) {
	if (!Array.isArray(steps) || steps.length === 0) { return null; }

	const failed = steps.filter(st => st.conclusion === 'failure');
	const pickStep = st => ({ number: st.number, name: st.name, conclusion: st.conclusion });

	const testStep = findTestStep(steps);
	// No identifiable test step means no test evidence for this job to taint --
	// these are aggregator jobs like "e2e / electron-win", whose only step is a
	// "Check test results" gate over the shards. Reporting its failed gate as
	// "setup failed before the tests ran" would be a false claim, so keep those
	// failures separate and unpositioned rather than asserting an order.
	if (!testStep) {
		return {
			total: steps.length,
			testStep: null,
			failedBeforeTest: [],
			failedAfterTest: [],
			failedUnpositioned: failed.map(pickStep),
			skippedAfterFailure: [],
			_preTestRaw: [],
		};
	}

	const boundary = testStep.number;
	const failedBeforeTest = failed.filter(st => st.number < boundary);

	// Steps the API reports as skipped after the first pre-test failure. The API
	// never says WHY a step was skipped, so this mixes fallout from the failure
	// with ordinary matrix/`if` skips -- it is a lead, not a verdict.
	const firstPreTest = failedBeforeTest.length ? failedBeforeTest[0].number : null;
	const skippedAfterFailure = firstPreTest === null
		? []
		: steps
			.filter(st => st.conclusion === 'skipped' && st.number > firstPreTest && st.number < boundary)
			.slice(0, 20);

	return {
		total: steps.length,
		testStep: pickStep(testStep),
		failedBeforeTest: failedBeforeTest.map(pickStep),
		failedAfterTest: failed.filter(st => st.number > boundary).map(pickStep),
		failedUnpositioned: [],
		skippedAfterFailure: skippedAfterFailure.map(pickStep),
		// Scratch: the raw records for the pre-test failures, needed only to slice
		// their log windows below. Deleted before the JSON is emitted.
		_preTestRaw: failedBeforeTest,
	};
}

/**
 * Slice a job log down to one step's execution window and keep its tail.
 *
 * The runner prefixes every log line with a UTC timestamp and the steps API
 * gives each step a started_at/completed_at, so the window is close to exact --
 * no reliance on `##[group]` markers, which carry a step's *command* rather than
 * its name. The tail is what matters: a failing install prints its error last.
 *
 * Two corrections are needed on top of the raw window:
 *
 * - The API timestamps steps to the second while log lines carry sub-second
 *   precision, so the end has to be padded to keep the step's own final line --
 *   which then bleeds in whatever the NEXT step logged during the same second.
 *   A runner always closes a failed step with `##[error]`, so cutting after the
 *   last one inside the window drops the bleed. (Steps skipped in that same
 *   second log nothing, which is why the padding is safe to take.)
 * - A step's preamble echoes the whole `env:` block -- dozens of lines of
 *   masked secrets that would crowd the real output out of the tail.
 */
function sliceStepLog(logText, step, tailLines = 40, maxChars = 4000) {
	if (!logText || !step || !step.started_at || !step.completed_at) { return ''; }
	const start = Date.parse(step.started_at);
	const end = Date.parse(step.completed_at) + 1000;
	if (Number.isNaN(start) || Number.isNaN(end)) { return ''; }

	let kept = [];
	let inEnvBlock = false;
	for (const raw of logText.split('\n')) {
		const match = raw.match(/^(?<ts>\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s/);
		if (!match) { continue; }
		const ts = Date.parse(match.groups.ts);
		if (Number.isNaN(ts) || ts < start || ts > end) { continue; }
		const line = stripAnsi(stripLogTimestamp(raw)).trimEnd();
		if (!line) { continue; }

		if (inEnvBlock) {
			if (line.trim() === '##[endgroup]') { inEnvBlock = false; }
			continue;
		}
		if (line.trim() === 'env:') { inEnvBlock = true; continue; }
		kept.push(line);
	}

	const lastError = kept.findLastIndex(l => l.startsWith('##[error]'));
	if (lastError >= 0) { kept = kept.slice(0, lastError + 1); }

	const text = kept.slice(-tailLines).join('\n');
	return text.length > maxChars ? `[... truncated ...]\n${text.slice(-maxChars)}` : text;
}

// 2. List all failed jobs (paginated), with their per-step conclusions
process.stderr.write('Listing failed jobs...\n');
const failedJobsRaw = gh('api', `repos/${repo}/actions/runs/${runId}/jobs`, '--paginate',
	'--jq', '.jobs[] | select(.conclusion == "failure") | {id: .id, name: .name, steps: [.steps[]? | {number, name, conclusion, started_at, completed_at}]}');

const failedJobs = failedJobsRaw
	.split('\n')
	.filter(Boolean)
	.map(line => { try { return JSON.parse(line); } catch { return null; } })
	.filter(Boolean)
	.map(job => ({
		id: job.id,
		name: job.name,
		isE2e: /e2e/i.test(job.name),
		steps: summarizeSteps(job.steps),
	}));

// 3. Get failure log excerpts: the whole-job digest for non-e2e jobs, and the
//    per-step window for any job whose SETUP failed before the tests ran.
const nonE2eJobLogs = {};
for (const job of failedJobs) {
	const preTest = (job.steps && job.steps._preTestRaw) || [];
	if (job.isE2e && preTest.length === 0) { continue; }

	process.stderr.write(`Fetching logs for job: ${job.name}...\n`);
	const logs = ghJobLog(job.id);

	if (!job.isE2e) {
		const failLines = logs
			.split('\n')
			.filter(l => /(FAIL|Error|error:|##\[error\])/.test(l))
			.slice(-30)
			.map(l => stripAnsi(stripLogTimestamp(l)).trim());
		nonE2eJobLogs[job.id] = failLines.join('\n');
	}

	for (let i = 0; i < preTest.length; i++) {
		job.steps.failedBeforeTest[i].log = sliceStepLog(logs, preTest[i]);
	}
}

for (const job of failedJobs) {
	if (job.steps) { delete job.steps._preTestRaw; }
}

// 4. List blob report artifacts
process.stderr.write('Listing blob report artifacts...\n');
const artifactsRaw = gh('api', `repos/${repo}/actions/runs/${runId}/artifacts`,
	'--jq', '.artifacts[] | select(.name | test("^blob-report-")) | .name');
const artifacts = artifactsRaw.split('\n').filter(Boolean).sort();

// Extract unique project names from artifact names like "blob-report-e2e-chromium-1"
const projects = [...new Set(
	artifacts.map(name => {
		const match = name.match(/^blob-report-(.+)-\d+$/);
		return match ? match[1] : null;
	}).filter(Boolean)
)];

// 5. Get commit info
let commit = {};
if (runMeta.head_sha) {
	process.stderr.write('Fetching commit info...\n');
	const commitRaw = gh('api', `repos/${repo}/commits/${runMeta.head_sha}`,
		'--jq', '{message: .commit.message, author: .commit.author.name, files: [.files[].filename]}');
	if (commitRaw) {
		try { commit = JSON.parse(commitRaw); } catch { /* ignore */ }
	}
}

const result = {
	repo,
	runId,
	run: runMeta,
	failedJobs,
	nonE2eJobLogs,
	artifacts,
	projects,
	commit,
};

console.log(JSON.stringify(result, null, 2));
const setupBroken = failedJobs.filter(j => j.steps && j.steps.failedBeforeTest.length > 0);
process.stderr.write(`Done. Found ${failedJobs.length} failed jobs, ${projects.length} e2e projects.\n`);
for (const job of setupBroken) {
	const names = job.steps.failedBeforeTest.map(st => `#${st.number} ${st.name}`).join(', ');
	process.stderr.write(`  WARNING: ${job.name} ran its tests after a failed setup step: ${names}\n`);
}
