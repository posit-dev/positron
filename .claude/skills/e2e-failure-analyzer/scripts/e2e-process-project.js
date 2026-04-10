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
//   --last <N>           Number of trace actions to show (default: 30)
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
let lastN = 30;
let doDownload = false;
let runId = null;
let repo = null;
let project = null;
let doCleanup = false;

for (let i = 0; i < cliArgs.length; i++) {
	switch (cliArgs[i]) {
		case '--output-dir': outputDir = cliArgs[++i]; break;
		case '--last': lastN = parseInt(cliArgs[++i], 10); break;
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
//    (logic from e2e-parse-trace.js)
// ---------------------------------------------------------------------------
function parseTrace(tracePath) {
	const content = readFileSync(tracePath, 'utf8');
	const lines = content.split('\n').filter(Boolean);
	const events = [];
	for (const line of lines) {
		try { events.push(JSON.parse(line)); } catch { /* skip */ }
	}

	const actions = events.filter(e => e.type === 'before' || e.type === 'after');
	const recent = actions.slice(-lastN);

	const timelineLines = [];
	timelineLines.push(`=== Action Timeline (last ${Math.min(lastN, actions.length)} of ${actions.length} events) ===\n`);

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
	const lastScreenshot = screenshots.length > 0 ? screenshots[screenshots.length - 1] : null;

	if (lastScreenshot) {
		timelineLines.push(`\n=== Screenshots ===`);
		timelineLines.push(`Total screencast frames: ${screenshots.length}`);
		timelineLines.push(`Last screenshot sha1: ${lastScreenshot.sha1}`);
		timelineLines.push(`Last screenshot timestamp: ${lastScreenshot.timestamp}`);
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

// ---------------------------------------------------------------------------
// Main processing
// ---------------------------------------------------------------------------

process.stderr.write('Extracting failures from merged report...\n');
const failures = extractFailures(resolvedReportPath);

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

	for (let i = 0; i < traceAtts.length; i++) {
		const traceAtt = traceAtts[i];
		const errorCtxAtt = errorCtxAtts[i]; // may be undefined

		let traceData = null;
		let screenshotPath = null;

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

					// Step 3: extract last screenshot from resource zip
					// The sha1 field from screencast-frame events is the full filename
					// including extension (e.g., "page@abc123-timestamp.jpeg")
					if (traceData.lastScreenshotSha1) {
						const ssFileName = `${shortId}-attempt${i}.jpeg`;
						const ssDestPath = join(resolvedOutputDir, 'screenshots', ssFileName);
						const ssEntry = `resources/${traceData.lastScreenshotSha1}`;
						const ssTempDir = join(tmpWorkDir, `ss-${shortId}-${i}`);
						const ssExtracted = unzipFile(resourceZipPath, ssEntry, ssTempDir);

						if (ssExtracted) {
							writeFileSync(ssDestPath, readFileSync(ssExtracted));
							screenshotPath = ssDestPath;
						}
					}
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
			screenshotPath,
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
