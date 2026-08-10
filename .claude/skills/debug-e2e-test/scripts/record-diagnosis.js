#!/usr/bin/env node
// record-diagnosis.js -- render the "E2E Triage Diagnosis" block from the
// checkpoint and append it to the PR (or issue) that resolves the triage.
//
// This is the step that must not be skipped when a triage produces a PR: it is
// the only writer of `diagnosisBlockRecorded`, which the checkpoint's done-gate
// requires. Opening a PR via positron-pr-helper does NOT record the block --
// run this afterward, then `checkpoint.js --set phase=done`.
//
// Pulls the test title, dashboard URL, and pattern frequency from the on-disk
// history-summary.json, and the confidence/failure/signal/hypothesis fields
// from the checkpoint's `diagnosis` object. Idempotent: if the target body
// already carries a block, it re-affirms the flag without a second append.
//
// Flags: see CLI below, or run with --help.
//
// A single triage can resolve across TWO artifacts -- e.g. a root-cause issue
// (the `outcome`) plus a mitigation PR. Record the primary artifact first (the
// one that matches `outcome`; it sets `outcomeRef`), then record the other with
// `--secondary` so the block lands on both without repointing `outcomeRef`.
//
// Output (stdout): compact JSON { block, target, alreadyPresent, recorded }.
// Exit 0; on gh failure or missing diagnosis prints { error }.

import fs from 'fs';
import path from 'path';
import {
	triageDir, readJson, writeJson, writeText, emit, fail, tryRun, isMain, parseArgs,
	defineCli, handleHelp,
} from './lib.js';
import { OUTCOMES } from './checkpoint.js';

export const CLI = defineCli({
	name: 'record-diagnosis.js',
	summary: 'render the E2E Triage Diagnosis block and append it to the PR or issue',
	usage: [
		'--triage-id <id> --pr <n> [--outcome fix-test|fix-product]',
		'--triage-id <id> --issue <n> [--outcome file-issue]',
		'--triage-id <id> --pr <n> --secondary',
		'--triage-id <id> --pr <n> --dry-run',
	],
	flags: [
		{ name: 'triage-id', value: '<id>', required: true, description: 'work-dir id' },
		{ name: 'pr', value: '<n>', description: 'target PR number (one of --pr/--issue required unless --dry-run)' },
		{ name: 'issue', value: '<n>', description: 'target issue number' },
		{ name: 'repo', value: '<owner/repo>', description: 'default: posit-dev/positron' },
		{ name: 'outcome', value: '<o>', description: 'also set the checkpoint outcome (fix-test | fix-product | file-issue); no-op goes through checkpoint.js' },
		{ name: 'secondary', type: 'boolean', description: 'append to a supplementary artifact without repointing outcome/outcomeRef; cannot be combined with --outcome' },
		{ name: 'dry-run', type: 'boolean', description: 'render and print only; touches neither the artifact nor the checkpoint' },
	],
});

const BLOCK_HEADING = '### E2E Triage Diagnosis';

// Outcomes this script can set: it records a block on an external artifact, so
// no-op (checkpoint-only) is out of scope -- that goes through checkpoint.js.
const ARTIFACT_OUTCOMES = OUTCOMES.filter(o => o !== 'no-op');
const CONFIDENCE_EMOJI = { high: '\u{1F7E2}', medium: '\u{1F7E1}', low: '\u{1F534}' };
const CONFIDENCE_LEVELS = Object.keys(CONFIDENCE_EMOJI);
// The summary is the one-line teaser inside <summary>. A multi-paragraph value
// renders as a wall of text in the collapsed header; this bounds it generously
// (a normal teaser is 150-350 chars) so the full mechanism stays in the bullets.
const MAX_SUMMARY_LEN = 600;

/**
 * Validate the checkpoint fields that drive the rendered <summary> header.
 * `renderBlock` is a forgiving renderer -- an unknown `confidence` silently
 * falls back to a medium emoji plus a title-cased dump of the raw string, and
 * an overlong `summary` lands whole inside the header. That produces a
 * janky-but-valid block that sails onto a real PR. Fail loudly here, before the
 * block is written, so the author fixes the diagnosis instead. Returns a
 * human-readable error string, or null when the fields are clean.
 */
export function validateDiagnosis(d) {
	const conf = String(d.confidence ?? '').toLowerCase();
	if (!CONFIDENCE_LEVELS.includes(conf)) {
		return `diagnosis.confidence must be one of ${CONFIDENCE_LEVELS.join(' | ')} ` +
			`(got ${JSON.stringify(d.confidence)}); it maps to the emoji + label in the block header.`;
	}
	const summary = String(d.summary ?? '').trim();
	if (!summary) {
		return 'diagnosis.summary is required -- it is the one-line teaser in the <summary> header.';
	}
	if (/[\r\n]/.test(summary)) {
		return 'diagnosis.summary must be a single line (no line breaks); ' +
			'put the full mechanism in the Signal / Hypothesis bullets.';
	}
	if (summary.length > MAX_SUMMARY_LEN) {
		return `diagnosis.summary is ${summary.length} chars; keep it under ${MAX_SUMMARY_LEN} ` +
			'as a one-line teaser and put the full mechanism in the Signal / Hypothesis bullets.';
	}
	return null;
}

/** Human frequency string from the selected history pattern, one clause per
 *  branch scoped to the environments the pattern actually occurred in, e.g.
 *  "4/4 runs (100%) on feature/x; 3/157 runs (1.9%) on main, ubuntu/chromium".
 *  Returns null when unavailable. Never blends counts/runs across branches or
 *  environments -- that silently understates a pattern concentrated in one
 *  environment on one branch (see triage-history.js scopedRunsForEnvironments). */
export function deriveFrequency(history, selectedPattern) {
	if (!history || !Array.isArray(history.patterns)) { return null; }
	// When a pattern is selected, its stats or nothing -- never silently fall back
	// to the dominant pattern, which would render wrong numbers in the block.
	// The [0] default is only for the no-selection case.
	const p = selectedPattern
		? history.patterns.find(x => x.id === selectedPattern)
		: history.patterns[0];
	if (!p) { return null; }
	const envs = Array.isArray(p.environments) && p.environments.length ? `, ${p.environments.join(', ')}` : '';
	if (!Array.isArray(p.rates) || !p.rates.length) {
		return `${p.count} runs${envs}`;
	}
	const clauses = p.rates.map(r => {
		const runs = r.environmentRuns ? `${r.count}/${r.environmentRuns} runs` : `${r.count} runs`;
		const pct = typeof r.ratePercent === 'number' ? ` (${r.ratePercent}%)` : '';
		return `${runs}${pct} on ${r.branch}`;
	});
	return `${clauses.join('; ')}${envs}`;
}

/**
 * Render the immutable diagnosis block. `d` is the checkpoint `diagnosis`
 * object; `meta` carries testName/testDetailViewUrl/frequency resolved from
 * history. Field labels match find-prior-triage.js's extractor.
 */
export function renderBlock(d, meta) {
	const conf = String(d.confidence || 'medium').toLowerCase();
	const emoji = CONFIDENCE_EMOJI[conf] || CONFIDENCE_EMOJI.medium;
	const confWord = conf.charAt(0).toUpperCase() + conf.slice(1);
	const summary = d.summary || d.hypothesis || 'root-cause hypothesis';
	const testLine = meta.testDetailViewUrl
		? `[${meta.testName}](${meta.testDetailViewUrl})`
		: meta.testName;
	const frequency = d.frequency || meta.frequency || 'see dashboard';

	const lines = [
		BLOCK_HEADING,
		'',
		'<details>',
		`<summary>${emoji} <b>${confWord} confidence</b> -- ${summary}</summary>`,
		'',
		`- **Test:** ${testLine}`,
		`- **Targeted failure:** ${d.targetedFailure || 'n/a'}`,
		`- **Signal:** ${d.signal || 'n/a'}`,
		`- **Frequency:** ${frequency}`,
		`- **Hypothesis:** ${d.hypothesis || summary}`,
	];
	if (d.supersedes) {
		lines.push(`- **Supersedes:** ${d.supersedes}`);
	}
	lines.push('', '</details>');
	return lines.join('\n');
}

function ghBody(repo, kind, num) {
	const p = kind === 'issue' ? 'issues' : 'pulls';
	const r = tryRun('gh', ['api', `repos/${repo}/${p}/${num}`, '--jq', '.body']);
	return r;
}

function ghPatchBody(repo, kind, num, bodyFile) {
	const p = kind === 'issue' ? 'issues' : 'pulls';
	return tryRun('gh', ['api', `repos/${repo}/${p}/${num}`, '-X', 'PATCH', '-F', `body=@${bodyFile}`, '--jq', '.html_url']);
}

function main() {
	handleHelp(CLI, process.argv.slice(2));
	const args = parseArgs(process.argv.slice(2), CLI.booleanFlags);
	const triageId = args['triage-id'];
	if (!triageId) { fail('Missing --triage-id.'); }
	if (args.outcome && !ARTIFACT_OUTCOMES.includes(args.outcome)) {
		fail(`--outcome must be one of ${ARTIFACT_OUTCOMES.join(' | ')} (use checkpoint.js for no-op).`);
	}
	if (args.secondary && args.outcome) {
		fail('--secondary records a supplementary artifact and must not set --outcome (the primary owns the outcome).');
	}

	const dir = triageDir(triageId);
	const sp = path.join(dir, 'state.json');
	if (!fs.existsSync(sp)) { fail(`No checkpoint for triage "${triageId}".`); }
	const state = readJson(sp);
	if (!state.diagnosis || typeof state.diagnosis !== 'object') {
		fail('Checkpoint has no diagnosis object. Save one (checkpoint.js --patch) before recording.');
	}
	// Guard the header fields before rendering, so a malformed diagnosis is
	// caught at --dry-run / record time rather than shipping a janky block.
	const problem = validateDiagnosis(state.diagnosis);
	if (problem) { fail(problem); }

	const historyFile = path.join(dir, 'history-summary.json');
	const history = fs.existsSync(historyFile) ? readJson(historyFile) : null;
	const meta = {
		testName: history?.testName || String(state.testKey || '').split('|||')[0] || 'unknown test',
		testDetailViewUrl: history?.testDetailViewUrl || null,
		frequency: deriveFrequency(history, state.selectedPattern),
	};

	const block = renderBlock(state.diagnosis, meta);
	writeText(path.join(dir, 'diagnosis-block.md'), block + '\n');

	if (args['dry-run']) {
		emit({ block, target: null, alreadyPresent: false, recorded: false, dryRun: true });
		return;
	}

	const repo = args.repo || 'posit-dev/positron';
	const kind = args.issue ? 'issue' : 'pr';
	const num = args.issue || args.pr;
	if (!num) { fail('Provide --pr <n> or --issue <n> (or --dry-run).'); }

	const cur = ghBody(repo, kind, num);
	if (!cur.ok) { fail(`Could not read ${kind} #${num} body via gh.`, { stderr: cur.stderr.trim() }); }
	const currentBody = cur.stdout.replace(/\n$/, '');
	const alreadyPresent = currentBody.includes(BLOCK_HEADING);

	let htmlUrl = null;
	if (!alreadyPresent) {
		const newBody = `${currentBody}\n\n${block}\n`;
		const bodyFile = path.join(dir, 'artifact-body.md');
		fs.writeFileSync(bodyFile, newBody);
		const patched = ghPatchBody(repo, kind, num, bodyFile);
		if (!patched.ok) { fail(`Failed to PATCH ${kind} #${num} body.`, { stderr: patched.stderr.trim() }); }
		htmlUrl = patched.stdout.trim();
	}

	// Update the checkpoint: this is the only writer of diagnosisBlockRecorded.
	// A --secondary artifact still gets the block, but must not repoint the
	// outcome or its ref -- those belong to the primary artifact recorded
	// without --secondary. Fall back to setting outcomeRef only if none exists
	// yet, so a lone/first call always leaves the done-gate a ref to check.
	state.diagnosisBlockRecorded = true;
	const thisRef = htmlUrl || `${repo}#${num}`;
	if (!args.secondary || !state.outcomeRef) { state.outcomeRef = thisRef; }
	if (args.outcome && !args.secondary) { state.outcome = args.outcome; }
	state.updatedAt = new Date().toISOString();
	writeJson(sp, state);

	emit({
		block,
		target: { repo, kind, num, url: state.outcomeRef },
		alreadyPresent,
		recorded: true,
		outcome: state.outcome,
	});
}

if (isMain(import.meta.url)) { main(); }
