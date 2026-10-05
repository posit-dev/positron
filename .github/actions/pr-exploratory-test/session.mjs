/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// One agent session through the Claude Agent SDK: the query loop, the time-up
// hook, the hard stop and the cost record. What a session is for stays with its caller.

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { buildCostRecord, timeUpHook, WRAP_UP_MINUTES } from './lib.mjs';

export async function runSession({ prompt, systemPrompt, allowedTools, model, maxTurns, cwd, timeLimit = null, effort = '', thinking, claudeCodePath, label = 'session', query = sdkQuery, minuteMs = 60000, log = console.log }) {
	const texts = [];
	let cost = buildCostRecord(null);
	let timedOut = false;
	let timeWasUp = false;
	// Counts assistant messages, which is not what maxTurns limits: the SDK's
	// own num_turns runs about 40% lower. Labelled "msg" so a live log cannot be
	// read as approaching the cap.
	let messages = 0;
	const abortController = new AbortController();
	let hardStop;
	let hooks;
	if (timeLimit) {
		const hook = timeUpHook({
			deadline: Date.now() + timeLimit * minuteMs,
			minutes: timeLimit,
			onTimeUp: () => { timeWasUp = true; log(`[${label}] time limit: ${timeLimit}m are up; told the agent to wrap up`); },
		});
		let hookCalled = false;
		const logged = async input => {
			if (!hookCalled) { hookCalled = true; log(`[${label}] time limit: hook active on ${input.hook_event_name}`); }
			return hook(input);
		};
		hooks = { PostToolUse: [{ hooks: [logged] }], PostToolUseFailure: [{ hooks: [logged] }] };
		hardStop = setTimeout(() => {
			timedOut = true;
			log(`[${label}] time limit: stopping the agent ${WRAP_UP_MINUTES}m after its time was up`);
			abortController.abort();
		}, (timeLimit + WRAP_UP_MINUTES) * minuteMs);
	}
	try {
		for await (const message of query({
			prompt,
			options: {
				model, cwd, allowedTools, maxTurns, abortController,
				...(systemPrompt ? { systemPrompt } : {}),
				// No permissionMode: 'bypassPermissions'. The CLI refuses
				// --dangerously-skip-permissions under euid 0 and the job container
				// runs as root. allowedTools is what grants the tools.
				// Forward the CLI's stderr: without it a refusal to start is
				// indistinguishable from a crash.
				stderr: data => process.stderr.write(`[${label} stderr] ${data}`),
				...(thinking ? { thinking } : {}),
				...(effort ? { effort } : {}),
				...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
				...(hooks ? { hooks } : {}),
			},
		})) {
			if (message.type === 'assistant') {
				messages++;
				const content = message.message?.content || [];
				const notes = content.filter(b => b.type === 'thinking' && b.thinking).map(b => b.thinking);
				if (notes.length) { log(`[msg ${messages}] note: ${notes.join(' ').slice(0, 500)}`); }
				const text = content.filter(b => b.type === 'text').map(b => b.text);
				if (text.length) {
					const joined = text.join('\n');
					texts.push(joined);
					log(`[msg ${messages}] assistant text (${joined.length} chars):\n${joined.slice(0, 1000)}${joined.length > 1000 ? '\n...(truncated)' : ''}`);
				}
				const tools = content.filter(b => b.type === 'tool_use').map(b => `${b.name}(${JSON.stringify(b.input).slice(0, 200)})`);
				if (tools.length) { log(`[msg ${messages}] tool calls: ${tools.join(' | ')}`); }
			} else if (message.type === 'result') {
				cost = buildCostRecord(message);
				log(`[${label}] result: ${JSON.stringify(cost)}`);
			}
		}
	} catch (err) {
		// The hard stop aborts the query; what the agent wrote so far is still its output.
		if (!timedOut) { throw err; }
		log(`[${label}] the agent was stopped: ${err?.message ?? err}`);
	} finally {
		clearTimeout(hardStop);
	}
	return { texts, finalText: texts.at(-1) ?? '', cost, timedOut, timeWasUp, messages };
}
