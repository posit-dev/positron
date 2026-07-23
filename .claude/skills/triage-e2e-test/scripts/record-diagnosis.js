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
// Usage:
//   node record-diagnosis.js --triage-id <id> --pr <n> [--outcome fix-test|fix-product]
//   node record-diagnosis.js --triage-id <id> --issue <n> [--outcome file-issue]
//   node record-diagnosis.js --triage-id <id> --pr <n> --dry-run   # render only, no write
//
// Options:
//   --triage-id <id>   work-dir id  [required]
//   --pr <n>           target PR number   (one of --pr/--issue required unless --dry-run)
//   --issue <n>        target issue number
//   --repo <owner/repo>  default: posit-dev/positron
//   --outcome <o>      also set checkpoint outcome (fix-test | fix-product | file-issue)
//   --dry-run          print the rendered block; do not edit the artifact or checkpoint
//
// Output (stdout): compact JSON { block, target, alreadyPresent, recorded }.
// Exit 0; on gh failure or missing diagnosis prints { error }.

import fs from 'fs';
import path from 'path';
import {
	triageDir, readJson, writeJson, writeText, emit, fail, tryRun, isMain, parseArgs,
} from './lib.js';
import { OUTCOMES } from './checkpoint.js';

const BLOCK_HEADING = '### E2E Triage Diagnosis';

// Outcomes this script can set: it records a block on an external artifact, so
// no-op (checkpoint-only) is out of scope -- that goes through checkpoint.js.
const ARTIFACT_OUTCOMES = OUTCOMES.filter(o => o !== 'no-op');
const CONFIDENCE_EMOJI = { high: '\u{1F7E2}', medium: '\u{1F7E1}', low: '\u{1F534}' };

/** Human frequency string from the selected history pattern, e.g.
 *  "31/317 runs (9.8%), ubuntu/chromium". Returns null when unavailable. */
export function deriveFrequency(history, selectedPattern) {
	if (!history || !Array.isArray(history.patterns)) { return null; }
	// When a pattern is selected, its stats or nothing -- never silently fall back
	// to the dominant pattern, which would render wrong numbers in the block.
	// The [0] default is only for the no-selection case.
	const p = selectedPattern
		? history.patterns.find(x => x.id === selectedPattern)
		: history.patterns[0];
	if (!p) { return null; }
	const denom = history.branchSummary?.mainRuns || history.branchSummary?.currentBranchRuns;
	const runs = denom ? `${p.count}/${denom} runs` : `${p.count} runs`;
	const pct = typeof p.percentage === 'number' ? ` (${p.percentage}%)` : '';
	const envs = Array.isArray(p.environments) && p.environments.length ? `, ${p.environments.join(', ')}` : '';
	return `${runs}${pct}${envs}`;
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
	const args = parseArgs(process.argv.slice(2), ['dry-run']);
	const triageId = args['triage-id'];
	if (!triageId) { fail('Missing --triage-id.'); }
	if (args.outcome && !ARTIFACT_OUTCOMES.includes(args.outcome)) {
		fail(`--outcome must be one of ${ARTIFACT_OUTCOMES.join(' | ')} (use checkpoint.js for no-op).`);
	}

	const dir = triageDir(triageId);
	const sp = path.join(dir, 'state.json');
	if (!fs.existsSync(sp)) { fail(`No checkpoint for triage "${triageId}".`); }
	const state = readJson(sp);
	if (!state.diagnosis || typeof state.diagnosis !== 'object') {
		fail('Checkpoint has no diagnosis object. Save one (checkpoint.js --patch) before recording.');
	}

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
	state.diagnosisBlockRecorded = true;
	state.outcomeRef = htmlUrl || `${repo}#${num}`;
	if (args.outcome) { state.outcome = args.outcome; }
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
