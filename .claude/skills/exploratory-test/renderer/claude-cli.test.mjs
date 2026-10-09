/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runClaude } from './claude-cli.mjs';

const result = fields => JSON.stringify({ type: 'result', is_error: false, result: 'reply', duration_ms: 1000, num_turns: 3, total_cost_usd: 0.25, ...fields });

/** A fake `claude` that answers each call with the next of `runs`, recording what it was given. */
function fakeExec(runs) {
	const calls = [];
	const exec = async (args, prompt, options) => {
		calls.push({ args, prompt, options });
		return { status: 0, killed: false, ms: 5000, ...runs[calls.length - 1] };
	};
	return { calls, exec };
}

const flag = (args, name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;

test('a session gets its tools, model and a session id, and returns its reply and usage', async () => {
	const { calls, exec } = fakeExec([{ stdout: result({}) }]);
	const out = await runClaude({ prompt: 'read this', model: 'sonnet', tools: ['Bash', 'Read'], cwd: '/repo', exec });
	const [{ args, prompt, options }] = calls;
	assert.deepEqual({ prompt, cwd: options.cwd, timeoutMs: options.timeoutMs }, { prompt: 'read this', cwd: '/repo', timeoutMs: 0 });
	assert.deepEqual([flag(args, '--model'), flag(args, '--tools'), flag(args, '--allowedTools'), flag(args, '--output-format')], ['sonnet', 'Bash,Read', 'Bash,Read', 'json']);
	assert.deepEqual(out, { text: 'reply', durationMs: 1000, turns: 3, costUsd: 0.25, sessionId: flag(args, '--session-id') });
});

test('a session with no tools has them all turned off', async () => {
	const { calls, exec } = fakeExec([{ stdout: result({}) }]);
	await runClaude({ prompt: 'p', model: 'sonnet', exec });
	assert.equal(flag(calls[0].args, '--tools'), '');
	assert.ok(!calls[0].args.includes('--allowedTools'));
});

test('a message to an earlier session resumes it', async () => {
	const { calls, exec } = fakeExec([{ stdout: result({}) }]);
	const out = await runClaude({ prompt: 'again', model: 'sonnet', resume: 'abc', exec });
	assert.equal(flag(calls[0].args, '--resume'), 'abc');
	assert.ok(!calls[0].args.includes('--session-id'));
	assert.equal(out.sessionId, 'abc');
});

test('an agent still running at its time limit is stopped and resumed to write up', async () => {
	const { calls, exec } = fakeExec([{ stdout: '', status: null, killed: true, ms: 720000 }, { stdout: result({ result: 'wrote it', duration_ms: 30000, num_turns: 4 }) }]);
	const out = await runClaude({ prompt: 'isolate', model: 'sonnet', timeLimitMinutes: 12, timeUpMessage: 'Time is up.', minuteMs: 1, exec });
	assert.equal(calls[0].options.timeoutMs, 12);
	assert.deepEqual([calls[1].prompt, flag(calls[1].args, '--resume')], ['Time is up.', flag(calls[0].args, '--session-id')]);
	assert.deepEqual({ ...out, sessionId: undefined }, { text: 'wrote it', durationMs: 750000, turns: 4, costUsd: 0.25, sessionId: undefined });
});

test('a session that errors throws with what it said', async () => {
	await assert.rejects(runClaude({ prompt: 'p', model: 'sonnet', exec: fakeExec([{ stdout: result({ is_error: true, result: 'maxTurns reached' }), status: 1 }]).exec }), /claude exited 1: maxTurns reached/);
	await assert.rejects(runClaude({ prompt: 'p', model: 'sonnet', exec: fakeExec([{ stdout: 'not json' }]).exec }), /not json/);
});
