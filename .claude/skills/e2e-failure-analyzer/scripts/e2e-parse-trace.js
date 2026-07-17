#!/usr/bin/env node
// Parses a Playwright trace.trace file and outputs an action timeline.
// Usage: node e2e-parse-trace.js <trace.trace> [--last N]
// Output: Human-readable action timeline, last screenshot hash, and any errors

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

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

// --- Shared analysis helpers (kept in sync with the inline copies in
// e2e-process-project.js / e2e-process-s3.js). ---

/**
 * Collect the selectors involved in FAILED actions/assertions. For each errored
 * `after`, we take the selector from the nearest preceding `before` (the action
 * that failed) and also mine any `locator('...')` out of the error message.
 * These are the selectors whose target the test was actually waiting for -- the
 * ones worth checking against the DOM snapshots.
 */
function collectFailingSelectors(evts) {
	const selectors = new Set();
	for (let i = 0; i < evts.length; i++) {
		const e = evts[i];
		if (e.type !== 'after' || !e.error) { continue; }
		for (let j = i - 1; j >= 0; j--) {
			if (evts[j].type === 'before') {
				if (evts[j].params?.selector) { selectors.add(evts[j].params.selector); }
				break;
			}
		}
		for (const m of String(e.error.message || '').matchAll(/locator\(['"`]([^'"`]+)['"`]\)/g)) {
			selectors.add(m[1]);
		}
	}
	return [...selectors];
}

/** Pull stable class/id tokens out of selector strings (the parts that identify
 *  an element in the serialized DOM, unlike text/regex matchers). */
function selectorTokens(selectors) {
	const tokens = new Set();
	for (const sel of selectors) {
		for (const m of String(sel).matchAll(/\.([A-Za-z_][\w-]{2,})/g)) { tokens.add(m[1]); }
		for (const m of String(sel).matchAll(/\[id=["']([^"']+)["']\]/g)) { tokens.add(m[1]); }
	}
	return [...tokens];
}

/**
 * Report whether each failing-selector token ever entered the DOM across the
 * trace's frame snapshots. "NEVER present" means the element genuinely never
 * rendered (a product open-path bug) -- as opposed to rendering and then being
 * dismissed, which the single moment-of-failure error-context snapshot cannot
 * distinguish. Substring-matches the token in each serialized snapshot.
 */
function buildDomPresence(evts, tokens) {
	if (!tokens.length) { return null; }
	const snaps = evts
		.filter(e => e.type === 'frame-snapshot' && e.snapshot?.timestamp != null)
		.map(s => ({ ts: s.snapshot.timestamp, json: JSON.stringify(s) }));
	if (!snaps.length) { return null; }
	const span = `t=${Math.round(snaps[0].ts)}..${Math.round(snaps[snaps.length - 1].ts)}`;
	const out = [`\n=== DOM presence across ${snaps.length} frame snapshots (${span}) ===`];
	out.push("Did the failing selector's target ever enter the DOM? NEVER present => it never rendered (product open-path issue), not a render-then-dismiss.");
	for (const tok of tokens) {
		const hits = snaps.filter(s => s.json.includes(tok));
		if (!hits.length) {
			out.push(`- '${tok}': NEVER present in any snapshot`);
		} else {
			out.push(`- '${tok}': present in ${hits.length}/${snaps.length} snapshots (t=${Math.round(hits[0].ts)}..${Math.round(hits[hits.length - 1].ts)})`);
		}
	}
	return out.join('\n');
}

/** Strip the `%c`/`color:#…` console-formatting noise VS Code prepends. */
function cleanConsole(text) {
	return String(text)
		.replace(/%c/g, '')
		.replace(/(?:background|color):\s*#?[0-9a-fA-F]{3,6}/g, '')
		.replace(/\s;\s/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.replace(/^[\s;:-]+/, '')
		.trim();
}

// Console lines that match the allowlist / error levels but carry no diagnostic
// value: internal context-key churn, the dev-only disposable-leak tracker, and
// benign environment probes on CI runners.
const CONSOLE_NOISE_RE = /(_setContext|LEAKED DISPOSABLE|No pandoc executable|MetadataLookupWarning|received unexpected error = network timeout)/i;

/**
 * Digest of high-signal renderer-console lines around the failure window:
 * command executions (proves a click's command actually fired), runtime-startup
 * phase transitions (timing races), and any errors/warnings. This is the signal
 * that distinguishes "click was swallowed" from "command ran but nothing
 * rendered." Consecutive duplicates are collapsed with an (xN) count.
 */
function buildConsoleDigest(evts) {
	const ALLOW = /(CommandService#executeCommand|Runtime startup][^\n]*Phase changed|Discovery completed|Uncaught|Unhandled)/i;
	const MAX_LINES = 28;
	const consoles = evts.filter(e => e.type === 'console' && typeof e.text === 'string');
	if (!consoles.length) { return null; }
	const errTimes = evts.filter(e => e.type === 'after' && e.error).map(e => e.endTime ?? e.startTime).filter(t => t != null);
	const focusStart = errTimes.length ? Math.min(...errTimes) - 3000 : -Infinity;
	const focusEnd = errTimes.length ? Math.max(...errTimes) + 1000 : Infinity;
	const picked = consoles.filter(e =>
		(e.time == null || (e.time >= focusStart && e.time <= focusEnd)) &&
		(e.messageType === 'error' || e.messageType === 'warning' || ALLOW.test(e.text)) &&
		!CONSOLE_NOISE_RE.test(e.text));
	if (!picked.length) { return null; }

	// Collapse consecutive duplicates (a retried command logs the same line N times).
	const entries = [];
	for (const e of picked) {
		const text = cleanConsole(e.text).slice(0, 200);
		const last = entries[entries.length - 1];
		if (last && last.text === text) { last.count++; continue; }
		entries.push({ time: e.time, level: e.messageType || 'log', text, count: 1 });
	}

	const shown = entries.slice(0, MAX_LINES);
	const out = [`\n=== Console digest near failure (${shown.length}${entries.length > shown.length ? ` of ${entries.length}` : ''} high-signal lines) ===`];
	for (const e of shown) {
		out.push(`t=${Math.round(e.time ?? 0)} [${e.level}] ${e.text}${e.count > 1 ? ` (x${e.count})` : ''}`);
	}
	return out.join('\n');
}

// Extract action timeline (before/after pairs)
const actions = events.filter(e => e.type === 'before' || e.type === 'after');
const recent = actions.slice(-lastN);

console.log(`=== Action Timeline (last ${Math.min(lastN, actions.length)} of ${actions.length} events) ===\n`);

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
	const last = screenshots[screenshots.length - 1];
	console.log(`\n=== Screenshots ===`);
	console.log(`Total screencast frames: ${screenshots.length}`);
	console.log(`Last screenshot sha1: ${last.sha1}`);
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
const failingTokens = selectorTokens(collectFailingSelectors(events));
const domPresence = buildDomPresence(events, failingTokens);
if (domPresence) { console.log(domPresence); }
const consoleDigest = buildConsoleDigest(events);
if (consoleDigest) { console.log(consoleDigest); }
