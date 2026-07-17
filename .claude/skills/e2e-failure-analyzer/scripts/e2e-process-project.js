#!/usr/bin/env node
// Processes a blob report project end-to-end: optionally downloads and merges
// sharded blob reports, then extracts failures, scans blobs for failed tests
// and attachments, extracts/parses traces, and extracts screenshots and
// error-context snapshots.
//
// Consolidates the download/merge step, e2e-extract-failures, e2e-inspect-blobs
// (both modes), and e2e-parse-trace into a single invocation.
//
// Usage:
//   # Pre-merged (blob-dir and report already exist):
//   node e2e-process-project.js <blob-dir> <merged-report.json> [options]
//
//   # Download and merge automatically:
//   node e2e-process-project.js --download --run-id <ID> --repo <owner/repo> --project <PROJECT> [options]
//
// Options:
//   --output-dir <dir>   Where to save screenshots and error-context (default: /tmp/e2e-analysis-<random>)
//   --last <N>           Number of trace actions to show (default: 500)
//   --screenshots <N>    Number of trailing screencast frames to extract per attempt (default: 3)
//   --cleanup            Remove blob-reports, blob-merged, and report JSON after processing
//
// Output: JSON to stdout with failures, test details, trace timelines, and paths
//         to extracted screenshots/error-context files in the output directory.

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);
let blobDir = null;
let reportPath = null;
let outputDir = null;
let lastN = 500;
let screenshotsN = 3;
let doDownload = false;
let runId = null;
let repo = null;
let project = null;
let doCleanup = false;

/** Parse a non-negative integer CLI flag. Rejects NaN, negatives, and non-integer floats. */
function parseNonNegInt(name, raw) {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0) {
		console.error(`Invalid ${name}: ${raw} (expected non-negative integer)`);
		process.exit(1);
	}
	return n;
}

for (let i = 0; i < cliArgs.length; i++) {
	switch (cliArgs[i]) {
		case '--output-dir': outputDir = cliArgs[++i]; break;
		case '--last': lastN = parseNonNegInt('--last', cliArgs[++i]); break;
		case '--screenshots': screenshotsN = parseNonNegInt('--screenshots', cliArgs[++i]); break;
		case '--download': doDownload = true; break;
		case '--run-id': runId = cliArgs[++i]; break;
		case '--repo': repo = cliArgs[++i]; break;
		case '--project': project = cliArgs[++i]; break;
		case '--cleanup': doCleanup = true; break;
		default:
			if (!blobDir) blobDir = cliArgs[i];
			else if (!reportPath) reportPath = cliArgs[i];
	}
}

if (doDownload) {
	if (!runId || !project) {
		console.error('--download requires --run-id and --project (--repo defaults to posit-dev/positron)');
		process.exit(1);
	}
	repo = repo || 'posit-dev/positron';

	// Derive paths from project name
	const blobReportsDir = join(tmpdir(), `blob-reports-${project}`);
	const blobMergedDir = join(tmpdir(), `blob-merged-${project}`);
	const mergedReportPath = join(tmpdir(), `report-${project}.json`);

	// Step 1: Download blob report artifacts
	process.stderr.write(`Downloading blob reports for ${project}...\n`);
	try {
		// Clean previous downloads
		rmSync(blobReportsDir, { recursive: true, force: true });
		rmSync(blobMergedDir, { recursive: true, force: true });

		execFileSync('gh', [
			'run', 'download', runId, '--repo', repo,
			'-p', `blob-report-${project}-*`, '-D', blobReportsDir,
		], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000, shell: true }); // shell: true for Windows .cmd wrappers
	} catch (err) {
		console.error(`Failed to download blob reports: ${(err.stderr || err.message || '').toString().trim().slice(0, 500)}`);
		process.exit(1);
	}

	// Step 2: Copy all shard contents into merged directory
	process.stderr.write('Merging blob report shards...\n');
	mkdirSync(blobMergedDir, { recursive: true });
	for (const shardDir of readdirSync(blobReportsDir)) {
		const shardPath = join(blobReportsDir, shardDir);
		try {
			for (const file of readdirSync(shardPath)) {
				cpSync(join(shardPath, file), join(blobMergedDir, file));
			}
		} catch {
			// shardPath might be a file not a dir, skip
		}
	}

	// Step 3: Merge reports with Playwright
	process.stderr.write('Running playwright merge-reports...\n');
	try {
		execFileSync('npx', ['playwright', 'merge-reports', '--reporter=json', blobMergedDir], {
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 120000,
			shell: true, // needed on Windows where npx is a .cmd wrapper
			env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: mergedReportPath },
		});
	} catch (err) {
		console.error(`Failed to merge reports: ${(err.stderr || err.message || '').toString().trim().slice(0, 500)}`);
		process.exit(1);
	}

	blobDir = blobMergedDir;
	reportPath = mergedReportPath;
}

if (!blobDir || !reportPath) {
	console.error('Usage: node e2e-process-project.js <blob-dir> <merged-report.json> [options]');
	console.error('   or: node e2e-process-project.js --download --run-id <ID> --project <PROJECT> [options]');
	process.exit(1);
}

const resolvedBlobDir = resolve(blobDir);
const resolvedReportPath = resolve(reportPath);

if (!existsSync(resolvedBlobDir)) {
	console.error(`Blob directory not found: ${resolvedBlobDir}`);
	process.exit(1);
}
if (!existsSync(resolvedReportPath)) {
	console.error(`Report file not found: ${resolvedReportPath}`);
	process.exit(1);
}

if (!outputDir) {
	outputDir = join(tmpdir(), `e2e-analysis-${project || randomBytes(4).toString('hex')}`);
}
const resolvedOutputDir = resolve(outputDir);
mkdirSync(join(resolvedOutputDir, 'screenshots'), { recursive: true });
mkdirSync(join(resolvedOutputDir, 'error-context'), { recursive: true });

// Temp dir for intermediate unzip operations (cleaned up at exit)
const tmpWorkDir = join(tmpdir(), `e2e-process-${randomBytes(4).toString('hex')}`);
mkdirSync(tmpWorkDir, { recursive: true });

// ---------------------------------------------------------------------------
// 1. Extract failures from merged Playwright JSON report
//    (logic from e2e-extract-failures.js)
// ---------------------------------------------------------------------------
function extractFailures(path) {
	const report = JSON.parse(readFileSync(path, 'utf8'));
	const FAIL = new Set(['failed', 'timedOut', 'interrupted']);

	function walk(suite, suitePath) {
		const results = [];
		for (const child of suite.suites || []) {
			results.push(...walk(child, suitePath.concat(child.title || '')));
		}
		for (const spec of suite.specs || []) {
			const failed = typeof spec.ok === 'boolean'
				? !spec.ok
				: spec.tests?.some(t => t.results?.some(r => FAIL.has(r?.status))) &&
				  !spec.tests?.some(t => t.results?.some(r => r?.status === 'passed'));
			if (!failed) continue;

			const errors = [];
			const projects = new Set();
			for (const t of spec.tests || []) {
				if (t.projectName) projects.add(t.projectName);
				for (const r of t.results || []) {
					if (FAIL.has(r?.status)) {
						errors.push({
							status: r.status,
							error: (r.error?.message || '').slice(0, 2000),
							snippet: (r.error?.snippet || '').slice(0, 1000),
						});
					}
				}
			}

			results.push({
				title: spec.title,
				file: spec.file || spec.location?.file,
				tags: spec.tags || [],
				suite: suitePath.filter(Boolean).join(' > '),
				project: [...projects].join(', ') || 'unknown',
				errors,
			});
		}
		return results;
	}

	const failures = [];
	for (const s of report.suites || []) {
		failures.push(...walk(s, [s.title || '']));
	}
	return failures;
}

// ---------------------------------------------------------------------------
// 1b. Extract the final outcome of EVERY spec (passed and failed alike).
//     Used to surface sibling tests in the same file: a sibling that PASSED
//     while sharing the failing test's fixture/setup is strong evidence that
//     setup succeeded and the fixture was provisioned -- so the failure is a
//     mid-run lifecycle/race issue, not a "setup never ran" provisioning bug.
// ---------------------------------------------------------------------------
function extractSpecOutcomes(path) {
	const report = JSON.parse(readFileSync(path, 'utf8'));
	const FAIL = new Set(['failed', 'timedOut', 'interrupted']);
	const out = [];

	function walk(suite) {
		for (const child of suite.suites || []) { walk(child); }
		for (const spec of suite.specs || []) {
			const statuses = (spec.tests || []).flatMap(t => (t.results || []).map(r => r?.status));
			const ranStatuses = statuses.filter(s => s && s !== 'skipped');
			let status;
			if (ranStatuses.length === 0) {
				// No non-skipped result -> the spec was skipped on this run. Tracked
				// so siblings can exclude it (matching Path B's e2e-process-s3.js):
				// a skipped sibling is NOT evidence shared setup/fixtures ran.
				status = 'skipped';
			} else {
				let ok = spec.ok;
				if (typeof ok !== 'boolean') {
					ok = statuses.includes('passed') && !statuses.every(s => FAIL.has(s));
				}
				status = ok ? 'passed' : 'failed';
			}
			out.push({ file: spec.file || spec.location?.file, title: spec.title, status });
		}
	}

	for (const s of report.suites || []) { walk(s); }
	return out;
}

/**
 * Normalize an e2e spec file path so sibling tests can be grouped by file
 * regardless of absolute-vs-relative shape. Mirrors the normalizer in
 * analyze.mjs; anchors on "/test/e2e/tests/" then falls back to common prefixes.
 */
function normalizeSpecPath(file) {
	const fwd = String(file || '').replace(/\\/g, '/');
	const idx = fwd.indexOf('/test/e2e/tests/');
	if (idx >= 0) { return fwd.slice(idx + 1); }
	if (fwd.startsWith('test/e2e/')) { return fwd; }
	if (fwd.startsWith('tests/')) { return `test/e2e/${fwd}`; }
	return fwd;
}

// ---------------------------------------------------------------------------
// 2. Scan blob reports for failed tests and their attachments
//    (logic from e2e-inspect-blobs.js, both modes combined in one pass)
// ---------------------------------------------------------------------------
function scanBlobs(blobDirPath) {
	const FAIL = new Set(['failed', 'timedOut', 'interrupted']);
	const zipFiles = readdirSync(blobDirPath).filter(f => f.endsWith('.zip'));

	const testMeta = new Map();     // testId -> {title, file}
	const failedTests = [];         // all failed onTestEnd events
	const failedTestIds = new Set();
	// Collect ALL onAttach events keyed by testId. We filter to failed tests
	// after the scan since onAttach can arrive before onTestEnd in the JSONL.
	const allAttachments = new Map(); // testId -> [{name, contentType, path, resourceHash, blob}]

	function collectTestMeta(suite, filePath) {
		for (const entry of suite.entries || []) {
			if (entry.testId) {
				testMeta.set(entry.testId, {
					title: entry.title,
					file: suite.location?.file || filePath,
				});
			}
			if (entry.entries) collectTestMeta(entry, filePath);
		}
	}

	for (const zipFile of zipFiles) {
		const zipPath = join(blobDirPath, zipFile);
		const extractDir = join(tmpWorkDir, `blob-${zipFile.replace('.zip', '')}`);

		try {
			mkdirSync(extractDir, { recursive: true });
			execFileSync('unzip', ['-o', zipPath, 'report.jsonl', '-d', extractDir], {
				stdio: ['pipe', 'pipe', 'pipe'],
			});
		} catch {
			continue;
		}

		const jsonlPath = join(extractDir, 'report.jsonl');
		if (!existsSync(jsonlPath)) continue;

		const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);

		for (const line of lines) {
			let event;
			try { event = JSON.parse(line); } catch { continue; }

			if (event.method === 'onProject') {
				for (const suite of event.params?.project?.suites || []) {
					collectTestMeta(suite, suite.title);
				}
			}

			if (event.method === 'onTestEnd') {
				const status = event.params?.result?.status;
				if (FAIL.has(status)) {
					const id = event.params.test?.testId;
					failedTestIds.add(id);
					const meta = testMeta.get(id) || {};
					failedTests.push({
						testId: id,
						title: meta.title || null,
						file: meta.file || null,
						status,
						blob: zipFile,
					});
				}
			}

			if (event.method === 'onAttach') {
				const testId = event.params?.testId;
				if (!allAttachments.has(testId)) {
					allAttachments.set(testId, []);
				}
				for (const att of event.params.attachments || []) {
					const attPath = att.path || '';
					const hashMatch = attPath.match(/([a-f0-9]{40})\./);
					allAttachments.get(testId).push({
						name: att.name,
						contentType: att.contentType,
						path: attPath,
						resourceHash: hashMatch ? hashMatch[1] : null,
						blob: zipFile,
					});
				}
			}
		}
	}

	// Filter attachments to only failed tests
	const attachmentsByTestId = new Map();
	for (const testId of failedTestIds) {
		if (allAttachments.has(testId)) {
			attachmentsByTestId.set(testId, allAttachments.get(testId));
		}
	}

	return { failedTests, failedTestIds, attachmentsByTestId };
}

// ---------------------------------------------------------------------------
// 3. Parse a trace.trace file
//    (logic from e2e-parse-trace.js -- keep the analysis helpers below in sync)
// ---------------------------------------------------------------------------

/**
 * Collect the selectors involved in FAILED actions/assertions: the selector on
 * the nearest preceding `before`, plus any `locator('...')` mined from the error
 * message. These are what the test was actually waiting for.
 */
function collectFailingSelectors(evts) {
	const selectors = new Set();
	for (let i = 0; i < evts.length; i++) {
		const e = evts[i];
		if (e.type !== 'after' || !e.error) { continue; }
		for (let j = i - 1; j >= 0; j--) {
			if (evts[j].type === 'before') {
				if (evts[j].params?.selector) { selectors.add(evts[j].params.selector); }
				break;
			}
		}
		for (const m of String(e.error.message || '').matchAll(/locator\(['"`]([^'"`]+)['"`]\)/g)) {
			selectors.add(m[1]);
		}
	}
	return [...selectors];
}

/** Pull stable class/id tokens out of selector strings. */
function selectorTokens(selectors) {
	const tokens = new Set();
	for (const sel of selectors) {
		for (const m of String(sel).matchAll(/\.([A-Za-z_][\w-]{2,})/g)) { tokens.add(m[1]); }
		for (const m of String(sel).matchAll(/\[id=["']([^"']+)["']\]/g)) { tokens.add(m[1]); }
	}
	return [...tokens];
}

/**
 * Report whether each failing-selector token ever entered the DOM across the
 * trace's frame snapshots. "NEVER present" => the element genuinely never
 * rendered (a product open-path bug), as opposed to rendering then being
 * dismissed -- a distinction the single moment-of-failure error-context
 * snapshot cannot make.
 */
function buildDomPresence(evts, tokens) {
	if (!tokens.length) { return null; }
	const snaps = evts
		.filter(e => e.type === 'frame-snapshot' && e.snapshot?.timestamp != null)
		.map(s => ({ ts: s.snapshot.timestamp, json: JSON.stringify(s) }));
	if (!snaps.length) { return null; }
	const span = `t=${Math.round(snaps[0].ts)}..${Math.round(snaps[snaps.length - 1].ts)}`;
	const out = [`\n=== DOM presence across ${snaps.length} frame snapshots (${span}) ===`];
	out.push("Did the failing selector's target ever enter the DOM? NEVER present => it never rendered (product open-path issue), not a render-then-dismiss.");
	for (const tok of tokens) {
		const hits = snaps.filter(s => s.json.includes(tok));
		if (!hits.length) {
			out.push(`- '${tok}': NEVER present in any snapshot`);
		} else {
			out.push(`- '${tok}': present in ${hits.length}/${snaps.length} snapshots (t=${Math.round(hits[0].ts)}..${Math.round(hits[hits.length - 1].ts)})`);
		}
	}
	return out.join('\n');
}

/** Strip the `%c`/`color:#…` console-formatting noise VS Code prepends. */
function cleanConsole(text) {
	return String(text)
		.replace(/%c/g, '')
		.replace(/(?:background|color):\s*#?[0-9a-fA-F]{3,6}/g, '')
		.replace(/\s;\s/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.replace(/^[\s;:-]+/, '')
		.trim();
}

// Console lines that match the allowlist / error levels but carry no diagnostic
// value: internal context-key churn, the dev-only disposable-leak tracker, and
// benign environment probes on CI runners.
const CONSOLE_NOISE_RE = /(_setContext|LEAKED DISPOSABLE|No pandoc executable|MetadataLookupWarning|received unexpected error = network timeout)/i;

/**
 * Digest of high-signal renderer-console lines around the failure window:
 * command executions (proves a click's command actually fired), runtime-startup
 * phase transitions (timing races), and errors/warnings. Distinguishes "click
 * was swallowed" from "command ran but nothing rendered." Consecutive
 * duplicates are collapsed with an (xN) count.
 */
function buildConsoleDigest(evts) {
	const ALLOW = /(CommandService#executeCommand|Runtime startup][^\n]*Phase changed|Discovery completed|Uncaught|Unhandled)/i;
	const MAX_LINES = 28;
	const consoles = evts.filter(e => e.type === 'console' && typeof e.text === 'string');
	if (!consoles.length) { return null; }
	const errTimes = evts.filter(e => e.type === 'after' && e.error).map(e => e.endTime ?? e.startTime).filter(t => t != null);
	const focusStart = errTimes.length ? Math.min(...errTimes) - 3000 : -Infinity;
	const focusEnd = errTimes.length ? Math.max(...errTimes) + 1000 : Infinity;
	const picked = consoles.filter(e =>
		(e.time == null || (e.time >= focusStart && e.time <= focusEnd)) &&
		(e.messageType === 'error' || e.messageType === 'warning' || ALLOW.test(e.text)) &&
		!CONSOLE_NOISE_RE.test(e.text));
	if (!picked.length) { return null; }

	const entries = [];
	for (const e of picked) {
		const text = cleanConsole(e.text).slice(0, 200);
		const last = entries[entries.length - 1];
		if (last && last.text === text) { last.count++; continue; }
		entries.push({ time: e.time, level: e.messageType || 'log', text, count: 1 });
	}

	const shown = entries.slice(0, MAX_LINES);
	const out = [`\n=== Console digest near failure (${shown.length}${entries.length > shown.length ? ` of ${entries.length}` : ''} high-signal lines) ===`];
	for (const e of shown) {
		out.push(`t=${Math.round(e.time ?? 0)} [${e.level}] ${e.text}${e.count > 1 ? ` (x${e.count})` : ''}`);
	}
	return out.join('\n');
}

function parseTrace(tracePath) {
	const content = readFileSync(tracePath, 'utf8');
	const lines = content.split('\n').filter(Boolean);
	const events = [];
	for (const line of lines) {
		try { events.push(JSON.parse(line)); } catch { /* skip */ }
	}

	const actions = events.filter(e => e.type === 'before' || e.type === 'after');
	// `slice(-0)` returns the whole array, so handle 0 explicitly.
	const recent = lastN === 0 ? [] : actions.slice(-lastN);

	const timelineLines = [];
	timelineLines.push(`=== Action Timeline (last ${recent.length} of ${actions.length} events) ===\n`);

	for (const a of recent) {
		if (a.type === 'before') {
			let info = `${a.class || '?'}.${a.method || '?'}`;
			if (a.startTime != null) info += ` (t=${Math.round(a.startTime)})`;
			if (a.params?.selector) info += ` selector: ${a.params.selector}`;
			if (a.params?.url) info += ` url: ${a.params.url}`;
			timelineLines.push(`[before] ${info}`);
		} else {
			const err = a.error?.message?.slice(0, 300);
			if (err) {
				timelineLines.push(`[after]  ERROR: ${err}`);
			} else {
				let info = 'ok';
				if (a.endTime != null) info += ` (t=${Math.round(a.endTime)})`;
				timelineLines.push(`[after]  ${info}`);
			}
		}
	}

	const screenshots = events.filter(e => e.type === 'screencast-frame');
	// `slice(-0)` returns the whole array, so handle 0 explicitly.
	const trailingScreenshots = screenshotsN === 0 ? [] : screenshots.slice(-screenshotsN);
	const lastScreenshot = trailingScreenshots.length > 0 ? trailingScreenshots[trailingScreenshots.length - 1] : null;

	if (trailingScreenshots.length > 0) {
		timelineLines.push(`\n=== Screenshots ===`);
		timelineLines.push(`Total screencast frames: ${screenshots.length}`);
		timelineLines.push(`Extracting last ${trailingScreenshots.length} frame(s):`);
		for (let i = 0; i < trailingScreenshots.length; i++) {
			const s = trailingScreenshots[i];
			timelineLines.push(`  [${i}] sha1=${s.sha1} timestamp=${s.timestamp}`);
		}
	}

	const errorEvents = events.filter(e => e.type === 'after' && e.error);
	const errors = errorEvents.map(e => (e.error.message || '').slice(0, 500));

	if (errors.length > 0) {
		timelineLines.push(`\n=== Errors (${errors.length}) ===`);
		for (const err of errors) {
			timelineLines.push(`- ${err}`);
		}
	}

	// DOM-presence of the failing selector(s) over time + a console digest of
	// command executions / startup-phase transitions near the failure. Together
	// these separate "the control never rendered" / "the command fired but
	// nothing happened" from a pure environment flake.
	const domPresence = buildDomPresence(events, selectorTokens(collectFailingSelectors(events)));
	if (domPresence) { timelineLines.push(domPresence); }
	const consoleDigest = buildConsoleDigest(events);
	if (consoleDigest) { timelineLines.push(consoleDigest); }

	return {
		timeline: timelineLines.join('\n'),
		errors,
		// Last N screencast frames in chronological order; final entry is the failure-state screenshot.
		screenshotShas: trailingScreenshots.map(s => ({ sha1: s.sha1, timestamp: s.timestamp })),
		// Kept for backward compat with callers that read just the final frame.
		lastScreenshotSha1: lastScreenshot?.sha1 || null,
	};
}

// ---------------------------------------------------------------------------
// Helpers: unzip operations
// ---------------------------------------------------------------------------

/** Extract a single file from a zip to a destination directory. Returns the extracted path or null. */
function unzipFile(zipPath, entryPath, destDir) {
	try {
		mkdirSync(destDir, { recursive: true });
		execFileSync('unzip', ['-o', zipPath, entryPath, '-d', destDir], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const extracted = join(destDir, entryPath);
		return existsSync(extracted) ? extracted : null;
	} catch {
		return null;
	}
}

// High-signal error markers used to mine the attached log bundle. Deliberately
// narrow (not a generic "error" match) so kernel/runtime failures like
// "IOError: Failed to open local file ... No such file or directory" surface
// without drowning in benign trace noise. A screenshot or Playwright error
// CANNOT tell "fixture never provisioned" from "fixture deleted mid-run"; the
// kernel/runner log lines (e.g. the resolved getwd() path) often can.
const LOG_ERROR_RE = /(no such file|file not found|cannot find|traceback|ioerror|[a-z]+error:|exception:|fatal|panic|unhandled|connection refused|permission denied|access denied|expired|failed to \w+)/i;

// Benign lines that match LOG_ERROR_RE but carry no diagnostic value (e.g. the
// file watcher logs an ENOENT for every optional config path it probes). Drop
// them so real failures aren't crowded out of the bounded excerpt.
const LOG_NOISE_RE = /(ignoring a path for watching|\.vscode[/\\](settings|mcp|tasks|launch)\.json|[/\\](policy|mcp)\.json)/i;

/** Strip ANSI SGR escape sequences (ESC[..m) so log lines read cleanly in the prompt. */
function stripAnsi(s) {
	return s.replace(new RegExp("\u001b\[[0-9;]*m", "g"), "");
}

/**
 * Extract the attached logs zip and return the lines matching LOG_ERROR_RE,
 * each tagged with its source log filename. Bounded so a single test can't
 * dominate the prompt. Returns null when nothing matches (the trace already
 * carries the Playwright-level error in that case).
 */
function grepLogs(logsZipPath) {
	const PER_FILE = 20;
	const MAX_LINES = 60;
	const MAX_CHARS = 5000;
	const dir = join(tmpWorkDir, `logsx-${randomBytes(4).toString('hex')}`);
	try {
		mkdirSync(dir, { recursive: true });
		execFileSync('unzip', ['-o', logsZipPath, '-d', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
	} catch {
		return null;
	}

	// Recursively collect *.log files.
	const logFiles = [];
	const stack = [dir];
	while (stack.length) {
		const d = stack.pop();
		let entries;
		try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
		for (const ent of entries) {
			const p = join(d, ent.name);
			if (ent.isDirectory()) { stack.push(p); }
			else if (ent.name.endsWith('.log')) { logFiles.push(p); }
		}
	}

	const collected = [];
	const seen = new Set(); // dedupe identical message bodies (e.g. repeated git ENOENT warnings)
	for (const f of logFiles) {
		const rel = f.slice(dir.length + 1).replace(/\\/g, '/');
		let content;
		try { content = readFileSync(f, 'utf8'); } catch { continue; }
		let perFile = 0;
		for (const raw of content.split('\n')) {
			const line = stripAnsi(raw).trim();
			if (!LOG_ERROR_RE.test(line) || LOG_NOISE_RE.test(line)) { continue; }
			// Dedupe on the message minus any leading timestamp so retries/repeats collapse.
			const dedupeKey = line.replace(/^[\d\-T:.Z\s]+/, '').slice(0, 200);
			if (seen.has(dedupeKey)) { continue; }
			seen.add(dedupeKey);
			collected.push(`[${rel}] ${line.slice(0, 300)}`);
			if (++perFile >= PER_FILE) { break; }
			if (collected.length >= MAX_LINES) { break; }
		}
		if (collected.length >= MAX_LINES) { break; }
	}

	if (collected.length === 0) { return null; }
	let joined = collected.join('\n');
	if (joined.length > MAX_CHARS) { joined = joined.slice(0, MAX_CHARS) + '\n[... log excerpt truncated ...]'; }
	return joined;
}

// ---------------------------------------------------------------------------
// Main processing
// ---------------------------------------------------------------------------

process.stderr.write('Extracting failures from merged report...\n');
const failures = extractFailures(resolvedReportPath);

// Group every spec's final outcome by file so each failed test can report its
// sibling tests (passed/failed) in the same file.
const siblingsByFile = new Map(); // normalizedFile -> [{title, ok}]
for (const s of extractSpecOutcomes(resolvedReportPath)) {
	const key = normalizeSpecPath(s.file);
	if (!siblingsByFile.has(key)) { siblingsByFile.set(key, []); }
	siblingsByFile.get(key).push({ title: s.title, status: s.status });
}

process.stderr.write('Scanning blob reports for failed tests and attachments...\n');
const { failedTests, failedTestIds, attachmentsByTestId } = scanBlobs(resolvedBlobDir);

process.stderr.write(`Found ${failures.length} final failures, ${failedTestIds.size} unique failed test IDs across all attempts.\n`);

// Build detailed per-test data
const testDetails = [];

for (const testId of failedTestIds) {
	const testInfo = failedTests.find(t => t.testId === testId);
	const attachments = attachmentsByTestId.get(testId) || [];

	const traceAtts = attachments.filter(a => a.name === 'trace' && a.contentType === 'application/zip');
	const errorCtxAtts = attachments.filter(a => a.name === 'error-context' && a.contentType === 'text/markdown');
	const logsAtts = attachments.filter(a => a.name?.includes('logs-') && a.contentType === 'application/zip');

	const shortId = testId.slice(0, 12);
	const attempts = [];

	// Mine the attached log bundle (kernel/runtime/runner logs) for error lines.
	// One bundle per test is enough; the last attempt's logs are the most relevant.
	let logExcerpt = null;
	const logsAtt = logsAtts[logsAtts.length - 1];
	if (logsAtt?.path) {
		process.stderr.write(`  Mining logs for ${shortId}...\n`);
		const logsZipPath = unzipFile(
			join(resolvedBlobDir, logsAtt.blob),
			logsAtt.path,
			join(tmpWorkDir, `logs-${shortId}`)
		);
		if (logsZipPath) { logExcerpt = grepLogs(logsZipPath); }
	}

	// Sibling tests in the same file (passed siblings are the key signal).
	const siblingTests = (siblingsByFile.get(normalizeSpecPath(testInfo?.file)) || [])
		.filter(s => s.title !== testInfo?.title && s.status !== 'skipped')
		.map(s => ({ title: s.title, status: s.status }));

	for (let i = 0; i < traceAtts.length; i++) {
		const traceAtt = traceAtts[i];
		const errorCtxAtt = errorCtxAtts[i]; // may be undefined

		let traceData = null;
		let screenshotPath = null;
		const screenshotPaths = [];

		// Extract and parse trace
		if (traceAtt.resourceHash) {
			process.stderr.write(`  Processing trace for ${shortId} attempt ${i}...\n`);

			// Step 1: extract the resource zip from the blob zip
			const traceExtractDir = join(tmpWorkDir, `trace-${shortId}-${i}`);
			const resourceZipPath = unzipFile(
				join(resolvedBlobDir, traceAtt.blob),
				traceAtt.path,
				traceExtractDir
			);

			if (resourceZipPath) {
				// Step 2: extract trace.trace from the resource zip
				const traceDir = join(tmpWorkDir, `trace-parsed-${shortId}-${i}`);
				const tracePath = unzipFile(resourceZipPath, 'trace.trace', traceDir);

				if (tracePath) {
					traceData = parseTrace(tracePath);

					// Step 3: extract trailing N screencast frames in chronological order.
					// File naming: <shortId>-attempt<i>-frame<j>.jpeg where j=0 is the
					// earliest of the N extracted, last index is the failure-state frame.
					// The sha1 field is the full filename incl. extension (page@<hash>-<ts>.jpeg).
					const frames = traceData.screenshotShas || [];
					for (let j = 0; j < frames.length; j++) {
						const sha = frames[j].sha1;
						if (!sha) { continue; }
						const ssFileName = `${shortId}-attempt${i}-frame${j}.jpeg`;
						const ssDestPath = join(resolvedOutputDir, 'screenshots', ssFileName);
						const ssEntry = `resources/${sha}`;
						const ssTempDir = join(tmpWorkDir, `ss-${shortId}-${i}-${j}`);
						const ssExtracted = unzipFile(resourceZipPath, ssEntry, ssTempDir);

						if (ssExtracted) {
							writeFileSync(ssDestPath, readFileSync(ssExtracted));
							screenshotPaths.push(ssDestPath);
						}
					}
					// Final frame is the most-revealing failure state -- preserve the
					// legacy single-screenshotPath field for callers that only want it.
					screenshotPath = screenshotPaths.length > 0
						? screenshotPaths[screenshotPaths.length - 1]
						: null;
				}
			}
		}

		// Extract error context markdown
		let errorContextPath = null;
		if (errorCtxAtt?.resourceHash) {
			const mdEntry = `resources/${errorCtxAtt.resourceHash}.markdown`;
			const mdTempDir = join(tmpWorkDir, `errctx-${shortId}-${i}`);
			const mdExtracted = unzipFile(
				join(resolvedBlobDir, errorCtxAtt.blob),
				mdEntry,
				mdTempDir
			);

			if (mdExtracted) {
				const mdContent = readFileSync(mdExtracted, 'utf8');
				const mdFileName = `${shortId}-attempt${i}.md`;
				const mdDestPath = join(resolvedOutputDir, 'error-context', mdFileName);
				writeFileSync(mdDestPath, mdContent);
				errorContextPath = mdDestPath;
			}
		}

		attempts.push({
			attemptIndex: i,
			trace: traceData,
			screenshotPath,           // legacy: final frame only
			screenshotPaths,          // chronological list; last entry is the failure-state
			errorContextPath,
		});
	}

	testDetails.push({
		testId,
		title: testInfo?.title || null,
		file: testInfo?.file || null,
		status: testInfo?.status || null,
		blob: testInfo?.blob || null,
		attemptCount: traceAtts.length,
		attempts,
		siblingTests,
		logExcerpt,
		logHashes: logsAtts.map(a => ({ resourceHash: a.resourceHash, blob: a.blob })),
	});
}

// Clean up temp work directory
try {
	rmSync(tmpWorkDir, { recursive: true, force: true });
} catch { /* best effort */ }

// Clean up download/merge artifacts if --cleanup was specified
if (doCleanup && project) {
	process.stderr.write('Cleaning up download/merge artifacts...\n');
	const blobReportsDir = join(tmpdir(), `blob-reports-${project}`);
	const blobMergedDir = join(tmpdir(), `blob-merged-${project}`);
	const mergedReportPath = join(tmpdir(), `report-${project}.json`);
	for (const p of [blobReportsDir, blobMergedDir, mergedReportPath]) {
		try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

const result = {
	outputDir: resolvedOutputDir,
	failures,
	failedTests,
	testDetails,
};

console.log(JSON.stringify(result, null, 2));

process.stderr.write(`\nDone. Screenshots: ${join(resolvedOutputDir, 'screenshots')}\n`);
process.stderr.write(`Total: ${failures.length} final failures, ${testDetails.length} unique failed tests, ` +
	`${testDetails.reduce((sum, t) => sum + t.attempts.length, 0)} trace attempts processed.\n`);
