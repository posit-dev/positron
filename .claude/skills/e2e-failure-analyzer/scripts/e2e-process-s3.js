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
//     [--last N] [--screenshots N] [--cleanup]
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

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);
let reportUrl = null;
let outputDir = null;
let lastN = 500;
let screenshotsN = 3;
let doCleanup = false;

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
		default:
			console.error(`Unknown argument: ${cliArgs[i]}`);
			process.exit(1);
	}
}

if (!reportUrl || !outputDir) {
	console.error('Usage: node e2e-process-s3.js --report-url <S3_URL> --output-dir <DIR> [--last N] [--screenshots N] [--cleanup]');
	process.exit(1);
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

	return {
		timeline: timelineLines.join('\n'),
		errors,
		screenshotShas: trailingScreenshots.map(s => ({ sha1: s.sha1, timestamp: s.timestamp })),
		lastScreenshotSha1: lastScreenshot?.sha1 || null,
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

// ---------------------------------------------------------------------------
// Step 3: per-attempt processing -- download traces + error-context, parse,
// extract screencast frames.
// ---------------------------------------------------------------------------

const testDetails = [];

for (const { test, detail, failedResults } of testDetailsList) {
	const shortId = test.testId.slice(0, 12);
	const attempts = [];
	const logHashes = [];

	for (let i = 0; i < failedResults.length; i++) {
		const r = failedResults[i];
		const traceAtt = (r.attachments || []).find(a => a.name === 'trace' && a.contentType === 'application/zip');
		const errCtxAtt = (r.attachments || []).find(a => a.name === 'error-context' && a.contentType === 'text/markdown');
		const logsAtts = (r.attachments || []).filter(a => /^logs[-_]/.test(a.name || '') && a.contentType === 'application/zip');

		for (const lAtt of logsAtts) {
			const hash = hashFromPath(lAtt.path);
			if (hash) { logHashes.push({ resourceHash: hash, blob: blobName }); }
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

	const firstFailed = failedResults[0];
	testDetails.push({
		testId: test.testId,
		title: test.title,
		file: detail.fileName,
		status: firstFailed?.status || null,
		blob: blobName,
		attemptCount: failedResults.length,
		attempts,
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
