// Run with:
//   node --test ".claude/skills/e2e-failure-analyzer/scripts/test/*.test.js"
// (Use the glob, not the bare directory -- `node --test <dir>` fails to resolve
// ESM under this repo's root package.json, for these and the triage tests alike.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildDomPresence,
	extractTraceClock,
	findFailureWindow,
	logRelevance,
	parseLogTimestamp,
	phaseLabel,
	relevanceHintsForSpec,
	snapshotAttrTokens,
	traceEpochOrigin,
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

test('traceEpochOrigin recovers t=0 from a screencast frame, and null without one', () => {
	// The frame's sha1 ends in its own epoch ms, and its timestamp is the trace
	// offset -- so origin = epoch - offset.
	assert.equal(
		traceEpochOrigin([{ type: 'screencast-frame', sha1: 'abc-1785521606767.jpeg', timestamp: 2606564 }]),
		1785521606767 - 2606564
	);
	// A sha1 without the trailing epoch cannot anchor anything.
	assert.equal(traceEpochOrigin([{ type: 'screencast-frame', sha1: 'abc.jpeg', timestamp: 10 }]), null);
	assert.equal(traceEpochOrigin([{ type: 'before', startTime: 1 }]), null);
});

test('snapshotAttrTokens reads class/id attributes, not stylesheet text', () => {
	// The bug this exists for: a `codicon-x` token matching its own CSS rule in
	// the inlined stylesheet, and reporting the element as present.
	const json = '["DIV",{"class":"panel codicon-x","id":"main"},["STYLE",{},".codicon-y{color:red}"]]';
	assert.deepEqual([...snapshotAttrTokens(json)].sort(), ['codicon-x', 'main', 'panel']);
});

// JSON.stringify of the event is what buildDomPresence matches against, so the
// token has to sit in a `class`/`id` attribute position within it.
const snap = (t, cls) => ({ type: 'frame-snapshot', snapshot: { timestamp: t }, x: { class: cls } });

test('buildDomPresence anchors the wait window on findFailureWindow', () => {
	// Two errored actions: the first has no usable deadline, so findFailureWindow
	// skips it and the window opens at the SECOND action (t=500). A token seen
	// only at t=100 is therefore before the wait, not during it. The private
	// helper this replaced stopped at the first errored `after` and would have
	// anchored at t=50, flipping this token to "during the wait".
	const events = [
		{ type: 'before', class: 'Frame', method: 'click', startTime: 50 },
		{ type: 'after', error: { message: 'boom' } },              // no endTime/startTime
		{ type: 'before', class: 'Frame', method: 'expect', startTime: 500 },
		{ type: 'after', endTime: 900, error: { message: 'Expect failed' } },
		snap(100, 'target-token'),
		snap(800, 'other-token'),
	];
	assert.equal(findFailureWindow(events).actionStartT, 500);
	const out = buildDomPresence(events, ['target-token']);
	assert.match(out, /NEVER during the wait \(from t=500\)/);
	assert.doesNotMatch(out, /during the wait; a visibility/);
});

test('buildDomPresence separates present-during-wait, absent, and no-window', () => {
	const events = [
		{ type: 'before', class: 'Frame', method: 'expect', startTime: 500 },
		{ type: 'after', endTime: 900, error: { message: 'Expect failed' } },
		snap(600, 'target-token'),
	];
	assert.match(buildDomPresence(events, ['target-token']), /1 of them during the wait \(from t=500\)/);
	assert.match(buildDomPresence(events, ['absent-token']), /NEVER present in any snapshot/);
	// No errored action at all -> no window, and the report must say so rather
	// than implying the token was present when the action ran.
	const noFailure = [{ type: 'before', startTime: 1 }, snap(600, 'target-token')];
	assert.match(buildDomPresence(noFailure, ['target-token']), /no wait window found/);
	// Nothing to report without tokens or without snapshots.
	assert.equal(buildDomPresence(events, []), null);
	assert.equal(buildDomPresence([{ type: 'before', startTime: 1 }], ['target-token']), null);
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
