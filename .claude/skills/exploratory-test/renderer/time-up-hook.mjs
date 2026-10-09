/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A local agent's PostToolUse hook, as CI's session.mjs has: once its time is
// up, every tool result carries the time-up message, so the agent reads it at
// its next step rather than being cut off and losing what the run cost.
//
// Usage: node time-up-hook.mjs <time-limit file> <started ms> <message file> [<minute ms>]
//   The time-limit file holds whole minutes from the start; it is read on
//   every call, so it can be changed while the agent runs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The minutes in a time-limit file, or null for none: blank, missing or not a number. */
export function readTimeLimit(path) {
	let text;
	try {
		text = readFileSync(path, 'utf8').trim();
	} catch {
		return null;
	}
	const minutes = text === '' ? NaN : Number(text);
	return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

/** The hook's output for `input`, or '' while there is time left. */
export function timeUpOutput(input, { limitPath, startedMs, messagePath, minuteMs = 60000, now = Date.now() }) {
	const minutes = readTimeLimit(limitPath);
	if (minutes === null || now - startedMs < minutes * minuteMs) {
		return '';
	}
	const message = readFileSync(messagePath, 'utf8').trim();
	return JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: message } });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [limitPath, startedMs, messagePath, minuteMs] = process.argv.slice(2);
	let raw = '';
	process.stdin.on('data', chunk => { raw += chunk; });
	process.stdin.on('end', () => {
		let input = {};
		try {
			input = JSON.parse(raw);
		} catch {
			// The event name is all it reads; without it the message still goes out.
		}
		const out = timeUpOutput(input, { limitPath, startedMs: Number(startedMs), messagePath, minuteMs: minuteMs ? Number(minuteMs) : undefined });
		if (out) {
			console.log(out);
		}
	});
}
