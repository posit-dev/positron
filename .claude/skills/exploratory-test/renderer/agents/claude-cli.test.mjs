/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeEvent, runClaude } from './claude-cli.mjs';

const result = fields => JSON.stringify({ type: 'result', is_error: false, result: 'reply', duration_ms: 1000, num_turns: 3, total_cost_usd: 0.25, ...fields });

/** A fake `claude` that answers each call with the next of `runs`, recording what it was given. */
function fakeExec(runs) {
	const calls = [];
	const exec = async (args, prompt, options) => {
		calls.push({ args, prompt, options, stopAt: options.stopAfterMs() });
		return { status: 0, killed: false, ms: 5000, ...runs[calls.length - 1] };
	};
	return { calls, exec };
}

const flag = (args, name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;

test('a session gets its tools, model and a session id, and returns its reply and usage', async () => {
	const { calls, exec } = fakeExec([{ stdout: result({}) }]);
	const out = await runClaude({ prompt: 'read this', model: 'sonnet', tools: ['Bash', 'Read'], cwd: '/repo', exec });
	const [{ args, prompt, options }] = calls;
	assert.deepEqual({ prompt, cwd: options.cwd, stopAt: calls[0].stopAt }, { prompt: 'read this', cwd: '/repo', stopAt: Infinity });
	assert.ok(!args.includes('--settings'));
	assert.deepEqual([flag(args, '--model'), flag(args, '--tools'), flag(args, '--allowedTools'), flag(args, '--output-format')], ['sonnet', 'Bash,Read', 'Bash,Read', 'stream-json']);
	assert.deepEqual(out, { text: 'reply', durationMs: 1000, turns: 3, costUsd: 0.25, sessionId: flag(args, '--session-id') });
});

test('the stream\'s result event is the reply, after the events before it', async () => {
	const assistant = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }] } });
	const { exec } = fakeExec([{ stdout: `${assistant}\n${result({ result: 'done' })}\n` }]);
	assert.equal((await runClaude({ prompt: 'p', model: 'sonnet', exec })).text, 'done');
});

test('the feed shows each note and tool call, one line each, under the agent\'s role', async () => {
	const event = { type: 'assistant', message: { content: [
		{ type: 'text', text: 'Opening the\nnotebook.' },
		{ type: 'tool_use', name: 'Bash', input: { command: 'qmd.sh open a.qmd' } },
		{ type: 'tool_use', name: 'Read', input: { file_path: '/run/shots/01.png' } },
		{ type: 'tool_use', name: 'Glob', input: { path: '/x' } },
	] } };
	assert.deepEqual(describeEvent(event), ['Opening the notebook.', 'Bash  qmd.sh open a.qmd', 'Read  /run/shots/01.png', 'Glob  {"path":"/x"}']);
	const bash = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: '. /run/x/tmp/env.sh; cd /repo; ./launch.sh', description: 'Launch Positron for /run/x' } }] } };
	assert.deepEqual(describeEvent(bash, { '/run/x': '$RUN' }), ['Bash  Launch Positron for $RUN']);
	assert.deepEqual(describeEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: 'hi' }] } }), []);
	const lines = [];
	const exec = async (args, prompt, options) => {
		options.onEvent(event);
		return { status: 0, killed: false, ms: 1, stdout: result({}) };
	};
	await runClaude({ prompt: 'p', model: 'opus', role: 'explore', feed: line => lines.push(line), exec });
	assert.deepEqual(lines[0], '  explore: Opening the notebook.');
	assert.equal(lines.length, 4);
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

test('an agent with a time limit is told by a hook, and stopped only after the wrap-up', async () => {
	const { calls, exec } = fakeExec([{ stdout: result({}) }]);
	const out = await runClaude({ prompt: 'isolate', model: 'sonnet', timeLimitMinutes: 12, timeUpMessage: 'Time is up.', minuteMs: 1, exec });
	const hooks = JSON.parse(flag(calls[0].args, '--settings')).hooks;
	assert.match(hooks.PostToolUse[0].hooks[0].command, /time-up-hook\.mjs/);
	assert.deepEqual(hooks.PostToolUseFailure, hooks.PostToolUse);
	assert.equal(calls[0].stopAt, 22);
	// The whole run, so its cost too, comes from one finished session.
	assert.equal(out.costUsd, 0.25);
});

test('a time limit read from a file follows changes to it', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'limit-test-'));
	const path = join(dir, 'time-limit');
	writeFileSync(path, '30\n');
	const exec = async (args, prompt, options) => {
		const before = options.stopAfterMs();
		writeFileSync(path, '0\n');
		return { status: 0, killed: false, ms: 1, stdout: result({ result: String([before, options.stopAfterMs()]) }) };
	};
	try {
		assert.equal((await runClaude({ prompt: 'p', model: 'opus', timeLimitPath: path, minuteMs: 1, exec })).text, '40,10');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('an agent stopped for running past its wrap-up returns no text and no cost', async () => {
	const { exec } = fakeExec([{ stdout: '', status: null, killed: true, ms: 1320000 }]);
	const out = await runClaude({ prompt: 'p', model: 'sonnet', timeLimitMinutes: 12, timeUpMessage: 'Time is up.', exec });
	assert.deepEqual({ ...out, sessionId: undefined }, { text: '', durationMs: 1320000, turns: null, costUsd: null, sessionId: undefined });
});

test('a session that errors throws with what it said', async () => {
	await assert.rejects(runClaude({ prompt: 'p', model: 'sonnet', exec: fakeExec([{ stdout: result({ is_error: true, result: 'maxTurns reached' }), status: 1 }]).exec }), /claude exited 1: maxTurns reached/);
	await assert.rejects(runClaude({ prompt: 'p', model: 'sonnet', exec: fakeExec([{ stdout: 'not json' }]).exec }), /not json/);
});
