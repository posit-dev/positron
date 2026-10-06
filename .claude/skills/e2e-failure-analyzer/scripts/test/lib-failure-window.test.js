// Run with:
//   node --test ".claude/skills/e2e-failure-analyzer/scripts/test/*.test.js"
// (Use the glob, not the bare directory -- `node --test <dir>` fails to resolve
// ESM under this repo's root package.json, for these and the triage tests alike.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildDomPresence,
	describeWindowSource,
	extractTraceClock,
	findFailureWindow,
	logRelevance,
	parseLogTimestamp,
	phaseLabel,
	pickFailureFrames,
	relevanceHintsForSpec,
	renderKernelDigest,
	screencastFrameEntry,
	snapshotAttrTokens,
	summarizeKernelLine,
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

// A test-thrown failure, shaped like positron-builds run 35870872309 attempt 2
// ("Variables - Progress bar"): `expect(async () => expect(await
// variables.hasProgressBar()).toBe(true)).toPass({ timeout: 5000 })`. Every
// isVisible() returned ok, so no `after` carries an error; the reporting
// fixture's failure screenshot (no `path`) follows the last poll, and afterEach
// presses keys after that.
const PROGRESS_SELECTOR = '.variables-core .monaco-progress-container';
const call = (callId, method, startTime, endTime, params = {}) => [
	{ type: 'before', callId, class: method === 'screenshot' || method.startsWith('keyboard') ? 'Page' : 'Frame', method, startTime, params },
	{ type: 'after', callId, endTime },
];
const pollLoop = (start, count, selector = PROGRESS_SELECTOR) => Array.from({ length: count }, (_, i) =>
	call(`poll@${i}`, 'isVisible', start + i * 700, start + i * 700 + 10, { selector })).flat();
const TOPASS_TRACE = [
	...call('click@1', 'click', 4460070, 4460131, { selector: '.positron-modal-dialog-box >> internal:role=button[name="Delete"i]' }),
	...pollLoop(4460194.993, 8),
	...call('shot@1', 'screenshot', 4465135.537, 4465290, { timeout: 30000 }),
	...call('key@1', 'keyboardPress', 4465300, 4465310),
	...call('key@2', 'keyboardPress', 4465320, 4465330),
];

test('findFailureWindow infers a toPass/poll failure from the retry loop before the failure screenshot', () => {
	assert.deepEqual(findFailureWindow(TOPASS_TRACE), {
		actionStartT: 4460194.993,
		deadlineT: 4460194.993 + 7 * 700 + 10,
		method: 'Frame.isVisible',
		inferredFrom: `retry loop (8 identical calls on ${PROGRESS_SELECTOR})`,
	});
	assert.match(describeWindowSource(findFailureWindow(TOPASS_TRACE)), /^The test failed on its own assertion/);
	// An errored call needs no caveat.
	assert.equal(describeWindowSource({ actionStartT: 1, deadlineT: 2, method: 'Frame.expect' }), '');
});

// An errored call that a retry loop caught, long before the failure.
const caughtRetry = (callId, startTime) => [
	{ type: 'before', callId, class: 'Frame', method: 'expect', startTime, params: { selector: '.quick-input-widget .quick-input-list .monaco-list-row' } },
	{ type: 'after', callId, endTime: startTime + 2000, error: { message: 'Expect failed' } },
];

test('findFailureWindow anchors on the error that escaped, not the first one a retry caught', () => {
	// Shaped like positron run 37477123593, "Python - Install, search, and
	// uninstall package": 8 caught "Expect failed" retries from t=1887867, and
	// the call that failed the test ending 8ms before the failure screenshot.
	const events = [
		...[0, 1, 2, 3, 4, 5, 6, 7].flatMap(i => caughtRetry(`retry@${i}`, 1887867 + i * 2050)),
		{ type: 'before', callId: 'pkg', class: 'Frame', method: 'expect', startTime: 1972511, params: { selector: '.positron-packages-list >> .packages-list-item-name' } },
		{ type: 'after', callId: 'pkg', endTime: 1987511, error: { message: 'Expect failed' } },
		...call('shot@1', 'screenshot', 1987519, 1987700),
		// Teardown that errors after the failure must not win either.
		...caughtRetry('teardown', 1990000),
	];
	assert.deepEqual(findFailureWindow(events), { actionStartT: 1972511, deadlineT: 1987511, method: 'Frame.expect' });
	// Without the failure screenshot there is nothing to tell them apart: the
	// first errored call, as before.
	assert.equal(findFailureWindow(events.filter(e => e.callId !== 'shot@1')).deadlineT, 1887867 + 2000);
});

test('findFailureWindow pairs an errored call with its own before when calls overlap', () => {
	// From the same run: a waitForSelector started at t=1926779, an expect
	// started at t=1927501, and the waitForSelector timed out first. The nearest
	// preceding `before` is the expect's.
	const events = [
		{ type: 'before', callId: 'wait', class: 'Frame', method: 'waitForSelector', startTime: 1926779 },
		{ type: 'before', callId: 'exp', class: 'Frame', method: 'expect', startTime: 1927501 },
		{ type: 'after', callId: 'wait', endTime: 1956786, error: { message: 'Timeout 30000ms exceeded.' } },
	];
	assert.deepEqual(findFailureWindow(events), { actionStartT: 1926779, deadlineT: 1956786, method: 'Frame.waitForSelector' });
});

test('findFailureWindow prefers the retry loop over a caught error from earlier', () => {
	const events = [...caughtRetry('early', 1000), ...TOPASS_TRACE];
	assert.equal(findFailureWindow(events).inferredFrom, `retry loop (8 identical calls on ${PROGRESS_SELECTOR})`);
	// No loop either: the screenshot alone, never the stale caught error.
	assert.deepEqual(
		findFailureWindow([...caughtRetry('early', 100), ...call('k', 'keyboardPress', 4900, 4910), ...call('s', 'screenshot', 5000, 5100)]),
		{ actionStartT: null, deadlineT: 5000, method: null, inferredFrom: 'failure screenshot' }
	);
});

test('findFailureWindow falls back to the failure screenshot alone when no retry loop ends at it', () => {
	const screenshotOnly = { actionStartT: null, deadlineT: 5000, method: null, inferredFrom: 'failure screenshot' };
	// Repeated INPUT is the test pressing keys, not polling.
	const keys = [...call('k1', 'keyboardPress', 100, 110), ...call('k2', 'keyboardPress', 200, 210), ...call('k3', 'keyboardPress', 300, 310)];
	assert.deepEqual(findFailureWindow([...keys, ...call('s', 'screenshot', 5000, 5100)]), screenshotOnly);
	// A loop that ended long before the failure is some earlier wait.
	assert.deepEqual(findFailureWindow([...pollLoop(100, 3), ...call('s', 'screenshot', 5000, 5100)]), screenshotOnly);
	// Two calls are not a loop.
	assert.deepEqual(findFailureWindow([...pollLoop(4000, 2), ...call('s', 'screenshot', 5000, 5100)]), screenshotOnly);
});

test('findFailureWindow does not infer a window without the failure screenshot', () => {
	// A loop alone could be teardown polling for something.
	assert.equal(findFailureWindow(pollLoop(100, 5)), null);
	// A test's own takeScreenshot always passes a path, so it is not the failure instant.
	assert.equal(findFailureWindow([...pollLoop(100, 5), ...call('s', 'screenshot', 3600, 3700, { path: '/tmp/1-x.png' })]), null);
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
	// Trace format v9 (Playwright 1.63) names the frame in `file` and has no sha1.
	assert.equal(
		traceEpochOrigin([{ type: 'screencast-frame', file: 'screencast/page@f8d6-1790176754807.jpeg', timestamp: 4421993.119 }]),
		1790176754807 - 4421993.119
	);
});

test('screencastFrameEntry finds the frame image in both trace formats', () => {
	// v9: the path is given outright, under screencast/.
	assert.equal(
		screencastFrameEntry({ file: 'screencast/page@f8d6-1790176754807.jpeg', timestamp: 1 }),
		'screencast/page@f8d6-1790176754807.jpeg'
	);
	// Older traces: a bare file name under resources/.
	assert.equal(screencastFrameEntry({ sha1: 'page@abc-1785521606767.jpeg' }), 'resources/page@abc-1785521606767.jpeg');
	assert.equal(screencastFrameEntry({}), null);
	assert.equal(screencastFrameEntry(null), null);
});

test('pickFailureFrames stops at the failure, not at teardown', () => {
	const frame = (timestamp) => ({ type: 'screencast-frame', file: `screencast/p-${timestamp}.jpeg`, timestamp });
	// Two frames after the deadline, painted by afterEach's layout reset. The
	// trace's last frames would show them as the "failure state".
	const events = [...TOPASS_TRACE, frame(4464000), frame(4464800), frame(4465000), frame(4465342), frame(4465357)];
	assert.deepEqual(pickFailureFrames(events, 2).map(f => f.timestamp), [4464800, 4465000]);
	// No window => the trace's last frames, as before.
	assert.deepEqual(pickFailureFrames([frame(1), frame(2), frame(3)], 2).map(f => f.timestamp), [2, 3]);
	assert.deepEqual(pickFailureFrames(events, 0), []);
});

test('summarizeKernelLine keeps sends and execute/lifecycle states, and drops comm busy/idle noise', () => {
	const at = '2026-09-23 15:19:53.003 [debug]';
	assert.deepEqual(
		summarizeKernelLine(`${at} r-fa94cab0 >>> SEND comm_msg [shell]: {"comm_id":"positron-variables-r-3-aab2aa02","data":{"jsonrpc":"2.0","method":"clear","id":"32ff","params":{"include_hidden_objects":false}}}`),
		{ session: 'r-fa94cab0', text: 'SEND comm_msg positron-variables-r-3-aab2aa02 method=clear' }
	);
	assert.deepEqual(
		summarizeKernelLine(`${at} r-fa94cab0 >>> SEND execute_request [shell]: {"code":"cat(\\"started\\")\\nSys.sleep(20)","silent":false}`),
		{ session: 'r-fa94cab0', text: 'SEND execute_request code="cat(\\"started\\"); Sys.sleep(20)"' }
	);
	// UI-comm RPCs name the real method inside call_method.
	assert.equal(
		summarizeKernelLine(`${at} r-fa94cab0 >>> SEND comm_msg [shell]: {"comm_id":"positron-ui-r-4","data":{"jsonrpc":"2.0","method":"call_method","params":{"method":"setConsoleWidth","params":[25]}}}`).text,
		'SEND comm_msg positron-ui-r-4 method=call_method(setConsoleWidth)'
	);
	// A payload cut short in the log still yields its code.
	assert.equal(
		summarizeKernelLine(`${at} python-1 >>> SEND execute_request [shell]: {"code":"import time; time.sleep(5)","sil`).text,
		'SEND execute_request code="import time; time.sleep(5)"'
	);
	assert.deepEqual(
		summarizeKernelLine(`${at} r-fa94cab0 State: idle => busy (execute_request)`),
		{ session: 'r-fa94cab0', text: 'State idle => busy (execute_request)' }
	);
	assert.equal(summarizeKernelLine(`${at} r-fa94cab0 State: starting => ready (new session)`).text, 'State starting => ready (new session)');
	// Noise: the busy/idle bracket around every comm request, and comm listing.
	assert.equal(summarizeKernelLine(`${at} r-fa94cab0 State: idle => busy (comm_msg)`), null);
	assert.equal(summarizeKernelLine(`${at} r-fa94cab0 >>> SEND comm_info_request [shell]: {}`), null);
	assert.equal(summarizeKernelLine(`${at} r-fa94cab0 <<< RECV execute_reply [shell]: {"status":"ok"}`), null);
});

test('renderKernelDigest orders events, tags them against the wait, and trims the edges first', () => {
	const ms = (hms) => Date.parse(`2026-09-23T${hms}Z`);
	const actionStart = ms('15:19:53.009');
	const deadline = ms('15:19:57.941');
	const digest = renderKernelDigest([
		// Out of order on purpose: the supervisor logs are read one file at a time.
		{ at: ms('15:19:53.076'), session: 'r-fa94cab0', text: 'SEND execute_request code="Sys.sleep(20)"' },
		{ at: ms('15:19:53.003'), session: 'r-fa94cab0', text: 'SEND comm_msg positron-variables-r-3 method=clear' },
		{ at: ms('15:19:58.650'), session: 'r-fa94cab0', text: 'SEND comm_msg positron-ui-r-4 method=did_change_plots_render_settings' },
	], actionStart, deadline);
	assert.deepEqual(digest.split('\n').slice(1), [
		'15:19:53.003 [before action] r-fa94cab0 SEND comm_msg positron-variables-r-3 method=clear',
		'15:19:53.076 [during wait] r-fa94cab0 SEND execute_request code="Sys.sleep(20)"',
		'15:19:58.650 [after deadline] r-fa94cab0 SEND comm_msg positron-ui-r-4 method=did_change_plots_render_settings',
	]);
	assert.equal(renderKernelDigest([], actionStart, deadline), null);

	// Over budget: post-deadline events go first, then the earliest pre-action ones.
	const many = [
		...Array.from({ length: 30 }, (_, i) => ({ at: actionStart - 1000 + i, session: 's', text: `SEND comm_msg before-${i}` })),
		...Array.from({ length: 15 }, (_, i) => ({ at: actionStart + i, session: 's', text: `SEND comm_msg during-${i}` })),
		...Array.from({ length: 5 }, (_, i) => ({ at: deadline + 1 + i, session: 's', text: `SEND comm_msg after-${i}` })),
	];
	const lines = renderKernelDigest(many, actionStart, deadline).split('\n');
	assert.equal(lines[1], '... (5 earlier kernel events omitted)');
	assert.match(lines[2], /before-5$/);
	assert.match(lines[lines.length - 2], /during-14$/);
	assert.equal(lines[lines.length - 1], '... (5 later kernel events omitted)');
	// Consecutive repeats collapse.
	const repeated = renderKernelDigest([
		{ at: actionStart + 1, session: 's', text: 'SEND comm_msg x' },
		{ at: actionStart + 2, session: 's', text: 'SEND comm_msg x' },
	], actionStart, deadline);
	assert.match(repeated, /SEND comm_msg x \(x2\)$/);
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
