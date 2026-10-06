/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSession, writeGuard } from './session.mjs';

const assistant = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const result = { type: 'result', total_cost_usd: 1.5, num_turns: 3, duration_ms: 10, usage: {}, modelUsage: { 'claude-opus-5-5': { costUSD: 1.5 } } };
const quiet = () => {};

test('collects text and the cost record, and passes the options through', async () => {
	let seen;
	const query = async function* ({ prompt, options }) { seen = { prompt, options }; yield assistant('one'); yield assistant('two'); yield result; };
	const s = await runSession({ prompt: 'p', systemPrompt: 's', allowedTools: ['Bash'], model: 'opus', maxTurns: 9, cwd: '/r', query, log: quiet });
	assert.deepEqual(s.texts, ['one', 'two']);
	assert.equal(s.finalText, 'two');
	assert.equal(s.cost.total_cost_usd, 1.5);
	assert.equal(s.cost.model, 'claude-opus-5-5');
	assert.equal(s.timedOut, false);
	assert.deepEqual(seen.options.allowedTools, ['Bash']);
	assert.equal(seen.options.maxTurns, 9);
	assert.equal(seen.options.systemPrompt, 's');
	assert.equal(seen.options.hooks, undefined);
	assert.equal(seen.options.canUseTool, undefined);
});

test('a time limit installs the hook and aborts after the wrap-up', async () => {
	let opts;
	const query = async function* ({ options }) {
		opts = options;
		yield assistant('started');
		await new Promise((_, reject) => options.abortController.signal.addEventListener('abort', () => reject(new Error('aborted'))));
	};
	const s = await runSession({ prompt: 'p', allowedTools: [], model: 'opus', maxTurns: 9, cwd: '/r', timeLimit: 1, minuteMs: 1, query, log: quiet });
	assert.ok(opts.hooks.PostToolUse);
	assert.equal(s.timedOut, true);
	assert.deepEqual(s.texts, ['started']);
});

test('an error that is not the time limit is thrown', async () => {
	const query = async function* () { yield assistant('x'); throw new Error('boom'); };
	await assert.rejects(runSession({ prompt: 'p', allowedTools: [], model: 'opus', maxTurns: 9, cwd: '/r', query, log: quiet }), /boom/);
});

test('writeGuard allows file edits inside the root and denies every other ask', async () => {
	const guard = writeGuard('/r/.claude/skills/dp');
	assert.equal((await guard('Edit', { file_path: '/r/.claude/skills/dp/a.ts' })).behavior, 'allow');
	assert.equal((await guard('Write', { file_path: '/r/.claude/skills/dp/sub/b.ts' })).behavior, 'allow');
	assert.equal((await guard('Edit', { file_path: '/r/.claude/skills/dp/../other/a.ts' })).behavior, 'deny');
	assert.equal((await guard('Edit', { file_path: '/r/.claude/skills/dp-other/a.ts' })).behavior, 'deny');
	assert.equal((await guard('Edit', { file_path: '/r/.claude/settings.json' })).behavior, 'deny');
	assert.equal((await guard('Bash', { command: 'rm -rf /r/.claude/skills/dp' })).behavior, 'deny');
});

test('a write root installs the guard', async () => {
	let seen;
	const query = async function* ({ options }) { seen = options; yield result; };
	await runSession({ prompt: 'p', allowedTools: ['Edit'], model: 'opus', maxTurns: 9, cwd: '/r', writeRoot: '/r/x', query, log: quiet });
	assert.equal(typeof seen.canUseTool, 'function');
});
