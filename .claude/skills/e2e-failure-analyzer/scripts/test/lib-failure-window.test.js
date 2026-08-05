// Run with:
//   node --test ".claude/skills/e2e-failure-analyzer/scripts/test/*.test.js"
// (Use the glob, not the bare directory -- `node --test <dir>` fails to resolve
// ESM under this repo's root package.json, for these and the triage tests alike.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	extractTraceClock,
	findFailureWindow,
	logRelevance,
	parseLogTimestamp,
	phaseLabel,
	relevanceHintsForSpec,
	traceTimeToWallMs,
} from '../lib-failure-window.js';

// Real values from posit-dev/positron run 30649144136, e2e/electron-2, test
// "anthropic-api - Sign in, send hello, sign out". Kept concrete because the
// whole point of this module is that the two clocks line up exactly.
const CLOCK = { wallTime: 1785521606767, monotonicTime: 2606564.21 };
const ACTION_START_T = 2645843.338;   // Frame.expect began waiting
const DEADLINE_T = 2675851.78;        // ...and gave up 30s later

test('extractTraceClock reads the dual-clock anchor, and null when absent', () => {
	assert.deepEqual(
		extractTraceClock([{ type: 'context-options', wallTime: 1785521606767, monotonicTime: 2606564.21 }]),
		CLOCK
	);
	assert.equal(extractTraceClock([{ type: 'context-options' }]), null);
	assert.equal(extractTraceClock([]), null);
});

test('traceTimeToWallMs maps trace time onto log wall clock', () => {
	// The failing expect gave up at 18:14:36.054Z; the assistant log's last
	// pre-teardown entry is 18:14:06.782 -- i.e. ~29.3s of silence.
	assert.equal(
		new Date(traceTimeToWallMs(DEADLINE_T, CLOCK)).toISOString(),
		'2026-07-31T18:14:36.054Z'
	);
	assert.equal(traceTimeToWallMs(DEADLINE_T, null), null);
	assert.equal(traceTimeToWallMs(null, CLOCK), null);
});

test('findFailureWindow pairs the errored after with its opening before', () => {
	const events = [
		{ type: 'before', class: 'Frame', method: 'click', startTime: 100 },
		{ type: 'after', endTime: 150 },
		{ type: 'before', class: 'Frame', method: 'expect', startTime: ACTION_START_T },
		{ type: 'after', endTime: DEADLINE_T, error: { message: 'Expect failed' } },
	];
	assert.deepEqual(findFailureWindow(events), {
		actionStartT: ACTION_START_T,
		deadlineT: DEADLINE_T,
		method: 'Frame.expect',
	});
	assert.equal(findFailureWindow([{ type: 'after', endTime: 1 }]), null);
});

test('phaseLabel separates the wait from post-deadline teardown', () => {
	const win = { actionStartT: ACTION_START_T, deadlineT: DEADLINE_T };
	// The "Models for Anthropic are temporarily unavailable" notification landed
	// at t=2676172, AFTER the deadline: it is teardown fallout, not a cause. This
	// is the exact misreading the labels exist to prevent.
	assert.equal(phaseLabel(2676172, win), 'after deadline');
	assert.equal(phaseLabel(2644377, win), 'before action');   // sign-in command
	assert.equal(phaseLabel(2660000, win), 'during wait');
	assert.equal(phaseLabel(DEADLINE_T, win), 'during wait');  // boundary is inclusive
	assert.equal(phaseLabel(123, null), null);
});

test('parseLogTimestamp handles every Positron log shape as UTC', () => {
	const expected = Date.parse('2026-07-31T18:15:23.859Z');
	// Renderer/exthost/main style (space separator, no zone -- still UTC).
	assert.equal(parseLogTimestamp('2026-07-31 18:15:23.859 [debug] User data changed'), expected);
	// e2e-test-runner style (bracketed ISO with Z).
	assert.equal(parseLogTimestamp('[2026-07-31T18:15:23.859Z] Playwright (Electron): ...'), expected);
	// Kernel style: prefixed, microsecond precision.
	assert.equal(
		parseLogTimestamp('r-bc52e7b9 [R]   2026-07-31T18:15:23.859123Z  INFO  starting'),
		expected
	);
	// Untimestamped continuation lines.
	assert.equal(parseLogTimestamp('    at someFunction (file.js:1:1)'), null);
	// A date far into the message body must not be mistaken for the line's own.
	assert.equal(parseLogTimestamp(`${'x'.repeat(130)} 2026-07-31 18:15:23.859`), null);
});

test('relevanceHintsForSpec derives hints that match the feature log path', () => {
	const hints = relevanceHintsForSpec('tests/posit-assistant/posit-assistant-signin.test.ts');
	assert.ok(hints.includes('positassistant'));
	// `tests` is a generic segment and must not become a hint.
	assert.ok(!hints.includes('tests'));
	assert.deepEqual(relevanceHintsForSpec(null), []);
});

test('logRelevance ranks the feature log above core logs above bystanders', () => {
	const hints = relevanceHintsForSpec('tests/posit-assistant/posit-assistant-signin.test.ts');
	// Dot-vs-hyphen must not defeat the match (posit.assistant ~ posit-assistant).
	assert.equal(logRelevance('window1/exthost/posit.assistant/Posit Assistant.log', hints), 2);
	assert.equal(logRelevance('window1/renderer.log', hints), 1);
	assert.equal(logRelevance('window1/exthost/vscode.git/Git.log', hints), 0);
});
