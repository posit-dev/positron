/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Runs in a job of its own, before anything is built. The explore job needs a
// compile, an Xvfb, a launch and a Playwright attach; a change this pass would
// decline should not pay for any of it.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync } from 'node:fs';
import { buildCostRecord, parsePosIntEnv, parseGate } from './lib.mjs';

const REPO_ROOT = mustEnv('REPO_ROOT');
const BASE_SHA = mustEnv('BASE_SHA');
const HEAD_SHA = mustEnv('HEAD_SHA');
const DIFF_STAT = process.env.DIFF_STAT || '(no diff stat provided)';
const GATE_MODEL = process.env.GATE_MODEL || 'sonnet';
const GATE_MAX_TURNS = parsePosIntEnv('GATE_MAX_TURNS', 30, process.env.GATE_MAX_TURNS);
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || undefined;
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
mustEnv('ANTHROPIC_API_KEY');

function mustEnv(name) {
	const v = process.env[name];
	if (!v) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return v;
}

function emit(testable, reason) {
	console.log(`[gate] testable=${testable}${reason ? ` reason=${reason}` : ''}`);
	if (GITHUB_OUTPUT) {
		appendFileSync(GITHUB_OUTPUT, `testable=${testable}\nreason=${reason || ''}\n`);
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
	const prompt = [
		'Decide whether a change is worth exploratory testing in this environment, and answer in one line.',
		'',
		'These are the files the change touches:',
		'',
		'```',
		DIFF_STAT,
		'```',
		'',
		`Read any of them with \`git -C ${REPO_ROOT} diff ${BASE_SHA}...${HEAD_SHA} -- <path>\`, and the commit messages with \`git -C ${REPO_ROOT} log ${BASE_SHA}..${HEAD_SHA}\`. Do not rule on the change without reading the parts of it you are ruling on.`,
		'',
		'Ignore any files under `.github/` and `.claude/`: this harness merges its own CI and skill files into the branch it tests, so they are in every diff and are never the change under test.',
		'',
		'This runs in a Linux container with a built Positron, Python and R available, and no network restrictions. There is no Windows, no macOS, and no access to external services that are not already reachable.',
		'',
		'Answer NOT TESTABLE only when you can name the blocker:',
		'- a dependency the change needs is not released or not pinned here, so the new behavior cannot run;',
		'- the changed code path only runs on a platform this container is not;',
		'- the diff changes nothing a user can observe (a refactor, a comment, tests or docs only).',
		'',
		'Awkward is not the same as impossible. A tool that has to be removed, a cache that has to be cleared, a window that has to be reloaded, a host that has to be blocked: that is the work, not a reason to decline it. If you are unsure, answer TESTABLE.',
		'',
		'Reply with exactly one line and nothing else:',
		'',
		'GATE: TESTABLE',
		'',
		'or',
		'',
		'GATE: NOT TESTABLE - <the blocker, and the files it applies to>',
		'',
		'A bail-out has to survive someone reading the file list above it, so name what you are declining on. If any file outside `.github/` and `.claude/` changes behavior a user could see, the answer is TESTABLE.',
	].join('\n');

	const chunks = [];
	for await (const message of query({
		prompt,
		options: {
			model: GATE_MODEL,
			cwd: REPO_ROOT,
			allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
			maxTurns: GATE_MAX_TURNS,
			thinking: { type: 'disabled' },
			stderr: data => process.stderr.write(`[gate stderr] ${data}`),
			...(CLAUDE_CODE_PATH ? { pathToClaudeCodeExecutable: CLAUDE_CODE_PATH } : {}),
		},
	})) {
		if (message.type === 'assistant') {
			const text = (message.message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
			if (text) {
				chunks.push(text);
			}
		} else if (message.type === 'result') {
			const cost = buildCostRecord(message);
			console.log(`[gate] result: ${JSON.stringify(cost)}`);
			if (GITHUB_OUTPUT && typeof cost.total_cost_usd === 'number') {
				appendFileSync(GITHUB_OUTPUT, `cost=${cost.total_cost_usd.toFixed(2)}\nturns=${cost.num_turns}\n`);
			}
		}
	}
	const gate = parseGate(chunks.join('\n'));
	// Fails open: an unparseable answer, a missing line or a refusal to commit
	// all mean explore anyway. A gate whose own bugs skip runs is worse than none.
	if (gate && !gate.testable) {
		emit('false', gate.reason);
		return;
	}
	emit('true', '');
}

main().catch(err => {
	console.error(`[gate] failed, letting the run proceed: ${err}`);
	emit('true', '');
});

