/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Runs in a job of its own, before anything is built. The explore job needs a
// compile, an Xvfb, a launch and a Playwright attach; a change this pass would
// decline should not pay for any of it.

import { appendFileSync, readFileSync } from 'node:fs';
import { describeChange, ENVIRONMENT, gitIn, isProductPath, mustEnv, parsePosIntEnv, parseGate, renderGateSummary, renderPrBody } from './lib.mjs';
import { runSession } from './session.mjs';

const REPO_ROOT = mustEnv('REPO_ROOT');
const BASE_SHA = mustEnv('BASE_SHA');
const HEAD_SHA = mustEnv('HEAD_SHA');
const GATE_MODEL = process.env.GATE_MODEL || 'sonnet';
const GATE_MAX_TURNS = parsePosIntEnv('GATE_MAX_TURNS', 30, process.env.GATE_MAX_TURNS);
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || undefined;
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
const GITHUB_STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const PR_BODY_FILE = process.env.PR_BODY_FILE || '';
mustEnv('ANTHROPIC_API_KEY');

// The `reason` output is only a decline's: report shows it as why the run did
// not happen. The summary says why either way.
function emit(testable, reason, note = '', cost = undefined) {
	console.log(`[gate] testable=${testable}${reason ? ` reason=${reason}` : ''}`);
	if (GITHUB_OUTPUT) {
		appendFileSync(GITHUB_OUTPUT, `testable=${testable}\nreason=${testable === 'false' ? reason : ''}\n`);
	}
	// After the verdict is written, nothing may throw: main's catch would
	// emit again, and a second testable=true would overrule a decline.
	if (GITHUB_STEP_SUMMARY) {
		try {
			appendFileSync(GITHUB_STEP_SUMMARY, renderGateSummary(testable === 'true', reason, note, cost));
		} catch (err) {
			console.error(`[gate] could not write the step summary: ${err}`);
		}
	}
}

/**
 * Decides, before the expensive run, whether this change can be exercised here.
 *
 * Bails only on a blocker it can name: a dependency that is not released, a
 * code path this platform never runs, a diff with nothing user-visible in it.
 * Awkward is not the same as impossible -- a cached probe or a binary on PATH
 * is the job, and a run that talked itself out of that found nothing at all.
 *
 * Fails open. An unparseable answer, a missing line, or a thrown error all mean
 * explore anyway: a gate whose own bugs skip runs is worse than no gate.
 */
async function main() {
	// Free, and not up to the model: a diff with no product file in it has
	// nothing to explore.
	const git = gitIn(REPO_ROOT);
	const { entries, stat, upstream } = describeChange({ git, base: BASE_SHA, head: HEAD_SHA });
	const files = entries.map(e => e.path);
	if (files.length && !files.some(isProductPath)) {
		emit('false', `Only tests, docs or CI files changed (${files.length} files); nothing a user can see.`);
		return;
	}
	// Always worth a run, and none of the blockers below can apply to one.
	if (upstream) {
		console.log(`[gate] upstream merge ${upstream.from} -> ${upstream.to}: ${upstream.seam} of ${upstream.files} files meet Positron`);
		emit('true', '', `An upstream merge (${upstream.from} -> ${upstream.to}) is always worth a run.`);
		return;
	}

	// No PR, or a fetch that failed, gets the prompt it always had.
	let prBody = '';
	try {
		prBody = PR_BODY_FILE ? renderPrBody(readFileSync(PR_BODY_FILE, 'utf8')) : '';
	} catch (err) {
		console.log(`[gate] no PR body: ${err}`);
	}

	const prompt = [
		'Decide whether a change is worth exploratory testing in this environment, and answer in one line.',
		'',
		'These are the files the change touches:',
		'',
		'```',
		stat,
		'```',
		'',
		`Read any of them with \`git -C ${REPO_ROOT} diff ${BASE_SHA}...${HEAD_SHA} -- <path>\`, and the commit messages with \`git -C ${REPO_ROOT} log ${BASE_SHA}..${HEAD_SHA}\`. Do not rule on the change without reading the parts of it you are ruling on.`,
		'',
		...(prBody ? [prBody, ''] : []),
		'Ignore any files under `.github/` and `.claude/`: this harness merges its own CI and skill files into the branch it tests, so they are in every diff and are never the change under test.',
		'',
		ENVIRONMENT,
		'',
		'Answer NOT TESTABLE only when you can name the blocker:',
		'- a dependency the change needs is not released or not pinned here, so the new behavior cannot run. A companion PR the description says this needs counts, unless it says that PR has shipped;',
		'- the changed code path only runs on a platform this container is not;',
		'- the changed behavior is reachable only through something listed as not available above. A change that also touches UI or error handling reachable without it is TESTABLE;',
		'- the diff changes nothing a user can observe (a refactor, a comment, tests or docs only).',
		'',
		'Awkward is not the same as impossible. A tool that has to be removed, a cache that has to be cleared, a window that has to be reloaded, a host that has to be blocked: that is the work, not a reason to decline it. If you are unsure, answer TESTABLE.',
		'',
		'Reply with exactly one line and nothing else:',
		'',
		'GATE: TESTABLE - <what a user could see change>',
		'',
		'or',
		'',
		'GATE: NOT TESTABLE - <the blocker, and the files it applies to>',
		'',
		'A bail-out has to survive someone reading the file list above it, so name what you are declining on. If any file outside `.github/` and `.claude/` changes behavior a user could see, the answer is TESTABLE.',
	].join('\n');

	const { texts, cost } = await runSession({
		prompt, model: GATE_MODEL, cwd: REPO_ROOT, allowedTools: ['Bash', 'Read', 'Glob', 'Grep'], maxTurns: GATE_MAX_TURNS,
		thinking: { type: 'disabled' }, claudeCodePath: CLAUDE_CODE_PATH, label: 'gate',
	});
	const usd = typeof cost.total_cost_usd === 'number' ? cost.total_cost_usd.toFixed(2) : undefined;
	if (GITHUB_OUTPUT && usd) {
		appendFileSync(GITHUB_OUTPUT, `cost=${usd}\nturns=${cost.num_turns}\n`);
	}
	const gate = parseGate(texts.join('\n'));
	// Fails open: an unparseable answer, a missing line or a refusal to commit
	// all mean explore anyway. A gate whose own bugs skip runs is worse than none.
	if (gate && !gate.testable) {
		emit('false', gate.reason, '', usd);
		return;
	}
	emit('true', gate?.reason ?? '', gate ? '' : 'The check gave no clear verdict, so the run goes ahead.', usd);
}

main().catch(err => {
	console.error(`[gate] failed, letting the run proceed: ${err}`);
	emit('true', '', `The check failed (${err}), so the run goes ahead.`);
});

