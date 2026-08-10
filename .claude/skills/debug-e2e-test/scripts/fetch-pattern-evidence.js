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
// The testId filter is read from the --report-url fragment, never from a flag;
// --title is the fallback for a URL that carries no testId.
//
// --occurrence nests the artifacts under evidence/<pattern>/<label>, so several
// occurrences of the same pattern can be compared side by side instead of
// overwriting each other.
//
// Output (stdout): compact JSON manifest { evidenceDir, summaryFile,
//   timelineFile, snapshotFile, screenshots[], rawLogDir, rawLogsRetained,
//   failure }.

import path from 'path';
import fs from 'fs';
import {
	analyzerScript, triageDir, ensureDir, writeJson, writeText,
	emit, fail, runNode, isMain, parseArgs, defineCli, handleHelp,
	stripAnsi, FAILURE_TEXT_LIMIT,
} from './lib.js';

export const CLI = defineCli({
	name: 'fetch-pattern-evidence.js',
	summary: 'pull evidence for ONE occurrence of ONE failure pattern, summary-first',
	usage: ['--report-url <url> --triage-id <id> [--pattern A] [options]'],
	flags: [
		{ name: 'report-url', value: '<url>', required: true, description: "the pattern's representativeOccurrence.report_url; the index.html#?testId= fragment is stripped and the testId reused as the filter" },
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
 * Build a compact, deterministic evidence summary from the processor result.
 * The model reads this first and opens the full timeline/snapshot/logs only to
 * answer a concrete unresolved question.
 */
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
	if (!reportUrl) { fail('Missing --report-url.'); }
	if (!triageId) { fail('Missing --triage-id.'); }

	const { baseUrl, testId } = normalizeReportUrl(reportUrl);
	const title = args.title || null;
	const filterArgs = [];
	if (testId) { filterArgs.push('--test-id', testId); }
	else if (title) { filterArgs.push('--title', title); }

	const occurrence = args.occurrence || null;
	const evidenceDir = ensureDir(path.join(
		triageDir(triageId), 'evidence', pattern, ...(occurrence ? [occurrence] : []),
	));
	clearManagedArtifacts(evidenceDir);
	const rawLogsDir = path.join(evidenceDir, 'raw-logs');

	let stdout;
	try {
		const procArgs = ['--report-url', baseUrl, '--output-dir', evidenceDir, ...filterArgs];
		// Extract raw logs into this triage's evidence dir rather than leaving them
		// in a shared temp dir, where logs-<shortId>.zip collides across every test
		// in the same spec file and a stale sibling's bundle reads as this run's.
		if (args['keep-raw-logs']) { procArgs.push('--raw-logs-out', rawLogsDir); }
		else { procArgs.push('--cleanup'); }
		stdout = runNode(analyzerScript('e2e-process-s3.js'), procArgs);
	} catch (err) {
		fail(`e2e-process-s3.js failed (report may be 403/expired -- try the next occurrence's report_url): ${err.message}`, { triageId, pattern });
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
	});
}

if (isMain(import.meta.url)) { main(); }
