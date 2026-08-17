#!/usr/bin/env node
// Processes a CloudFront-hosted Playwright HTML report end-to-end (positron-builds
// non-sharded runs). Fetches index.html, decodes the embedded base64 report.zip,
// reads report.json + per-file detail JSONs, downloads trace and error-context
// attachments from S3, parses traces, and extracts screencast frames.
//
// Output JSON matches e2e-process-project.js exactly so analyze.mjs handles
// Path A and Path B interchangeably.
//
// Usage:
//   node e2e-process-s3.js --report-url <S3_URL> --output-dir <DIR> \
//     [--last N] [--screenshots N] [--cleanup] [--title <string>] [--test-id <string>]
//
// <S3_URL> is a Playwright HTML report base URL, e.g.:
//   https://d38p2avprg8il3.cloudfront.net/playwright-report-<run>-<attempt>-<id>-<os>/
//
// Options:
//   --report-url <url>   CloudFront base URL of the Playwright HTML report (required)
//   --output-dir <dir>   Where to save screenshots and error-context (required)
//   --last <N>           Number of trace actions to show (default: 500)
//   --screenshots <N>    Number of trailing screencast frames to extract per attempt (default: 3)
//   --cleanup            Remove the intermediate tmp dir after processing (default: keep)
//   --title <string>     Only process the failed test with this exact title -- skips
//                         downloading/parsing traces and logs for every other failed test
//                         in the report. A CI report often bundles several unrelated
//                         failures; use this when you already know which one you want.
//   --test-id <string>   Same idea, matched against the Playwright testId instead of the
//                         title (e.g. the value after "testId=" in a report_url fragment).

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
	buildDomPresence,
	extractTraceClock,
	findFailureWindow,
	mineLogs,
	phaseLabel,
	relevanceHintsForSpec,
	traceEpochOrigin,
} from './lib-failure-window.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);
let reportUrl = null;
let outputDir = null;
let lastN = 500;
let screenshotsN = 3;
let doCleanup = false;
let titleFilter = null;
let testIdFilter = null;
let rawLogsOut = null;

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
		case '--report-url': reportUrl = cliArgs[++i]; break;
		case '--output-dir': outputDir = cliArgs[++i]; break;
		case '--last': lastN = parseNonNegInt('--last', cliArgs[++i]); break;
		case '--screenshots': screenshotsN = parseNonNegInt('--screenshots', cliArgs[++i]); break;
		case '--cleanup': doCleanup = true; break;
		case '--title': titleFilter = cliArgs[++i]; break;
		case '--test-id': testIdFilter = cliArgs[++i]; break;
		case '--raw-logs-out': rawLogsOut = cliArgs[++i]; break;
		default:
			console.error(`Unknown argument: ${cliArgs[i]}`);
			process.exit(1);
	}
}

if (!reportUrl || !outputDir) {
	console.error('Usage: node e2e-process-s3.js --report-url <S3_URL> --output-dir <DIR> [--last N] [--screenshots N] [--cleanup] [--title <string>] [--test-id <string>]');
	process.exit(1);
}

/** True when the test matches every filter that was actually supplied on the CLI. */
function matchesFilter(test) {
	if (titleFilter !== null) {
		const fullTitle = [...(test.path || []), test.title].filter(Boolean).join(' > ');
		if (fullTitle !== titleFilter) { return false; }
	}
	if (testIdFilter !== null && test.testId !== testIdFilter) { return false; }
	return true;
}

// Normalize report URL to end with a single slash for clean joins.
if (!reportUrl.endsWith('/')) { reportUrl += '/'; }

// Last non-empty path segment of the URL serves as the "blob" id (traceability
// only; Path B has no actual blob zip).
const blobName = (() => {
	try {
		const u = new URL(reportUrl);
		const parts = u.pathname.split('/').filter(Boolean);
		return parts[parts.length - 1] || u.hostname;
	} catch {
		return reportUrl.replace(/\/+$/, '').split('/').pop() || 'unknown';
	}
})();

const resolvedOutputDir = resolve(outputDir);
mkdirSync(join(resolvedOutputDir, 'screenshots'), { recursive: true });
mkdirSync(join(resolvedOutputDir, 'error-context'), { recursive: true });

const tmpWorkDir = join(tmpdir(), `e2e-process-s3-${randomBytes(4).toString('hex')}`);
mkdirSync(tmpWorkDir, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAIL = new Set(['failed', 'timedOut', 'interrupted']);

async function fetchToBuffer(url) {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
	}
	const ab = await res.arrayBuffer();
	return Buffer.from(ab);
}

async function fetchToFile(url, destPath) {
	const buf = await fetchToBuffer(url);
	writeFileSync(destPath, buf);
	return destPath;
}

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

function unzipAll(zipPath, destDir) {
	mkdirSync(destDir, { recursive: true });
	execFileSync('unzip', ['-o', zipPath, '-d', destDir], {
		stdio: ['pipe', 'pipe', 'pipe'],
	});
}

/**
 * Collect the selectors involved in FAILED actions/assertions: the selector on
 * the nearest preceding `before`, plus any `locator('...')` mined from the error
 * message.
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
 * command executions, runtime-startup phase transitions, and errors/warnings.
 * Distinguishes "click was swallowed" from "command ran but nothing rendered."
 */
function buildConsoleDigest(evts) {
	const ALLOW = /(CommandService#executeCommand|Runtime startup][^\n]*Phase changed|Discovery completed|Uncaught|Unhandled)/i;
	const MAX_LINES = 28;
	// Look back far enough to catch a command that fired and then left the test
	// waiting on UI that never came: the classic "click did nothing" timeout has
	// the triggering command ~15-30s before the failing assertion, so a tight
	// window would drop the very command-fired signal this digest exists to
	// surface. 30s covers Playwright's max default timeout; the tight allowlist,
	// dedup, and priority cap below keep the wider window from getting noisy.
	const LOOKBACK_MS = 30000;
	const consoles = evts.filter(e => e.type === 'console' && typeof e.text === 'string');
	if (!consoles.length) { return null; }
	const errTimes = evts.filter(e => e.type === 'after' && e.error).map(e => e.endTime ?? e.startTime).filter(t => t != null);
	const focusStart = errTimes.length ? Math.min(...errTimes) - LOOKBACK_MS : -Infinity;
	// Trail the last error by 2s so the test's own teardown stays visible. It is
	// routinely misread as a cause, so showing it LABELLED beats hiding it.
	const focusEnd = errTimes.length ? Math.max(...errTimes) + 2000 : Infinity;
	const win = findFailureWindow(evts);
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
		// Command/phase/error lines are the load-bearing signal; warnings are
		// context. Track priority so the cap can never drop a command-fired or
		// phase line in favor of a warning.
		const high = ALLOW.test(e.text) || e.messageType === 'error';
		entries.push({ time: e.time, level: e.messageType || 'log', text, count: 1, high, phase: phaseLabel(e.time, win) });
	}

	// Rank before capping so a post-deadline teardown line can never displace a
	// line from inside the wait: only the wait can contain a cause.
	const rank = (e) => (e.phase === 'after deadline' ? 0 : 2) + (e.high ? 1 : 0);
	const shown = entries.length <= MAX_LINES
		? entries
		: [...entries].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_LINES).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
	const out = [`\n=== Console digest near failure (${shown.length}${entries.length > shown.length ? ` of ${entries.length}` : ''} high-signal lines) ===`];
	if (win?.deadlineT != null) {
		out.push(`Failing action: ${win.method || 'unknown'}; waited t=${win.actionStartT != null ? Math.round(win.actionStartT) : '?'}..${Math.round(win.deadlineT)}.`);
		out.push("Lines are tagged by position relative to that wait. [after deadline] means the line was emitted AFTER the assertion had already failed, so it CANNOT be the cause -- these are usually the test's own finally/teardown (a sign-out, a settings reset), whose side effects are routinely misread as root causes.");
	}
	for (const e of shown) {
		out.push(`t=${Math.round(e.time ?? 0)}${e.phase ? ` [${e.phase}]` : ''} [${e.level}] ${e.text}${e.count > 1 ? ` (x${e.count})` : ''}`);
	}
	return out.join('\n');
}

/**
 * Parse a Playwright trace.trace file into a timeline plus the trailing
 * screencast frames. Identical to the parser in e2e-process-project.js; kept
 * inline here to avoid cross-script imports.
 */
function parseTrace(tracePath) {
	const content = readFileSync(tracePath, 'utf8');
	const lines = content.split('\n').filter(Boolean);
	const events = [];
	for (const line of lines) {
		try { events.push(JSON.parse(line)); } catch { /* skip */ }
	}

	const actions = events.filter(e => e.type === 'before' || e.type === 'after');
	const recent = lastN === 0 ? [] : actions.slice(-lastN);

	const timelineLines = [];
	timelineLines.push(`=== Action Timeline (last ${recent.length} of ${actions.length} events) ===\n`);

	const traceT0 = traceEpochOrigin(events);
	if (traceT0 != null) {
		timelineLines.push(`Trace t=0 = ${new Date(traceT0).toISOString()} -- add (t / 1000) seconds to any t= below to get wall clock.\n`);
	}

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

	// DOM-presence of the failing selector(s) + a console digest near the
	// failure -- separates "the control never rendered" / "the command fired but
	// nothing happened" from a pure environment flake.
	const domPresence = buildDomPresence(events, selectorTokens(collectFailingSelectors(events)));
	if (domPresence) { timelineLines.push(domPresence); }
	const consoleDigest = buildConsoleDigest(events);
	if (consoleDigest) { timelineLines.push(consoleDigest); }

	return {
		timeline: timelineLines.join('\n'),
		errors,
		screenshotShas: trailingScreenshots.map(s => ({ sha1: s.sha1, timestamp: s.timestamp })),
		lastScreenshotSha1: lastScreenshot?.sha1 || null,
		// Dual-clock anchor + the failing action's wait interval. Not rendered into
		// the timeline; the log miner needs them to relate the trace's monotonic
		// `t=` to the wall-clock timestamps in the attached *.log files.
		clock: extractTraceClock(events),
		failureWindow: findFailureWindow(events),
	};
}

/**
 * Extract the playwrightReportBase64 payload from a Playwright HTML report's
 * index.html. The template element holds a `data:application/zip;base64,...`
 * URL; return just the base64 string.
 */
function extractReportBase64(html) {
	const m = html.match(/<template id="playwrightReportBase64">data:application\/zip;base64,([^<]+)<\/template>/);
	if (!m) {
		throw new Error('Could not find <template id="playwrightReportBase64"> in index.html');
	}
	return m[1];
}

/** Extract the sha-style hash from an attachment path like "data/<sha>.zip" or "data/<sha>.md". */
function hashFromPath(p) {
	const m = String(p || '').match(/([a-f0-9]{20,})\./);
	return m ? m[1] : null;
}

// Log mining. Mirrors e2e-process-project.js (Path A) so both paths surface the
// same evidence. The windowing logic itself lives in lib-failure-window.js
// (shared by both paths and e2e-parse-trace.js) so the trace-clock correlation
// has exactly one implementation.

/**
 * Mine the downloaded log bundle for the failure window: all severities inside
 * the failing action's wait, plus a derived "went quiet before the deadline"
 * report. Falls back to the old error-line grep when the trace carries no
 * wall-clock anchor.
 *
 * The previous implementation was an error-keyword grep, which structurally
 * could not surface either of the two things that most often settle a diagnosis:
 * an info-level success line (which refutes an "external dependency broke"
 * theory) and a log going silent exactly when the UI should have appeared.
 */
function mineLogBundle(logsZipPath, trace, specPath) {
	return mineLogs(logsZipPath, {
		tmpDir: tmpWorkDir,
		clock: trace?.clock || null,
		window: trace?.failureWindow || null,
		hints: relevanceHintsForSpec(specPath),
	});
}

// ---------------------------------------------------------------------------
// Step 1: download and unpack the embedded report.zip
// ---------------------------------------------------------------------------

const indexUrl = `${reportUrl}index.html`;
process.stderr.write(`Fetching ${indexUrl}...\n`);
const indexHtml = (await fetchToBuffer(indexUrl)).toString('utf8');

process.stderr.write('Extracting embedded report.zip...\n');
const reportZipPath = join(tmpWorkDir, 'report.zip');
writeFileSync(reportZipPath, Buffer.from(extractReportBase64(indexHtml), 'base64'));

const reportDir = join(tmpWorkDir, 'report-contents');
process.stderr.write('Unzipping report archive...\n');
unzipAll(reportZipPath, reportDir);

const reportJsonPath = join(reportDir, 'report.json');
if (!existsSync(reportJsonPath)) {
	console.error(`report.json not found in ${reportDir}`);
	process.exit(1);
}
const report = JSON.parse(readFileSync(reportJsonPath, 'utf8'));

// ---------------------------------------------------------------------------
// Step 2: walk files, find failed tests, build core arrays
// ---------------------------------------------------------------------------

const failures = [];
const failedTests = [];
const testDetailsList = [];

for (const fileSummary of report.files || []) {
	const hasFailures = (fileSummary.tests || []).some(t => t.outcome === 'unexpected' || t.outcome === 'flaky');
	if (!hasFailures) continue;

	const detailPath = join(reportDir, `${fileSummary.fileId}.json`);
	if (!existsSync(detailPath)) {
		process.stderr.write(`WARN: detail file missing for ${fileSummary.fileName} (${fileSummary.fileId})\n`);
		continue;
	}
	const detail = JSON.parse(readFileSync(detailPath, 'utf8'));

	for (const test of detail.tests || []) {
		if (test.outcome !== 'unexpected' && test.outcome !== 'flaky') continue;
		if (!matchesFilter(test)) continue;

		const failedResults = (test.results || []).filter(r => FAIL.has(r.status));

		// HARD failures (exhausted retries) go into the top-level failures[].
		if (test.outcome === 'unexpected') {
			failures.push({
				title: test.title,
				file: detail.fileName,
				tags: test.tags || [],
				suite: (test.path || []).filter(Boolean).join(' > '),
				project: test.projectName || 'unknown',
				errors: failedResults.map(r => ({
					status: r.status,
					error: (r.errors?.[0]?.message || '').slice(0, 2000),
					snippet: (r.errors?.[0]?.codeframe || '').slice(0, 1000),
				})),
			});
		}

		// All failed attempts (incl. flaky recoveries) go into failedTests[].
		for (const r of failedResults) {
			failedTests.push({
				testId: test.testId,
				title: test.title,
				file: detail.fileName,
				status: r.status,
				blob: blobName,
			});
		}

		// Stash for the per-attempt processing pass below.
		testDetailsList.push({ test, detail, failedResults });
	}
}

process.stderr.write(`Found ${failures.length} hard failures, ${failedTests.length} failed attempts across ${testDetailsList.length} unique failed tests.\n`);
if ((titleFilter !== null || testIdFilter !== null) && testDetailsList.length === 0) {
	process.stderr.write(`WARN: --title/--test-id filter matched 0 failed tests in this report -- check the exact title/testId.\n`);
}

// ---------------------------------------------------------------------------
// Step 3: per-attempt processing -- download traces + error-context, parse,
// extract screencast frames.
// ---------------------------------------------------------------------------

const testDetails = [];

for (const { test, detail, failedResults } of testDetailsList) {
	const shortId = test.testId.slice(0, 12);
	const attempts = [];
	const logHashes = [];
	let lastLogsAttPath = null; // S3 path of the most recent attempt's logs bundle, for grepping

	for (let i = 0; i < failedResults.length; i++) {
		const r = failedResults[i];
		const traceAtt = (r.attachments || []).find(a => a.name === 'trace' && a.contentType === 'application/zip');
		const errCtxAtt = (r.attachments || []).find(a => a.name === 'error-context' && a.contentType === 'text/markdown');
		const logsAtts = (r.attachments || []).filter(a => /^logs[-_]/.test(a.name || '') && a.contentType === 'application/zip');

		for (const lAtt of logsAtts) {
			const hash = hashFromPath(lAtt.path);
			if (hash) { logHashes.push({ resourceHash: hash, blob: blobName }); }
		}
		if (logsAtts.length && logsAtts[logsAtts.length - 1].path) {
			lastLogsAttPath = logsAtts[logsAtts.length - 1].path;
		}

		let traceData = null;
		let screenshotPath = null;
		const screenshotPaths = [];

		if (traceAtt?.path) {
			process.stderr.write(`  Processing trace for ${shortId} attempt ${i}...\n`);
			const traceUrl = `${reportUrl}${traceAtt.path}`;
			const localTraceZip = join(tmpWorkDir, `trace-${shortId}-${i}.zip`);

			try {
				await fetchToFile(traceUrl, localTraceZip);
				// Trace zip from S3 is the trace itself (not a wrapper around resources/<sha>.zip
				// like Path A's blob format). Extract trace.trace directly.
				const traceExtractDir = join(tmpWorkDir, `trace-extracted-${shortId}-${i}`);
				const tracePath = unzipFile(localTraceZip, 'trace.trace', traceExtractDir);

				if (tracePath) {
					traceData = parseTrace(tracePath);

					// Extract trailing N screencast frames in chronological order.
					const frames = traceData.screenshotShas || [];
					for (let j = 0; j < frames.length; j++) {
						const sha = frames[j].sha1;
						if (!sha) { continue; }
						const ssFileName = `${shortId}-attempt${i}-frame${j}.jpeg`;
						const ssDestPath = join(resolvedOutputDir, 'screenshots', ssFileName);
						const ssEntry = `resources/${sha}`;
						const ssTempDir = join(tmpWorkDir, `ss-${shortId}-${i}-${j}`);
						const ssExtracted = unzipFile(localTraceZip, ssEntry, ssTempDir);

						if (ssExtracted) {
							writeFileSync(ssDestPath, readFileSync(ssExtracted));
							screenshotPaths.push(ssDestPath);
						}
					}
					screenshotPath = screenshotPaths.length > 0
						? screenshotPaths[screenshotPaths.length - 1]
						: null;
				}
			} catch (err) {
				process.stderr.write(`  WARN: failed to process trace ${traceUrl}: ${err.message}\n`);
			}
		}

		let errorContextPath = null;
		if (errCtxAtt?.path) {
			const ctxUrl = `${reportUrl}${errCtxAtt.path}`;
			const mdFileName = `${shortId}-attempt${i}.md`;
			const mdDestPath = join(resolvedOutputDir, 'error-context', mdFileName);
			try {
				await fetchToFile(ctxUrl, mdDestPath);
				errorContextPath = mdDestPath;
			} catch (err) {
				process.stderr.write(`  WARN: failed to download error-context ${ctxUrl}: ${err.message}\n`);
			}
		}

		attempts.push({
			attemptIndex: i,
			trace: traceData,
			screenshotPath,
			screenshotPaths,
			errorContextPath,
		});
	}

	// Mine the attached log bundle for the failure window (download it from S3
	// first). Runs after the trace loop because the window and wall-clock anchor
	// come out of the trace -- the logs cannot be time-sliced without them.
	let logExcerpt = null;
	let rawLogsDir = null;
	if (lastLogsAttPath) {
		const logsUrl = `${reportUrl}${lastLogsAttPath}`;
		const localLogsZip = join(tmpWorkDir, `logs-${shortId}.zip`);
		try {
			await fetchToFile(logsUrl, localLogsZip);
			const lastTrace = attempts[attempts.length - 1]?.trace || null;
			logExcerpt = mineLogBundle(localLogsZip, lastTrace, detail.fileName);
			// Extract the bundle where the caller asked for it. Callers used to have
			// to hunt the kept temp dir for logs-<shortId>.zip, but shortId is the
			// spec-FILE hash, so every test in a file produces the same zip name --
			// a stale dir from an earlier run of a sibling test is indistinguishable
			// by name and silently yields the wrong run's logs.
			if (rawLogsOut) {
				rawLogsDir = join(rawLogsOut, shortId);
				mkdirSync(rawLogsDir, { recursive: true });
				execFileSync('unzip', ['-o', localLogsZip, '-d', rawLogsDir], { stdio: ['pipe', 'pipe', 'pipe'] });
			}
		} catch (err) {
			process.stderr.write(`  WARN: failed to process logs ${logsUrl}: ${err.message}\n`);
		}
	}

	// Sibling tests in the same file (passed siblings are the key signal: they
	// prove shared setup/fixtures ran). detail.tests holds every test in the file.
	const siblingTests = (detail.tests || [])
		.filter(x => x.title !== test.title && x.outcome !== 'skipped')
		.map(x => ({ title: x.title, status: x.outcome === 'unexpected' ? 'failed' : 'passed' }));

	const firstFailed = failedResults[0];
	testDetails.push({
		testId: test.testId,
		title: test.title,
		file: detail.fileName,
		status: firstFailed?.status || null,
		blob: blobName,
		attemptCount: failedResults.length,
		attempts,
		siblingTests,
		logExcerpt,
		rawLogsDir,
		logHashes,
	});
}

// ---------------------------------------------------------------------------
// Cleanup + output
// ---------------------------------------------------------------------------

if (doCleanup) {
	try { rmSync(tmpWorkDir, { recursive: true, force: true }); } catch { /* best effort */ }
} else {
	process.stderr.write(`(temp dir kept at ${tmpWorkDir} -- pass --cleanup to remove)\n`);
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
