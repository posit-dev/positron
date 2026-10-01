#!/usr/bin/env node
// fetch-pattern-evidence.js -- summary-first evidence retrieval for ONE
// occurrence of ONE failure pattern.
//
// Wraps e2e-failure-analyzer/scripts/e2e-process-s3.js: normalizes the report
// URL, runs the processor filtered to the one test under triage, writes the
// full evidence JSON + full trace timeline to disk, and prints a compact
// manifest (file paths + a deterministic summary) rather than the multi-megabyte
// processor payload.
//
// Flags: see CLI below, or run with --help.
//
// Without --report-url, it walks the pattern's occurrences from
// history-summary.json in order and skips any report that 403s/404s (still
// uploading, or expired) -- that is a substitution, not a second fetch.
//
// The testId filter is read from the report URL's fragment, never from a flag;
// --title is the fallback for a URL that carries no testId.
//
// --occurrence nests the artifacts under evidence/<pattern>/<label>, so several
// occurrences of the same pattern can be compared side by side instead of
// overwriting each other.
//
// Output (stdout): compact JSON manifest { evidenceDir, summaryFile,
//   timelineFile, snapshotFile, screenshots[], rawLogDir, rawLogsRetained,
//   failure, occurrence, skipped[] }.

import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import {
	analyzerScript, triageDir, ensureDir, writeJson, writeText, readJson,
	emit, fail, isMain, parseArgs, defineCli, handleHelp, repoRoot,
	stripAnsi, FAILURE_TEXT_LIMIT,
} from './lib.js';

export const CLI = defineCli({
	name: 'fetch-pattern-evidence.js',
	summary: 'pull evidence for ONE occurrence of ONE failure pattern, summary-first',
	usage: ['--triage-id <id> --pattern A [options]', '--report-url <url> --triage-id <id> [--pattern A] [options]'],
	flags: [
		{ name: 'report-url', value: '<url>', description: "one specific occurrence's report_url, fetched with no fallback (default: walk the pattern's occurrences from history-summary.json, skipping unfetchable reports); the index.html#?testId= fragment is stripped and the testId reused as the filter" },
		{ name: 'triage-id', value: '<id>', required: true, description: 'work-dir id from triage-history.js' },
		{ name: 'pattern', value: '<id>', description: 'names the evidence sub-directory (default: A)' },
		{ name: 'title', value: '<full title>', description: 'filter fallback when the URL carries no testId' },
		{ name: 'keep-raw-logs', type: 'boolean', description: 'extract raw logs into <evidenceDir>/raw-logs/ instead of letting the processor clean them up' },
		{ name: 'occurrence', value: '<label>', description: 'nest artifacts under evidence/<pattern>/<label> so several occurrences can coexist' },
	],
});

/**
 * Split a test-health report_url into the base directory URL the S3 processor
 * expects and the optional testId from the fragment. The processor appends
 * index.html itself, so anything from index.html onward must be stripped.
 */
export function normalizeReportUrl(reportUrl) {
	const url = String(reportUrl || '');
	const base = url.replace(/index\.html.*$/, '');
	const m = url.match(/testId=([^&\s]+)/);
	return { baseUrl: base.endsWith('/') ? base : base + '/', testId: m ? m[1] : null };
}

/**
 * Artifacts this script owns inside an evidence dir, cleared before each fetch.
 *
 * The dir is keyed by pattern, not by occurrence. The processor overwrites
 * summary.md and evidence-raw.json but leaves a previous --keep-raw-logs bundle
 * in place, so without this a prior occurrence's logs read as this one's. Every
 * name here is regenerated from the report, so clearing is always safe.
 */
const MANAGED_ARTIFACTS = [
	'raw-logs', 'screenshots', 'error-context',
	'summary.md', 'timeline.txt', 'evidence-raw.json',
];

export function clearManagedArtifacts(evidenceDir) {
	const present = MANAGED_ARTIFACTS.filter(n => fs.existsSync(path.join(evidenceDir, n)));
	for (const name of present) {
		fs.rmSync(path.join(evidenceDir, name), { recursive: true, force: true });
	}
	return present;
}

/**
 * True when the processor failed because the report itself is not fetchable --
 * a 403/404 from the report host, i.e. the run is still uploading or the report
 * expired. Only these fall through to the next occurrence; any other failure is
 * a processor bug and must surface.
 */
export function isUnfetchableReport(stderr) {
	return /HTTP (403|404)\b/.test(String(stderr || ''));
}

/**
 * Report URLs to try, in order: the explicit --report-url alone, or every
 * occurrence of the pattern that has one (representative first).
 */
export function candidateOccurrences(historySummary, patternId, reportUrl) {
	if (reportUrl) { return [{ report_url: reportUrl }]; }
	const p = (historySummary?.patterns || []).find(x => x.id === patternId);
	if (!p) { return null; }
	const list = p.occurrences || (p.representativeOccurrence ? [p.representativeOccurrence] : []);
	return list.filter(o => o.report_url);
}

/** Run the processor, capturing stderr so a 403 can be told apart from a crash. */
function runProcessor(args) {
	try {
		return { ok: true, stdout: execFileSync('node', [analyzerScript('e2e-process-s3.js'), ...args], {
			cwd: repoRoot(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe'],
		}) };
	} catch (err) {
		return { ok: false, stderr: err.stderr ? String(err.stderr) : String(err.message) };
	}
}

/** Pick the single test detail matching the filter, or the sole one present. */
function selectDetail(result, { title, testId }) {
	const details = result.testDetails || [];
	if (testId) { return details.find(d => d.testId === testId) || details[0] || null; }
	if (title) {
		return details.find(d => {
			const full = [...(d.pathTitles || []), d.title].filter(Boolean).join(' > ');
			return full === title || d.title === title;
		}) || details[0] || null;
	}
	return details[0] || null;
}

/**
 * The report's own failure text for this test: locator, matched elements and
 * code frame. The trace's error list reduces the same failure to a stub
 * ("Expect failed"), which names neither the assertion nor the locator.
 */
export function reportFailureText(result, detail) {
	const failures = (result.failures || []).filter(f => f && typeof f === 'object');
	const byIdentity = failures.filter(f =>
		f.title === detail.title && (!f.file || !detail.file || f.file === detail.file));
	const match = byIdentity[0] || (failures.length === 1 ? failures[0] : null);
	// errors[0] is attempt 0 -- the failure itself, not a passing retry.
	const text = stripAnsi(((match || {}).errors || [])[0]?.error || '').trim();
	return text || null;
}

/**
 * Build a compact, deterministic evidence summary from the processor result.
 * The model reads this first and opens the full timeline/snapshot/logs only to
 * answer a concrete unresolved question.
 */
export function buildEvidenceSummary(result, filter = {}) {
	const detail = selectDetail(result, filter);
	if (!detail) {
		return { markdown: '# Evidence summary\n\nNo matching test detail in the report.\n', timeline: '', snapshotFile: null, screenshots: [], failure: null };
	}
	const attempt = (detail.attempts || [])[0] || {};
	const trace = attempt.trace || {};
	const errors = trace.errors || [];
	const failure = reportFailureText(result, detail) || errors[errors.length - 1] || null;

	const timeline = trace.timeline || '';
	// Timeline tail: the last ~14 action/error lines, a deterministic slice (not
	// an LLM paraphrase). The full timeline is written to disk for escalation.
	const timelineLines = timeline.split('\n').filter(Boolean);
	// Keep the t=0 anchor with the tail. It lives in the timeline's header, which
	// the tail slice would drop -- leaving every t= below unconvertible to wall
	// clock unless someone back-derives an origin, which is how a triage ends up
	// reading the right evidence against the wrong minute.
	const t0Line = timelineLines.find(l => l.startsWith('Trace t=0 ='));
	const tail = [...(t0Line ? [t0Line, ''] : []), ...timelineLines.slice(-14)];

	const siblings = (detail.siblingTests || [])
		.map(s => `- ${s.title} (${s.status})`);
	const logLines = (detail.logExcerpt || '').split('\n').filter(Boolean);

	const md = [
		'# Evidence summary',
		'',
		'## Failure',
		'',
		failure ? '```\n' + failure.slice(0, FAILURE_TEXT_LIMIT) + '\n```' : '(no error captured in trace)',
		'',
		'## Timeline tail (last actions before failure)',
		'',
		'```',
		...tail,
		'```',
		'',
		'## Sibling tests in the same file',
		'',
		siblings.length ? siblings.join('\n') : '(none)',
		'',
		'## Error-shaped log lines',
		'',
		logLines.length ? '```\n' + logLines.slice(0, 20).join('\n') + '\n```' : '(no error-shaped lines mined -- a race shows no error line by construction; read raw logs for ordering)',
		'',
		'## Unresolved questions',
		'',
		'- Does the timeline tail explain the failure, or is the mechanism ordering/timing that error-shaped log mining cannot show?',
		'- Is the error-context snapshot consistent with the assertion, or does it point at an unexpected surface?',
		'',
		'_Open the full timeline / snapshot / raw logs only to answer one of the above._',
		'',
	].join('\n');

	return {
		markdown: md,
		timeline,
		snapshotFile: attempt.errorContextPath || null,
		screenshots: attempt.screenshotPaths || (attempt.screenshotPath ? [attempt.screenshotPath] : []),
		failure,
	};
}

function main() {
	handleHelp(CLI, process.argv.slice(2));
	const args = parseArgs(process.argv.slice(2), CLI.booleanFlags);
	const reportUrl = args['report-url'];
	const triageId = args['triage-id'];
	const pattern = args.pattern || 'A';
	if (!triageId) { fail('Missing --triage-id.'); }

	let history = null;
	if (!reportUrl) {
		const historyFile = path.join(triageDir(triageId), 'history-summary.json');
		if (!fs.existsSync(historyFile)) { fail(`No --report-url and no ${historyFile}; run triage-history.js first.`, { triageId, pattern }); }
		history = readJson(historyFile);
	}
	const candidates = candidateOccurrences(history, pattern, reportUrl);
	if (!candidates) { fail(`Pattern ${pattern} is not in history-summary.json.`, { triageId, pattern }); }
	if (!candidates.length) { fail(`Pattern ${pattern} has no occurrence with a report_url.`, { triageId, pattern }); }

	const title = args.title || null;
	const occurrenceLabel = args.occurrence || null;
	const evidenceDir = ensureDir(path.join(
		triageDir(triageId), 'evidence', pattern, ...(occurrenceLabel ? [occurrenceLabel] : []),
	));
	const rawLogsDir = path.join(evidenceDir, 'raw-logs');

	let stdout;
	let used = null;
	let testId = null;
	const skipped = [];
	for (const cand of candidates) {
		const norm = normalizeReportUrl(cand.report_url);
		const filterArgs = [];
		if (norm.testId) { filterArgs.push('--test-id', norm.testId); }
		else if (title) { filterArgs.push('--title', title); }
		clearManagedArtifacts(evidenceDir);
		const procArgs = ['--report-url', norm.baseUrl, '--output-dir', evidenceDir, ...filterArgs];
		// Extract raw logs into this triage's evidence dir rather than leaving them
		// in a shared temp dir, where logs-<shortId>.zip collides across every test
		// in the same spec file and a stale sibling's bundle reads as this run's.
		if (args['keep-raw-logs']) { procArgs.push('--raw-logs-out', rawLogsDir); }
		else { procArgs.push('--cleanup'); }
		const r = runProcessor(procArgs);
		if (r.ok) { stdout = r.stdout; used = cand; testId = norm.testId; break; }
		if (!isUnfetchableReport(r.stderr) || reportUrl) {
			const hint = isUnfetchableReport(r.stderr) ? ' (report not uploaded yet or expired; omit --report-url to fall back through the pattern\'s occurrences)' : '';
			fail(`e2e-process-s3.js failed${hint}: ${stripAnsi(r.stderr).trim().split('\n').slice(-3).join(' | ')}`, { triageId, pattern, skipped });
		}
		skipped.push({ report_url: cand.report_url, sha: cand.sha ?? null, reason: (r.stderr.match(/HTTP (403|404)[^\n]*/) || ['unfetchable'])[0].slice(0, 40) });
	}
	if (!used) {
		fail(`No fetchable report among ${candidates.length} occurrence(s) of pattern ${pattern}.`, { triageId, pattern, skipped });
	}

	let result;
	try { result = JSON.parse(stdout); }
	catch { fail('Could not parse e2e-process-s3.js output.', { triageId, pattern }); }

	const rawFile = writeJson(path.join(evidenceDir, 'evidence-raw.json'), result);
	const summary = buildEvidenceSummary(result, { title, testId });
	const summaryFile = writeText(path.join(evidenceDir, 'summary.md'), summary.markdown);
	const timelineFile = summary.timeline ? writeText(path.join(evidenceDir, 'timeline.txt'), summary.timeline) : null;

	// Report the raw-log dir this fetch actually produced. The processor only
	// reports rawLogsDir per test detail when --raw-logs-out was passed, so fall
	// back to the dir on disk: a null here next to a populated raw-logs/ is how a
	// stale bundle gets read as the current occurrence's.
	const reportedRawLogs = (result.testDetails || []).find(t => t.rawLogsDir)?.rawLogsDir || null;
	const rawLogDir = reportedRawLogs || (fs.existsSync(rawLogsDir) ? rawLogsDir : null);

	const rel = p => (p ? path.relative(process.cwd(), p) : null);
	emit({
		evidenceDir: rel(evidenceDir),
		summaryFile: rel(summaryFile),
		timelineFile: rel(timelineFile),
		snapshotFile: rel(summary.snapshotFile),
		screenshots: (summary.screenshots || []).map(rel),
		rawLogDir: rel(rawLogDir),
		// Without --keep-raw-logs the processor cleans up its temp extract, so
		// escalating to raw logs means refetching with the flag.
		rawLogsRetained: Boolean(rawLogDir),
		rawEvidenceFile: rel(rawFile),
		failure: summary.failure ? summary.failure.slice(0, 200) : null,
		occurrence: { sha: used.sha ?? null, os: used.os ?? null, browser: used.browser ?? null, report_url: used.report_url },
		skipped,
	});
}

if (isMain(import.meta.url)) { main(); }
