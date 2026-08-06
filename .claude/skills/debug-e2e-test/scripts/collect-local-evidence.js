#!/usr/bin/env node
// collect-local-evidence.js -- the LOCAL entry's evidence step, producing the
// same summary.md shape fetch-pattern-evidence.js produces for a CI occurrence.
//
// Local runs write no machine-readable report: playwright.config.ts sets
// `reporter = [['list']]` off CI (and drops the html reporter entirely when
// CLAUDE_CODE is set), so there is no report.json to read. The artifacts that DO
// survive a local run are per-test directories under test-results/ --
// `_trace.zip` (written unconditionally off CI by reporting.fixtures.ts, for
// passing tests too), Playwright's `error-context.md` on failure, and
// screenshots -- plus app logs under test-logs/<artifactDir>/<spec>.
//
// So this script walks test-results/ itself, picks one run, unzips its trace,
// and reuses e2e-failure-analyzer's e2e-parse-trace.js for the timeline and
// errors. Everything downstream of the summary (the rubric, the escalation
// ladder, the RED bar) is shared with the CI entry unchanged.
//
// Runs on Windows: unlike the CI-entry scripts it needs no `unzip` binary, and
// no `gh`, no API key, no network.
//
// Usage:
//   node collect-local-evidence.js [--results-dir test-results] [--logs-dir test-logs]
//     [--test '<substring>'] [--dir <exact result dir name>] [--triage-id <id>] [--list]
//
// Output (stdout): compact JSON { verdict, resultsDir, candidates[], selected,
//   evidenceDir, summaryFile, timelineFile, snapshotFile, screenshots[],
//   logDir, failure, nextStep }.
//
// Verdicts:
//   ok           -- one run selected, evidence written
//   no-results   -- no artifacts at all; the test has not run locally yet
//   no-failure   -- artifacts exist but none of them failed (traces are kept
//                   for passing runs locally, so this is a real, distinct state)
//   ambiguous    -- --test / --dir matched more than one run; ask which

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
	repoRoot, analyzerScript, triageDir, workRoot, ensureDir, writeText,
	emit, fail, runNode, isMain, parseArgs,
} from './lib.js';

const TRACE_NAME = '_trace.zip';
const ERROR_CONTEXT_NAME = 'error-context.md';

/**
 * Read one test-results subdirectory into a candidate descriptor.
 *
 * `failed` is the interesting field, and it cannot be read from a report,
 * because there isn't one locally. Playwright writes error-context.md only for
 * a failed test, so its presence is the positive signal; a trace alone proves
 * nothing (local runs keep traces for passes). When the snapshot is absent we
 * still return the candidate with `failed: false` so the caller can distinguish
 * "no failure" from "nothing ran" -- two states that want opposite advice.
 */
export function describeCandidate(dirName, entries, mtimeMs) {
	// Entries are paths relative to the result dir, because Playwright puts
	// body-attachments (the on-failure screenshot, the logs zip) in an
	// `attachments/` subdirectory while writing path-attachments at the top level.
	// Matching on the basename covers both without caring which is which.
	const has = name => entries.some(e => path.basename(e) === name);
	const screenshots = entries.filter(e => e.endsWith('.png')).sort();
	return {
		dir: dirName,
		mtimeMs,
		hasTrace: has(TRACE_NAME),
		failed: has(ERROR_CONTEXT_NAME),
		screenshots,
		// Playwright appends `-retry1`, `-retry2` to the output dir of a retried
		// attempt. Retries are off locally (`retries: process.env.CI ? 1 : 0`), so
		// a retry dir here means the engineer passed --retries deliberately.
		retry: Number(/-retry(\d+)$/.exec(dirName)?.[1] ?? 0),
	};
}

/** Newest first, failed runs ahead of passing ones at equal recency. */
export function rankCandidates(candidates) {
	return [...candidates].sort((a, b) => (b.failed - a.failed) || (b.mtimeMs - a.mtimeMs));
}

/**
 * Choose the run to investigate, or say why we can't.
 *
 * A filter that matches several runs is NOT resolved by taking the newest: the
 * whole point of the local entry is that the engineer is standing in front of
 * the failure, so asking is cheap and guessing wrong wastes the dig. An
 * unfiltered call does default to the best-ranked run -- that is the low-friction
 * common case (one test just failed).
 */
export function selectCandidate(candidates, { test: filter = null, dir = null } = {}) {
	if (!candidates.length) { return { verdict: 'no-results', selected: null, matches: [] }; }
	let matches = candidates;
	if (dir) { matches = candidates.filter(c => c.dir === dir); }
	else if (filter) {
		matches = candidates.filter(c => matchesTestFilter(c.dir, filter));
	}
	if (!matches.length) { return { verdict: 'no-results', selected: null, matches: [] }; }
	const ranked = rankCandidates(matches);
	if ((dir || filter) && matches.length > 1 && !ranked[0].failed) {
		return { verdict: 'ambiguous', selected: null, matches: ranked };
	}
	const selected = ranked[0];
	if (!selected.failed) { return { verdict: 'no-failure', selected, matches: ranked }; }
	return { verdict: 'ok', selected, matches: ranked };
}

/**
 * Split e2e-parse-trace.js's human-readable output into the pieces the summary
 * needs. Its sections are delimited by `=== <name> ... ===` headers.
 */
export function parseTraceReport(stdout) {
	const lines = String(stdout || '').split('\n');
	const sections = new Map();
	let current = null;
	for (const line of lines) {
		const header = /^===\s*(.+?)\s*===$/.exec(line.trim());
		if (header) {
			current = header[1].replace(/\s*\(.*\)\s*$/, '').replace(/\s*\(last.*$/, '').trim();
			sections.set(current, []);
			continue;
		}
		if (current) { sections.get(current).push(line); }
	}
	const pick = name => (sections.get(name) || []).filter(Boolean);
	const timeline = pick('Action Timeline');
	const errors = pick('Errors').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
	return { timeline, errors, sections: [...sections.keys()] };
}

/**
 * Build the local summary. Deliberately the same headings as
 * fetch-pattern-evidence.js's buildEvidenceSummary, so the reasoning steps that
 * read it don't have to care which entry produced it -- with the two sections
 * local evidence genuinely cannot fill called out rather than faked.
 */
export function buildLocalSummary({ selected, timeline, errors, snapshotFile, logDir, siblings = [] }) {
	// The LAST error, matching the CI summary. Earlier entries in a trace are
	// routinely non-fatal -- an expect.toPass() or waitFor retry logs its failed
	// attempts too, which is why even a passing run's trace carries errors.
	const failure = errors[errors.length - 1] || null;
	const tail = timeline.slice(-14);
	const md = [
		'# Evidence summary (local run)',
		'',
		`Source: \`${selected.dir}\`${selected.failed ? '' : ' -- **this run PASSED**'}`,
		'',
		'## Failure',
		'',
		// A passing run's trace still carries errors (a retried expect logs its
		// failed attempts), so labelling the last one "the failure" would invent one.
		!selected.failed
			? `(this run passed; its trace's last logged error, non-fatal, was: ${failure ? failure.slice(0, 200) : 'none'})`
			: failure ? '```\n' + failure.slice(0, 500) + '\n```' : '(no error captured in trace)',
		'',
		'## Timeline tail (last actions before failure)',
		'',
		'```',
		...tail,
		'```',
		'',
		'## Sibling tests in the same file',
		'',
		siblings.length ? siblings.map(s => `- ${s}`).join('\n') : '(local runs write no report, so sibling outcomes are unknown -- rerun the whole spec to see them)',
		'',
		'## Error-shaped log lines',
		'',
		logDir
			? `App logs for this spec: \`${logDir}\`. Not mined -- grep them for the diagnosed mechanism.`
			: '(no matching app log directory found under the logs dir)',
		'',
		'## Unresolved questions',
		'',
		'- Does the timeline tail explain the failure, or is the mechanism ordering/timing a timeline cannot show?',
		snapshotFile
			? '- Is the error-context snapshot consistent with the assertion, or does it point at an unexpected surface?'
			: '- No error-context snapshot was written; is a DOM-shape question answerable another way?',
		'- No CI history was queried, so the failure *rate* and environment spread are unknown here. Ask for the CI history read if that matters.',
		'',
		'_Open the full timeline / snapshot / logs only to answer one of the above._',
		'',
	].join('\n');
	return { markdown: md, failure };
}

const sanitize = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Match a `--test` filter against a Playwright result directory name. Playwright
 * slugifies the title into the directory and elides the middle of a long one,
 * keeping the tail -- so a raw substring test misses on both counts: spaces are
 * hyphens, and a full title never appears verbatim. Slugify the needle, then fall
 * back to progressively shorter suffixes of it, so a full title and a distinctive
 * fragment both resolve. The length floor applies only to the shortened suffixes;
 * a short filter the engineer typed deliberately still matches on its own.
 */
export function matchesTestFilter(dir, filter, minSuffixLength = 8) {
	const haystack = sanitize(dir);
	const tokens = sanitize(filter).split('-').filter(Boolean);
	for (let i = 0; i < tokens.length; i++) {
		const needle = tokens.slice(i).join('-');
		if (i > 0 && needle.length < minSuffixLength) { break; }
		if (haystack.includes(needle)) { return true; }
	}
	return false;
}

function commonPrefixLength(a, b) {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) { i++; }
	return i;
}

/**
 * Find the app-log directory for a run.
 *
 * Logs land at `<logs-root>/<project>/<spec title path>`, e.g.
 * `test-logs/e2e-workbench/tests/connect/pins-data-connection.test.ts`, while
 * Playwright's results dir name is the same spec path plus the test title,
 * *truncated with a hash* in the middle
 * (`tests-connect-pins-data-co-baff7-browse-its-pins-...-e2e-workbench`). So a
 * substring match fails on exactly the dirs that should pair. Score on the
 * longest common prefix of the spec portion instead, and require the project
 * segment to appear in the results dir name so two projects' logs can't swap.
 */
export function matchLogDir(resultDirName, logDirs, minPrefix = 12) {
	const haystack = sanitize(resultDirName);
	const scored = logDirs
		.map(dir => {
			// Split on either separator: these paths come from path.join (backslashes
			// on Windows), but the same function is fed forward-slash paths by tests
			// and by anything that passes a repo-relative path through.
			const [project, ...rest] = String(dir).split(/[\\/]/);
			if (!rest.length || !haystack.includes(sanitize(project))) { return null; }
			return { dir, score: commonPrefixLength(sanitize(rest.join('-')), haystack) };
		})
		.filter(m => m && m.score >= minPrefix)
		.sort((a, b) => b.score - a.score);
	return scored.length ? scored[0].dir : null;
}

function listResultDirs(resultsDir) {
	if (!fs.existsSync(resultsDir)) { return []; }
	const out = [];
	for (const entry of fs.readdirSync(resultsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) { continue; }
		const full = path.join(resultsDir, entry.name);
		let entries = [];
		try { entries = fs.readdirSync(full, { recursive: true }).map(String); } catch { continue; }
		out.push(describeCandidate(entry.name, entries, fs.statSync(full).mtimeMs));
	}
	return out;
}

/**
 * Every directory under the logs root, as paths relative to it. The depth has to
 * cover a nested spec path -- logs land at <project>/<testInfo.titlePath[0]>,
 * e.g. e2e-workbench/tests/connect/pins-data-connection.test.ts.
 */
function listLogDirs(logsDir, depth = 6) {
	if (!fs.existsSync(logsDir)) { return []; }
	const out = [];
	const walk = (dir, rel, level) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) { continue; }
			const nextRel = rel ? path.join(rel, entry.name) : entry.name;
			out.push(nextRel);
			if (level < depth) { walk(path.join(dir, entry.name), nextRel, level + 1); }
		}
	};
	walk(logsDir, '', 1);
	return out;
}

/**
 * Extract just the trace event stream out of a _trace.zip.
 *
 * Uses yauzl (a direct Positron dependency) rather than shelling out to `unzip`
 * the way the CI-entry scripts do: Windows has no `unzip` on PATH, and this
 * entry is the one an engineer runs on whatever machine the test just failed on.
 */
async function extractTrace(zipPath, destDir) {
	ensureDir(destDir);
	const destPath = path.join(destDir, 'trace.trace');
	const { open } = await import('yauzl');
	await new Promise((resolve, reject) => {
		open(zipPath, { lazyEntries: true }, (err, zip) => {
			if (err) { return reject(err); }
			let found = false;
			zip.on('entry', entry => {
				if (entry.fileName !== 'trace.trace') { return zip.readEntry(); }
				found = true;
				zip.openReadStream(entry, (streamErr, stream) => {
					if (streamErr) { return reject(streamErr); }
					const out = fs.createWriteStream(destPath);
					stream.pipe(out);
					out.on('finish', () => { zip.close(); resolve(); });
					out.on('error', reject);
				});
			});
			zip.on('end', () => { if (!found) { reject(new Error('no trace.trace entry in the archive')); } });
			zip.on('error', reject);
			zip.readEntry();
		});
	});
	return destPath;
}

async function main() {
	const args = parseArgs(process.argv.slice(2), ['list']);
	const resultsDir = path.resolve(repoRoot(), args['results-dir'] || 'test-results');
	const logsDir = path.resolve(repoRoot(), args['logs-dir'] || 'test-logs');
	const rel = p => (p ? path.relative(process.cwd(), p) : null);

	const candidates = rankCandidates(listResultDirs(resultsDir));
	const compact = candidates.map(c => ({ dir: c.dir, failed: c.failed, hasTrace: c.hasTrace, retry: c.retry }));

	if (args.list) {
		emit({ verdict: candidates.length ? 'ok' : 'no-results', resultsDir: rel(resultsDir), candidates: compact });
		return;
	}

	const { verdict, selected, matches } = selectCandidate(candidates, { test: args.test, dir: args.dir });

	if (verdict === 'no-results' || verdict === 'ambiguous' || (verdict === 'no-failure' && !selected.hasTrace)) {
		emit({
			verdict,
			resultsDir: rel(resultsDir),
			candidates: verdict === 'ambiguous' ? matches.map(c => ({ dir: c.dir, failed: c.failed })) : compact,
			selected: null,
			nextStep: {
				'no-results': 'No local run artifacts. Run the test, then re-run this script: npx playwright test <spec> --project e2e-electron --grep \'<test name>\'',
				'no-failure': 'Artifacts exist but nothing failed. Re-run the test (add --repeat-each=N for a flake), then re-run this script.',
				'ambiguous': 'Several runs match. Ask which, then pass --dir <exact dir>.',
			}[verdict],
		});
		return;
	}

	// A passing run still has a trace worth reading -- locally it is the only way
	// to see a green ordering next to the failing one -- so continue, flagging it.
	const evidenceDir = ensureDir(args['triage-id']
		? path.join(triageDir(args['triage-id']), 'evidence', 'local')
		: path.join(workRoot(), 'local', selected.dir));

	const selectedPath = path.join(resultsDir, selected.dir);
	const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-local-trace-'));
	let report;
	try {
		const tracePath = await extractTrace(path.join(selectedPath, TRACE_NAME), traceDir);
		report = parseTraceReport(runNode(analyzerScript('e2e-parse-trace.js'), [tracePath, '--last', '120']));
	} catch (err) {
		fail(`Could not read the trace in ${path.relative(repoRoot(), selectedPath)}: ${err.message}`, { selected: selected.dir });
	} finally {
		fs.rmSync(traceDir, { recursive: true, force: true });
	}

	const snapshotFile = fs.existsSync(path.join(selectedPath, ERROR_CONTEXT_NAME))
		? path.join(selectedPath, ERROR_CONTEXT_NAME)
		: null;
	const logMatch = matchLogDir(selected.dir, listLogDirs(logsDir));
	const logDir = logMatch ? path.join(logsDir, logMatch) : null;

	const summary = buildLocalSummary({
		selected,
		timeline: report.timeline,
		errors: report.errors,
		snapshotFile: rel(snapshotFile),
		logDir: rel(logDir),
	});
	const summaryFile = writeText(path.join(evidenceDir, 'summary.md'), summary.markdown);
	const timelineFile = report.timeline.length
		? writeText(path.join(evidenceDir, 'timeline.txt'), report.timeline.join('\n') + '\n')
		: null;

	emit({
		verdict,
		resultsDir: rel(resultsDir),
		candidates: compact,
		selected: { dir: selected.dir, failed: selected.failed, retry: selected.retry },
		evidenceDir: rel(evidenceDir),
		summaryFile: rel(summaryFile),
		timelineFile: rel(timelineFile),
		snapshotFile: rel(snapshotFile),
		screenshots: selected.screenshots.map(s => rel(path.join(selectedPath, s))),
		logDir: rel(logDir),
		failure: summary.failure ? summary.failure.slice(0, 200) : null,
		nextStep: verdict === 'no-failure'
			? 'This run PASSED -- its trace is here for comparison only. Nothing to diagnose from it alone.'
			: 'Read summaryFile only; escalate behind an evidence block.',
	});
}

if (isMain(import.meta.url)) { main().catch(err => fail(err.message)); }
