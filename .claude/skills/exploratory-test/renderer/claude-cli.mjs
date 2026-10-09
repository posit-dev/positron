/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A local run's agents, as headless `claude -p` sessions. They use the
// person's own login, which the Agent SDK cannot.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** How long an agent has to write up after its time is up, before it is stopped. */
const WRAP_UP_MINUTES = 5;

/** Runs `claude` with `args`, `prompt` on stdin; stops it after `timeoutMs`. */
function execClaude(args, prompt, { cwd, timeoutMs }) {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
		let stdout = '';
		let killed = false;
		const timer = timeoutMs ? setTimeout(() => { killed = true; child.kill('SIGTERM'); }, timeoutMs) : null;
		child.stdout.on('data', chunk => { stdout += chunk; });
		child.on('error', reject);
		child.on('close', status => {
			clearTimeout(timer);
			resolve({ stdout, status, killed, ms: Date.now() - started });
		});
		child.stdin.end(prompt);
	});
}

function parseResult(run) {
	try {
		return JSON.parse(run.stdout);
	} catch {
		return null;
	}
}

/**
 * One agent session: `{ text, durationMs, turns, costUsd, sessionId }`, or a
 * throw when it fails. An agent with a time limit is stopped when it is up
 * and resumed with `timeUpMessage`, so it writes up what it has.
 */
export async function runClaude({ prompt, model, tools = [], cwd, resume, timeLimitMinutes = null, timeUpMessage = '', minuteMs = 60000, exec = execClaude }) {
	const sessionId = resume ?? randomUUID();
	const args = session => [
		'-p', '--output-format', 'json', '--model', model,
		// The person's own hooks, plugins and MCP servers are not the agent's.
		'--setting-sources', 'project', '--strict-mcp-config',
		'--permission-mode', 'dontAsk', '--tools', tools.join(','),
		...(tools.length ? ['--allowedTools', tools.join(',')] : []),
		...session,
	];
	const usage = { text: '', durationMs: 0, turns: null, costUsd: null, sessionId };
	const add = (run, result) => {
		usage.durationMs += result?.duration_ms ?? run.ms;
		usage.turns = result?.num_turns === undefined ? usage.turns : (usage.turns ?? 0) + result.num_turns;
		usage.costUsd = result?.total_cost_usd === undefined ? usage.costUsd : (usage.costUsd ?? 0) + result.total_cost_usd;
		usage.text = result?.result ?? '';
	};
	const first = await exec(args(resume ? ['--resume', resume] : ['--session-id', sessionId]), prompt, { cwd, timeoutMs: timeLimitMinutes ? timeLimitMinutes * minuteMs : 0 });
	if (first.killed) {
		usage.durationMs += first.ms;
		const wrapUp = await exec(args(['--resume', sessionId]), timeUpMessage, { cwd, timeoutMs: WRAP_UP_MINUTES * minuteMs });
		add(wrapUp, wrapUp.killed ? null : parseResult(wrapUp));
		return usage;
	}
	const result = parseResult(first);
	if (first.status !== 0 || !result || result.is_error) {
		throw new Error(`claude exited ${first.status}: ${result?.result || result?.subtype || first.stdout.slice(-500) || 'no output'}`);
	}
	add(first, result);
	return usage;
}
