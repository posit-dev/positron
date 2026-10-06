#!/usr/bin/env node
// Parses a Playwright trace.trace file and outputs an action timeline.
// Usage: node e2e-parse-trace.js <trace.trace> [--last N]
// Output: Human-readable action timeline, the last screenshot before the failure, and any errors

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { buildConsoleDigest, buildDomPresence, findFailureWindow, pickFailureFrames, screencastFrameEntry, selectorTokens, traceEpochOrigin } from './lib-failure-window.js';

const args = process.argv.slice(2);
let tracePath = null;
let lastN = 30;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--last' && args[i + 1]) {
		lastN = parseInt(args[i + 1], 10);
		i++;
	} else if (!tracePath) {
		tracePath = args[i];
	}
}

if (!tracePath) {
	console.error('Usage: node e2e-parse-trace.js <trace.trace> [--last N]');
	process.exit(1);
}

const resolved = resolve(tracePath);
if (!existsSync(resolved)) {
	console.error(`File not found: ${resolved}`);
	process.exit(1);
}

const content = readFileSync(resolved, 'utf8');
const lines = content.split('\n').filter(Boolean);
const events = [];
for (const line of lines) {
	try {
		events.push(JSON.parse(line));
	} catch {
		// skip malformed lines
	}
}

// Extract action timeline (before/after pairs)
const actions = events.filter(e => e.type === 'before' || e.type === 'after');
const recent = actions.slice(-lastN);

console.log(`=== Action Timeline (last ${Math.min(lastN, actions.length)} of ${actions.length} events) ===\n`);

const traceT0 = traceEpochOrigin(events);
if (traceT0 != null) {
	console.log(`Trace t=0 = ${new Date(traceT0).toISOString()} -- add (t / 1000) seconds to any t= below to get wall clock.\n`);
}

for (const a of recent) {
	if (a.type === 'before') {
		let info = `${a.class || '?'}.${a.method || '?'}`;
		if (a.startTime != null) info += ` (t=${Math.round(a.startTime)})`;
		if (a.params?.selector) info += ` selector: ${a.params.selector}`;
		if (a.params?.url) info += ` url: ${a.params.url}`;
		console.log(`[before] ${info}`);
	} else {
		const err = a.error?.message?.slice(0, 300);
		if (err) {
			console.log(`[after]  ERROR: ${err}`);
		} else {
			let info = 'ok';
			if (a.endTime != null) info += ` (t=${Math.round(a.endTime)})`;
			console.log(`[after]  ${info}`);
		}
	}
}

// Find screenshots
const screenshots = events.filter(e => e.type === 'screencast-frame');
if (screenshots.length > 0) {
	const [last] = pickFailureFrames(events, 1);
	console.log(`\n=== Screenshots ===`);
	console.log(`Total screencast frames: ${screenshots.length}`);
	console.log(`Last screenshot at or before the failure: ${screencastFrameEntry(last)} (path inside the trace zip)`);
	console.log(`Last screenshot timestamp: ${last.timestamp}`);
} else {
	console.log('\nNo screencast frames found in trace.');
}

// Summarize errors
const errorEvents = events.filter(e => e.type === 'after' && e.error);
if (errorEvents.length > 0) {
	console.log(`\n=== Errors (${errorEvents.length}) ===`);
	for (const e of errorEvents) {
		console.log(`- ${(e.error.message || '').slice(0, 500)}`);
	}
}

// DOM presence of the failing selector(s) over time, and a console digest of
// command executions / startup-phase transitions near the failure. These
// distinguish "the control never rendered" and "the command fired but nothing
// happened" from a pure environment flake.
const failureWindow = findFailureWindow(events);
const domPresence = buildDomPresence(events, selectorTokens(failureWindow?.selectors ?? []), failureWindow);
if (domPresence) { console.log(domPresence); }
const consoleDigest = buildConsoleDigest(events, failureWindow);
if (consoleDigest) { console.log(consoleDigest); }
