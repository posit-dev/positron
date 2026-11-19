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

test('returns the session id, and resumes a session it is given', async () => {
	let seen;
	const query = async function* ({ options }) { seen = options; yield { type: 'system', session_id: 's1' }; yield assistant('again'); yield result; };
	const s = await runSession({ prompt: 'p', allowedTools: [], model: 'sonnet', maxTurns: 9, cwd: '/r', resume: 's0', query, log: quiet });
	assert.equal(seen.resume, 's0');
	assert.equal(s.sessionId, 's1');
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

test('the turn cap returns what the agent did, not the error the SDK throws after its result', async () => {
	const query = async function* () {
		yield { type: 'system', session_id: 's1' };
		yield assistant('x');
		yield { ...result, subtype: 'error_max_turns', num_turns: 10 };
		throw new Error('Claude Code returned an error result: Reached maximum number of turns (9)');
	};
	const s = await runSession({ prompt: 'p', allowedTools: [], model: 'opus', maxTurns: 9, cwd: '/r', query, log: quiet });
	assert.equal(s.turnCapHit, true);
	assert.equal(s.cost.num_turns, 10);
	assert.equal(s.sessionId, 's1');
	assert.deepEqual(s.texts, ['x']);
});

test('a turn warning tells every tool result to wrap up once the agent reaches its turn, counting a turn per message id', async () => {
	const said = [];
	const turn = id => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', name: 'Bash', input: {} }] } });
	const query = async function* ({ options }) {
		const hook = input => options.hooks[input.hook_event_name][0].hooks[0](input);
		// The SDK splits one turn's blocks across messages that share its id.
		yield turn('m1'); yield turn('m1');
		said.push(await hook({ hook_event_name: 'PostToolUse' }));
		yield turn('m2');
		said.push(await hook({ hook_event_name: 'PostToolUse' }));
		yield turn('m3');
		said.push(await hook({ hook_event_name: 'PostToolUseFailure' }));
		yield result;
	};
	const s = await runSession({ prompt: 'p', allowedTools: [], model: 'opus', maxTurns: 9, cwd: '/r', turnWarning: { at: 2, message: turns => `Wrap up; ${9 - turns} left.` }, query, log: quiet });
	assert.deepEqual(said[0], {});
	assert.deepEqual(said[1], { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Wrap up; 7 left.' } });
	// The count goes down with each turn rather than repeating the first one.
	assert.equal(said[2].hookSpecificOutput.additionalContext, 'Wrap up; 6 left.');
	assert.equal(said[2].hookSpecificOutput.hookEventName, 'PostToolUseFailure');
	assert.equal(s.turnWarned, true);
});

test('a turn warning and a time limit both reach the agent', async () => {
	let opts;
	const query = async function* ({ options }) { opts = options; yield result; };
	await runSession({ prompt: 'p', allowedTools: [], model: 'opus', maxTurns: 9, cwd: '/r', timeLimit: 60, turnWarning: { at: 2, message: 'Wrap up.' }, query, log: quiet });
	assert.equal(opts.hooks.PostToolUse.length, 2);
	assert.equal(opts.hooks.PostToolUseFailure.length, 2);
});

test('after the turn cap, an error that is not the cap\'s own is still thrown', async () => {
	const query = async function* () {
		yield { ...result, subtype: 'error_max_turns' };
		throw new Error('the CLI crashed');
	};
	await assert.rejects(runSession({ prompt: 'p', allowedTools: [], model: 'opus', maxTurns: 9, cwd: '/r', query, log: quiet }), /crashed/);
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

test('runSession clips logged tool calls to 200 characters, or logs them in full for a short pass', async () => {
	const command = 'x'.repeat(500);
	const query = async function* () {
		yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } };
		yield { type: 'result' };
	};
	const logged = async fullLog => {
		const lines = [];
		await runSession({ prompt: 'p', allowedTools: [], model: 'sonnet', maxTurns: 2, cwd: '/r', query, fullLog, log: line => lines.push(line) });
		return lines.find(l => l.includes('tool calls'));
	};
	assert.equal((await logged(false)).length, '[msg 1] tool calls: Bash()'.length + 200);
	assert.ok((await logged(true)).includes(command));
});
