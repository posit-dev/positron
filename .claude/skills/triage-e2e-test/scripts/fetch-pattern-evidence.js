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
// Usage:
//   node fetch-pattern-evidence.js --report-url <url> --triage-id <id> --pattern <A> \
//     (--title '<full title>' | --test-id <id>) [--keep-raw-logs]
//
// Output (stdout): compact JSON manifest { evidenceDir, summaryFile,
//   timelineFile, snapshotFile, screenshots[], rawLogDir, failure }.

import path from 'path';
import fs from 'fs';
import {
	analyzerScript, triageDir, ensureDir, writeJson, writeText,
	emit, fail, runNode, isMain, parseArgs,
} from './lib.js';

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
export function buildEvidenceSummary(result, filter = {}) {
	const detail = selectDetail(result, filter);
	if (!detail) {
		return { markdown: '# Evidence summary\n\nNo matching test detail in the report.\n', timeline: '', snapshotFile: null, screenshots: [], failure: null };
	}
	const attempt = (detail.attempts || [])[0] || {};
	const trace = attempt.trace || {};
	const errors = trace.errors || [];
	const failure = errors[errors.length - 1] || (result.failures || [])[0] || null;

	const timeline = trace.timeline || '';
	// Timeline tail: the last ~14 action/error lines, a deterministic slice (not
	// an LLM paraphrase). The full timeline is written to disk for escalation.
	const tail = timeline.split('\n').filter(Boolean).slice(-14);

	const siblings = (detail.siblingTests || [])
		.map(s => `- ${s.title} (${s.status})`);
	const logLines = (detail.logExcerpt || '').split('\n').filter(Boolean);

	const md = [
		'# Evidence summary',
		'',
		'## Failure',
		'',
		failure ? '```\n' + failure.slice(0, 500) + '\n```' : '(no error captured in trace)',
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
	const args = parseArgs(process.argv.slice(2), ['keep-raw-logs']);
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

	const evidenceDir = ensureDir(path.join(triageDir(triageId), 'evidence', pattern));

	let stdout;
	try {
		const procArgs = ['--report-url', baseUrl, '--output-dir', evidenceDir, ...filterArgs];
		if (!args['keep-raw-logs']) { procArgs.push('--cleanup'); }
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

	const rel = p => (p ? path.relative(process.cwd(), p) : null);
	emit({
		evidenceDir: rel(evidenceDir),
		summaryFile: rel(summaryFile),
		timelineFile: rel(timelineFile),
		snapshotFile: rel(summary.snapshotFile),
		screenshots: (summary.screenshots || []).map(rel),
		rawLogDir: args['keep-raw-logs'] ? '(kept -- see e2e-process-s3.js stderr for temp dir path)' : null,
		rawEvidenceFile: rel(rawFile),
		failure: summary.failure ? summary.failure.slice(0, 200) : null,
	});
}

if (isMain(import.meta.url)) { main(); }
