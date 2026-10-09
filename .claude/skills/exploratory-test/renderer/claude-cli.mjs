/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A local run's agents, as headless `claude -p` sessions. They use the
// person's own login, which the Agent SDK cannot.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTimeLimit } from './time-up-hook.mjs';

/** How long an agent has to write up after its time is up, before it is stopped; CI's too. */
const WRAP_UP_MINUTES = 10;
const HOOK = fileURLToPath(new URL('./time-up-hook.mjs', import.meta.url));

/**
 * Runs `claude` with `args`, `prompt` on stdin, passing each streamed event to
 * `onEvent`; stops it once `stopAfterMs()` has passed.
 */
function execClaude(args, prompt, { cwd, stopAfterMs = () => Infinity, onEvent = () => { }, pollMs = 5000 }) {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
		let stdout = '';
		let pending = '';
		let killed = false;
		const timer = setInterval(() => {
			if (!killed && Date.now() - started >= stopAfterMs()) {
				killed = true;
				child.kill('SIGTERM');
			}
		}, pollMs);
		child.stdout.on('data', chunk => {
			stdout += chunk;
			const lines = (pending + chunk).split('\n');
			pending = lines.pop();
			for (const line of lines) {
				const event = parseLine(line);
				if (event) {
					onEvent(event);
				}
			}
		});
		child.on('error', reject);
		child.on('close', status => {
			clearInterval(timer);
			resolve({ stdout, status, killed, ms: Date.now() - started });
		});
		child.stdin.end(prompt);
	});
}

function parseLine(line) {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

/** The stream's closing `result` event, which carries the reply and its usage. */
function parseResult(run) {
	return run.stdout.split('\n').map(parseLine).filter(event => event?.type === 'result').pop() ?? null;
}

const oneLine = (text, max = 160) => {
	const flat = String(text).replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

/** What a streamed event shows in the live feed: one line per note or tool call. */
export function describeEvent(event) {
	if (event.type !== 'assistant') {
		return [];
	}
	return (event.message?.content ?? []).flatMap(block => {
		if (block.type === 'text' && block.text.trim()) {
			return [oneLine(block.text)];
		}
		if (block.type === 'tool_use') {
			const input = block.input ?? {};
			const target = input.command ?? input.file_path ?? input.pattern ?? JSON.stringify(input);
			return [`${block.name}  ${oneLine(target, 140)}`];
		}
		return [];
	});
}

const shellQuote = text => `'${String(text).replace(/'/g, `'\\''`)}'`;

/**
 * The `--settings` that give an agent its time limit, and when to stop it.
 * Once the limit in `path`, or `minutes`, is up, a hook adds `message` to every tool
 * result; the agent is stopped only if it is still going WRAP_UP_MINUTES later.
 */
function timeLimitSettings(path, minutes, message, minuteMs) {
	const scratch = mkdtempSync(join(tmpdir(), 'exploratory-time-'));
	const limitPath = path ?? join(scratch, 'time-limit');
	if (minutes !== null) {
		writeFileSync(limitPath, `${minutes}\n`);
	}
	const messagePath = join(scratch, 'time-up.md');
	writeFileSync(messagePath, message);
	const hook = { type: 'command', command: [process.execPath, HOOK, limitPath, Date.now(), messagePath, minuteMs].map(shellQuote).join(' ') };
	return {
		args: ['--settings', JSON.stringify({ hooks: { PostToolUse: [{ hooks: [hook] }], PostToolUseFailure: [{ hooks: [hook] }] } })],
		stopAfterMs: () => {
			const minutes = readTimeLimit(limitPath);
			return minutes === null ? Infinity : (minutes + WRAP_UP_MINUTES) * minuteMs;
		},
		cleanup: () => rmSync(scratch, { recursive: true, force: true }),
	};
}

/**
 * One agent session: `{ text, durationMs, turns, costUsd, sessionId }`, or a
 * throw when it fails. An agent with a time limit, `timeLimitMinutes` or the
 * minutes in `timeLimitPath` (read throughout, so it can change), is told
 * `timeUpMessage` once it is up. One stopped for running past it returns no
 * text and no cost, since only a finished `claude -p` reports one.
 */
export async function runClaude({ prompt, model, role = 'agent', tools = [], cwd, resume, timeLimitMinutes = null, timeLimitPath = null, timeUpMessage = '', minuteMs = 60000, feed = line => process.stderr.write(`${line}\n`), exec = execClaude }) {
	const sessionId = resume ?? randomUUID();
	const limit = timeLimitMinutes !== null || timeLimitPath ? timeLimitSettings(timeLimitPath, timeLimitMinutes, timeUpMessage, minuteMs) : null;
	const args = [
		// Streamed, so the person can watch each step in the feed.
		'-p', '--output-format', 'stream-json', '--verbose', '--model', model,
		// The person's own hooks, plugins and MCP servers are not the agent's.
		'--setting-sources', 'project', '--strict-mcp-config',
		'--permission-mode', 'dontAsk', '--tools', tools.join(','),
		...(tools.length ? ['--allowedTools', tools.join(',')] : []),
		...(limit ? limit.args : []),
		...(resume ? ['--resume', resume] : ['--session-id', sessionId]),
	];
	let run;
	try {
		const onEvent = event => describeEvent(event).forEach(line => feed(`  ${role}: ${line}`));
		run = await exec(args, prompt, { cwd, stopAfterMs: limit ? limit.stopAfterMs : () => Infinity, onEvent });
	} finally {
		limit?.cleanup();
	}
	if (run.killed) {
		return { text: '', durationMs: run.ms, turns: null, costUsd: null, sessionId };
	}
	const result = parseResult(run);
	if (run.status !== 0 || !result || result.is_error) {
		throw new Error(`claude exited ${run.status}: ${result?.result || result?.subtype || run.stdout.slice(-500) || 'no output'}`);
	}
	return { text: result.result ?? '', durationMs: result.duration_ms ?? run.ms, turns: result.num_turns ?? null, costUsd: result.total_cost_usd ?? null, sessionId };
}
