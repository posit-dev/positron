// Shared "failure window" helpers: locate the failing action in a Playwright
// trace, convert its monotonic timestamps to wall clock, and mine the attached
// Positron logs for what happened inside that window.
//
// Why this exists: the trace and the logs use different clocks. Trace events
// carry a monotonic `t=` (ms since process start); Positron's *.log files carry
// UTC wall clock. Without an anchor the two cannot be ordered against each
// other, which makes it easy to read an event that happened AFTER a failed
// assertion as its cause. The trace's `context-options` event carries both
// clocks (`wallTime` epoch ms + `monotonicTime`), so one subtraction relates
// them exactly.
//
// Imported by e2e-parse-trace.js, e2e-process-project.js and e2e-process-s3.js
// so the windowing, DOM-presence, console-digest and screencast-frame logic has
// a single home. NOTE: parseTrace predates this module and is still copied into
// e2e-process-project.js and e2e-process-s3.js; new shared logic belongs here.
//
// Unit tests: node --test ".claude/skills/e2e-failure-analyzer/scripts/test/*.test.js"

import { readFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Trace clock + failure window
// ---------------------------------------------------------------------------

/**
 * Pull the trace's dual-clock anchor out of the `context-options` event.
 * Returns null when absent (older traces), which makes every wall-clock
 * conversion below a no-op and sends callers down their legacy path.
 * @returns {{wallTime: number, monotonicTime: number} | null}
 */
export function extractTraceClock(events) {
	const co = events.find(e => e.type === 'context-options');
	if (co?.wallTime == null || co?.monotonicTime == null) { return null; }
	return { wallTime: Number(co.wallTime), monotonicTime: Number(co.monotonicTime) };
}

/** Convert a monotonic trace timestamp to epoch ms. */
export function traceTimeToWallMs(t, clock) {
	if (!clock || t == null) { return null; }
	return clock.wallTime + (t - clock.monotonicTime);
}

// The failing call ends, and the test function throws, a few ms before the
// failure screenshot (8-30ms observed). A call or retry loop that ended longer
// ago than this before it is not what failed the test.
const FAILURE_SHOT_MAX_GAP_MS = 2000;

/**
 * Locate the failing action and the wait it ran. `actionStartT` is when the
 * test STARTED waiting and `deadlineT` is when it gave up -- the interval
 * between them is the only period in which a cause can live. Anything after
 * `deadlineT` is teardown or post-failure noise, not a cause.
 *
 * Positron's reporting fixture screenshots the page the instant the test
 * function throws, before afterEach hooks run (see findFailureShot). When the
 * trace has it, it marks the failure, and the failing action is what ended
 * right before:
 *  - an errored call. Not simply the FIRST errored call: a retry loop (toPass,
 *    a page object's own retry) logs every attempt it catches as an errored
 *    call too, often a minute or more before the one that escaped.
 *  - else a retry loop of identical read calls. The test's own assertion threw
 *    -- `expect(async () => { expect(await x.isVisible()).toBe(true) })
 *    .toPass()`, `expect.poll` -- so every call inside returned ok.
 *  - else the screenshot alone, as the deadline with no known start (a plain
 *    `expect(value)` on something the test computed).
 * The last two carry an `inferredFrom` label saying how the window was found.
 *
 * Without the screenshot (a passing attempt, or a fixture that never took one)
 * this falls back to the first errored call, and to null when none errored: a
 * retry loop alone could be teardown polling for something, and a wrong window
 * is worse than none.
 *
 * `selectors` are what the failing action was waiting for -- its own selector,
 * plus any `locator('...')` in its error -- for the DOM-presence check. Only
 * that action's: the selectors of retries the test caught were not what failed.
 * @returns {{actionStartT: number|null, deadlineT: number|null, method: string|null, selectors: string[], inferredFrom?: string} | null}
 */
export function findFailureWindow(events) {
	// Pair each `after` with its own `before` by callId. The nearest preceding
	// `before` is only a fallback: calls overlap (an expect polling while a
	// waitForSelector runs), so it can belong to a different call.
	const beforesById = new Map(events.filter(e => e.type === 'before' && e.callId != null).map(e => [e.callId, e]));
	const errored = [];
	for (let i = 0; i < events.length; i++) {
		const e = events[i];
		if (e.type !== 'after' || !e.error) { continue; }
		let before = beforesById.get(e.callId) ?? null;
		for (let j = i - 1; j >= 0 && !before; j--) {
			if (events[j].type === 'before') { before = events[j]; }
		}
		const deadlineT = e.endTime ?? e.startTime ?? null;
		if (deadlineT == null) { continue; }
		const selectors = new Set(before?.params?.selector ? [before.params.selector] : []);
		for (const m of String(e.error.message || '').matchAll(/locator\(['"`](?<selector>[^'"`]+)['"`]\)/g)) {
			selectors.add(m.groups.selector);
		}
		errored.push({
			actionStartT: before?.startTime ?? null,
			deadlineT,
			method: before ? `${before.class || '?'}.${before.method || '?'}` : null,
			selectors: [...selectors],
		});
	}

	const shot = findFailureShot(events);
	if (!shot) { return errored[0] ?? null; }
	const failT = shot.startTime;
	const escaped = errored.filter(w => w.deadlineT <= failT && failT - w.deadlineT <= FAILURE_SHOT_MAX_GAP_MS);
	if (escaped.length) { return escaped[escaped.length - 1]; }
	return findRetryLoopBefore(events, failT)
		?? { actionStartT: null, deadlineT: failT, method: null, selectors: [], inferredFrom: 'failure screenshot' };
}

/**
 * The screenshot Positron's reporting fixture takes the instant the test
 * function throws (reporting.fixtures.ts): `page.screenshot()` with no `path`.
 * Matched on the Page class because tests take pathless LOCATOR screenshots as
 * buffers to compare (plots, notebook outputs), and a test's own
 * `takeScreenshot` always passes a path. Null on a passing attempt, where the
 * fixture takes none.
 */
function findFailureShot(events) {
	return events.findLast(e => e.type === 'before' && e.class === 'Page' && e.method === 'screenshot' && !e.params?.path && e.startTime != null) ?? null;
}

// Playwright calls that drive input rather than read state. A run of these is
// the test pressing a key several times, not a retry loop polling a condition.
const INPUT_METHOD_RE = /^(keyboard|mouse|click|dblclick|tap|fill|type|press|check|uncheck|selectOption|setInputFiles|hover|dragAndDrop|dispatchEvent|focus|blur|screenshot)/i;
const RETRY_LOOP_MIN_CALLS = 3;

/**
 * The retry loop that ended right before `failT`: the same read call on the
 * same selector, at least three times in a row, its last call ending within
 * FAILURE_SHOT_MAX_GAP_MS of `failT`. Its first call is when the wait began.
 */
function findRetryLoopBefore(events, failT) {
	const befores = events.filter(e => e.type === 'before' && e.startTime != null && e.startTime < failT);
	const last = befores[befores.length - 1];
	if (!last || INPUT_METHOD_RE.test(last.method || '')) { return null; }
	const key = e => `${e.class}.${e.method}|${e.params?.selector ?? ''}`;
	let first = befores.length - 1;
	while (first > 0 && key(befores[first - 1]) === key(last)) { first--; }
	const calls = befores.length - first;
	const lastAfter = events.find(e => e.type === 'after' && e.callId != null && e.callId === last.callId);
	const loopEndT = lastAfter?.endTime ?? last.startTime;
	if (calls < RETRY_LOOP_MIN_CALLS || failT - loopEndT > FAILURE_SHOT_MAX_GAP_MS) { return null; }
	return {
		actionStartT: befores[first].startTime,
		deadlineT: loopEndT,
		method: `${last.class || '?'}.${last.method || '?'}`,
		selectors: last.params?.selector ? [last.params.selector] : [],
		inferredFrom: `retry loop (${calls} identical calls${last.params?.selector ? ` on ${last.params.selector}` : ''})`,
	};
}

/**
 * One line describing where a failure window came from, for the evidence
 * sections that print it. Empty for an errored call, which needs no caveat.
 */
export function describeWindowSource(win) {
	if (!win?.inferredFrom) { return ''; }
	return `The test failed on its own assertion (toPass / expect.poll / a plain expect), not on a Playwright call, so this window is INFERRED from the ${win.inferredFrom}. Any earlier errored calls were retries the test caught.`;
}

/**
 * Classify a trace timestamp against the failure window. The `after deadline`
 * bucket is the one that matters most: an event there CANNOT have caused the
 * failure, and is very often the test's own `finally`/teardown (a sign-out, a
 * settings reset) whose side effects look like a root cause if read naively.
 *
 * When the window has no known start (inferred from the failure screenshot
 * alone), anything up to the deadline is `before deadline`: calling it `during
 * wait` would claim it happened while the failing action waited, which nothing
 * established.
 * @returns {'before action' | 'during wait' | 'before deadline' | 'after deadline' | null}
 */
export function phaseLabel(t, window) {
	if (t == null || !window?.deadlineT) { return null; }
	if (t > window.deadlineT) { return 'after deadline'; }
	if (window.actionStartT == null) { return 'before deadline'; }
	if (t < window.actionStartT) { return 'before action'; }
	return 'during wait';
}

/** Wall-clock epoch (ms) of trace t=0. A screencast frame carries both its
 *  epoch ms (trailing its file name) and its trace offset, so the two give
 *  the origin directly. Without this, t= values can only be back-derived from
 *  the mined failure window's deadline, which is a heuristic and not a clock. */
export function traceEpochOrigin(evts) {
	for (const e of evts) {
		if (e.type !== 'screencast-frame' || e.timestamp == null) { continue; }
		const m = /-(?<epochMs>\d{13})\.jpe?g$/.exec(String(e.file || e.sha1 || ''));
		if (m) { return Number(m.groups.epochMs) - e.timestamp; }
	}
	return null;
}

// ---------------------------------------------------------------------------
// Screencast frames
// ---------------------------------------------------------------------------

/**
 * Path of a screencast frame's image inside the trace zip. Trace format v9
 * (Playwright 1.63) names it in `file` ("screencast/page@<id>-<epoch>.jpeg");
 * older traces put a bare `sha1` file name under `resources/`. Reading only
 * `sha1` on a v9 trace yields undefined for every frame, which silently
 * extracts no screenshots at all.
 */
export function screencastFrameEntry(frame) {
	if (frame?.file) { return frame.file; }
	if (frame?.sha1) { return `resources/${frame.sha1}`; }
	return null;
}

/**
 * The last `n` screencast frames at or before the failure screenshot, oldest
 * first, so the final one shows the page when the test threw. Taking the
 * trace's last frames instead shows whatever afterEach hooks and fixture
 * teardown did to the page afterwards (a layout reset, a closed session), which
 * reads as the failure state but is not.
 *
 * Cut only at the failure screenshot, never at an errored call: without the
 * screenshot the first errored call is often a retry the test caught, long
 * before it failed or finished. In that case (and when no frame precedes the
 * screenshot) this keeps the trace's last frames.
 */
export function pickFailureFrames(events, n) {
	if (n === 0) { return []; }
	const frames = events.filter(e => e.type === 'screencast-frame');
	const failT = findFailureShot(events)?.startTime;
	const upToFailure = failT == null ? [] : frames.filter(f => f.timestamp != null && f.timestamp <= failT);
	return (upToFailure.length ? upToFailure : frames).slice(-n);
}

// ---------------------------------------------------------------------------
// DOM presence
// ---------------------------------------------------------------------------

/** Pull the class/id attribute values out of a serialized snapshot. Playwright
 *  serializes elements as ["TAG", {"class": "a b"}, ...children], so matching
 *  attributes rather than the raw JSON keeps stylesheet text, script bodies and
 *  unrelated attributes out of the result -- without this a `codicon-*` token
 *  matches its own rule in the inlined codicon.css and reports as "present". */
export function snapshotAttrTokens(json) {
	const found = new Set();
	for (const m of json.matchAll(/"(?:class|id)":"((?:[^"\\]|\\.)*)"/g)) {
		for (const t of m[1].split(/\s+/)) { if (t) { found.add(t); } }
	}
	return found;
}

/**
 * Report whether each failing-selector token was in the DOM across the trace's
 * frame snapshots, and in particular during the failing action's wait. Matches
 * class/id attributes only, and reports the wait window separately because the
 * snapshot span starts at app launch: a token seen only before the action began
 * was not on screen when it ran.
 *
 * The wait start comes from findFailureWindow, so this anchors on the same
 * action the timeline's `phaseLabel` buckets do -- the two disagreeing would
 * put "during wait" in one section and "before action" in the other. Callers
 * that already hold the window pass it in rather than recomputing it.
 */
export function buildDomPresence(evts, tokens, win = findFailureWindow(evts)) {
	if (!tokens.length) { return null; }
	const snaps = evts
		.filter(e => e.type === 'frame-snapshot' && e.snapshot?.timestamp != null)
		.map(s => ({ ts: s.snapshot.timestamp, attrs: snapshotAttrTokens(JSON.stringify(s)) }));
	if (!snaps.length) { return null; }
	const waitStart = win?.actionStartT ?? null;
	const span = `t=${Math.round(snaps[0].ts)}..${Math.round(snaps[snaps.length - 1].ts)}`;
	const out = [`\n=== DOM presence across ${snaps.length} frame snapshots (${span}) ===`];
	out.push("Whether each failing-selector token appeared in a snapshot's class/id ATTRIBUTES (stylesheet and script text are excluded, so a token cannot match its own CSS rule). When a wait window is known, that window is the decisive one: the snapshot span starts at app launch and covers fixture setup, so a token seen only in earlier snapshots was NOT on screen when the failing action ran. 'NEVER present at all' stays AMBIGUOUS on its own -- it fits both a never-rendered element (product open-path bug, strongest when the console digest shows its command fired) and locator drift (rendered under different markup). Disambiguate with the error-context snapshot's stable text/label, not this line alone.");
	for (const tok of tokens) {
		const hits = snaps.filter(s => s.attrs.has(tok));
		if (!hits.length) {
			out.push(`- '${tok}': NEVER present in any snapshot`);
			continue;
		}
		const range = `t=${Math.round(hits[0].ts)}..${Math.round(hits[hits.length - 1].ts)}`;
		if (waitStart == null) {
			out.push(`- '${tok}': present in ${hits.length}/${snaps.length} snapshots (${range}); no wait window found, so this cannot say whether it was present when the action ran`);
			continue;
		}
		const during = hits.filter(h => h.ts >= waitStart);
		out.push(during.length
			? `- '${tok}': present in ${hits.length}/${snaps.length} snapshots (${range}), ${during.length} of them during the wait (from t=${Math.round(waitStart)}) => it WAS in the DOM while the action waited; a visibility/timeout error is then a timing or dismiss race`
			: `- '${tok}': present in ${hits.length}/${snaps.length} snapshots (${range}) but NEVER during the wait (from t=${Math.round(waitStart)}) => it was gone, or had not yet rendered, when the action ran -- treat this as absent, not as "rendered then vanished mid-wait"`);
	}
	return out.join('\n');
}

/** Pull stable class/id tokens out of selector strings (the parts that identify
 *  an element in the serialized DOM, unlike text/regex matchers). */
export function selectorTokens(selectors) {
	const tokens = new Set();
	for (const sel of selectors) {
		for (const m of String(sel).matchAll(/\.(?<token>[A-Za-z_][\w-]{2,})/g)) { tokens.add(m.groups.token); }
		for (const m of String(sel).matchAll(/\[id=["'](?<token>[^"']+)["']\]/g)) { tokens.add(m.groups.token); }
	}
	return [...tokens];
}

// ---------------------------------------------------------------------------
// Console digest
// ---------------------------------------------------------------------------

/** Strip the `%c`/`color:#...` console-formatting noise VS Code prepends. */
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
 * phase transitions (timing races), and errors/warnings. Distinguishes "click
 * was swallowed" from "command ran but nothing rendered." Consecutive
 * duplicates (a retried command logs the same line N times) are collapsed with
 * an (xN) count. Callers that already hold the window pass it in.
 */
export function buildConsoleDigest(evts, win = findFailureWindow(evts)) {
	const ALLOW = /(CommandService#executeCommand|Runtime startup][^\n]*Phase changed|Discovery completed|Uncaught|Unhandled)/i;
	const MAX_LINES = 28;
	// Look back far enough to catch a command that fired and then left the test
	// waiting on UI that never came: the classic "click did nothing" timeout has
	// the triggering command ~15-30s before the failing assertion, so a tight
	// window would drop the very command-fired signal this digest exists to
	// surface. 30s covers Playwright's max default timeout; the tight allowlist,
	// dedup, and priority cap below keep the wider window from getting noisy.
	const LOOKBACK_MS = 30000;
	const consoles = evts.filter(e => e.type === 'console' && typeof e.text === 'string');
	if (!consoles.length) { return null; }
	// Focus on the failing wait and the LOOKBACK_MS before it began, so a long
	// wait (a 60s expect) still shows the command that started it. Spanning every
	// errored call instead reaches back to retries a toPass caught long before the
	// failure, and focusing on nothing (no window) lets the cap keep the earliest
	// lines -- app startup.
	const focusStart = win?.deadlineT != null ? (win.actionStartT ?? win.deadlineT) - LOOKBACK_MS : -Infinity;
	// Trail the deadline by 2s so the test's own teardown stays visible. It is
	// routinely misread as a cause, so showing it LABELLED beats hiding it.
	const focusEnd = win?.deadlineT != null ? win.deadlineT + 2000 : Infinity;
	const picked = consoles.filter(e =>
		(e.time == null || (e.time >= focusStart && e.time <= focusEnd)) &&
		(e.messageType === 'error' || e.messageType === 'warning' || ALLOW.test(e.text)) &&
		!CONSOLE_NOISE_RE.test(e.text));
	if (!picked.length) { return null; }

	const entries = [];
	for (const e of picked) {
		const text = cleanConsole(e.text).slice(0, 200);
		const last = entries[entries.length - 1];
		if (last && last.text === text) { last.count++; continue; }
		// Command/phase/error lines are the load-bearing signal; warnings are
		// context. Track priority so the cap can never drop a command-fired or
		// phase line in favor of a warning.
		const high = ALLOW.test(e.text) || e.messageType === 'error';
		entries.push({ time: e.time, level: e.messageType || 'log', text, count: 1, high, phase: phaseLabel(e.time, win) });
	}

	// Rank before capping so a post-deadline teardown line can never displace a
	// line from inside the wait: only the wait can contain a cause.
	const rank = e => (e.phase === 'after deadline' ? 0 : 2) + (e.high ? 1 : 0);
	const shown = entries.length <= MAX_LINES
		? entries
		: [...entries].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_LINES).sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
	const out = [`\n=== Console digest near failure (${shown.length}${entries.length > shown.length ? ` of ${entries.length}` : ''} high-signal lines) ===`];
	if (win?.deadlineT != null) {
		out.push(`Failing action: ${win.method || 'unknown'}; waited t=${win.actionStartT != null ? Math.round(win.actionStartT) : '?'}..${Math.round(win.deadlineT)}.`);
		const windowSource = describeWindowSource(win);
		if (windowSource) { out.push(windowSource); }
		out.push("Lines are tagged by position relative to that wait. [after deadline] means the line was emitted AFTER the assertion had already failed, so it CANNOT be the cause -- these are usually the test's own finally/teardown (a sign-out, a settings reset), whose side effects are routinely misread as root causes. [before deadline] means when the wait began is unknown, so the line may predate the failing action.");
	}
	for (const e of shown) {
		out.push(`t=${Math.round(e.time ?? 0)}${e.phase ? ` [${e.phase}]` : ''} [${e.level}] ${e.text}${e.count > 1 ? ` (x${e.count})` : ''}`);
	}
	return out.join('\n');
}

// ---------------------------------------------------------------------------
// Log timestamp parsing
// ---------------------------------------------------------------------------

// Positron's log files use a few timestamp shapes, all UTC:
//   2026-07-31 18:15:23.859 [debug] ...          (renderer/exthost/main/extension logs)
//   [2026-07-31T18:15:23.859Z] ...               (e2e-test-runner.log)
//   r-bc52e7b9 [R]   2026-07-31T18:11:05.719097Z (kernel logs, microsecond precision)
// Matching `YYYY-MM-DD`, a `T` or space, then `HH:MM:SS.frac` covers all three.
// Anchored to the first 120 chars so a date inside a message body cannot be
// mistaken for the line's own timestamp.
const LOG_TS_RE = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}\.\d+)/;

/**
 * Parse a log line's leading timestamp to epoch ms, or null when the line has
 * none (stack-trace continuations, bare output). Treated as UTC: Positron
 * writes `2026-07-31 18:15:23.859` and `[2026-07-31T18:15:23.859Z]` for the
 * same instant, so the space-separated form carries no local offset.
 */
export function parseLogTimestamp(line) {
	const m = LOG_TS_RE.exec(line.slice(0, 120));
	if (!m) { return null; }
	const ms = Date.parse(`${m[1]}T${m[2]}Z`);
	return Number.isNaN(ms) ? null : ms;
}

// ---------------------------------------------------------------------------
// Relevance
// ---------------------------------------------------------------------------

/**
 * Logs that are worth reading for essentially any failure, so they stay in the
 * excerpt even when nothing about the spec path points at them.
 */
const ALWAYS_RELEVANT = ['e2e-test-runner.log', 'renderer.log', 'main.log'];

/** Normalize for fuzzy path matching: `posit-assistant` ~ `posit.assistant`. */
function squash(s) {
	return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Derive relevance hints from the failing spec's path so the excerpt budget
 * goes to the logs owned by the feature under test. `tests/posit-assistant/
 * posit-assistant-signin.test.ts` yields `positassistant`, which matches
 * `window1/exthost/posit.assistant/Posit Assistant.log` after squashing.
 */
export function relevanceHintsForSpec(specPath) {
	if (!specPath) { return []; }
	const hints = new Set();
	for (const seg of String(specPath).split(/[/\\]/)) {
		const bare = seg.replace(/\.(test|spec)\.[tj]sx?$/, '');
		if (!bare || bare === 'tests' || bare === 'test' || bare === 'e2e') { continue; }
		const sq = squash(bare);
		if (sq.length >= 4) { hints.add(sq); }
	}
	return [...hints];
}

/**
 * Rank a log's relevance to the failure: 2 = owned by the feature under test
 * (matched a spec-derived hint), 1 = core log worth reading for any failure,
 * 0 = bystander. The feature's own log outranks the core logs so it leads the
 * excerpt rather than being buried under renderer/main chatter.
 */
export function logRelevance(relPath, hints) {
	const sq = squash(relPath);
	if ((hints || []).some(h => sq.includes(h))) { return 2; }
	const base = relPath.split(/[/\\]/).pop() || '';
	return ALWAYS_RELEVANT.includes(base) ? 1 : 0;
}

/** True when this log file belongs to the feature under test (or is core). */
export function isRelevantLog(relPath, hints) {
	return logRelevance(relPath, hints) > 0;
}

// ---------------------------------------------------------------------------
// Log mining
// ---------------------------------------------------------------------------

// Kept for the fallback path (no usable failure window, or logs with no
// parseable timestamps): the original severity grep, so we never end up with
// nothing.
const LOG_ERROR_RE = /(no such file|file not found|cannot find|traceback|ioerror|[a-z]+error:|exception:|fatal|panic|unhandled|connection refused|permission denied|access denied|expired|failed to \w+)/i;
const LOG_NOISE_RE = /(ignoring a path for watching|\.vscode[/\\](settings|mcp|tasks|launch)\.json|[/\\](policy|mcp)\.json)/i;

// Very high-volume trace channels that would swamp the window with per-frame
// chatter. Only their warnings/errors are kept. These are the channels observed
// to consume an entire window budget on a healthy run: file-action tracing, RPC
// and pty tracing, secret-store probes (four lines per key lookup), Python
// interpreter-discovery chatter, and the resource-scoped-config warning the
// Python extension emits on every read.
const VERBOSE_NOISE_RE = /(File action: readFile|\[trace\] (?:\[RPC (?:Request|Response)\]|node-pty)|ProxyResolver#|PolicyConfiguration#|_setContext|LEAKED DISPOSABLE|mainThreadSecretState|\[secrets\]|shouldIncludeInterpreter|ExtHostCommands#executeCommand setContext|EncryptionMainService)/i;

// Noise at ANY level, including warning/error. These are emitted on every
// healthy run and are pure volume: the Python extension warns on each
// resource-scoped config read, and the file watcher traces every path it probes.
// Keeping them "because they're warnings" is what let a healthy-run channel eat
// the whole excerpt budget before the feature's own log was reached.
const ALWAYS_NOISE_RE = /(Accessing a resource scoped configuration|\[File Watcher|ignoring a path for watching)/i;

// e2e-test-runner.log echoes every renderer console line via
// `window.on('console')`. Those are duplicates of renderer.log by construction,
// so drop the echoes (the runner's own lines still come through).
const RUNNER_ECHO_RE = /(Playwright \([^)]*\): window\.on\('console'\)|\[electron\] std(out|err): \[main )/;

// The per-language "<Language> Supervisor" channel (R Supervisor.log, Python
// Supervisor.log) logs every message the frontend sends to a kernel and every
// runtime state change, each prefixed with the session id:
//   2026-09-23 15:19:53.003 [debug] r-fa94cab0 >>> SEND comm_msg [shell]: {"comm_id":...}
//   2026-09-23 15:19:53.077 [debug] r-fa94cab0 State: idle => busy (execute_request)
const KERNEL_SEND_RE = /\s(?<session>\S+) >>> SEND (?<type>\w+) \[(?<channel>\w+)\]: (?<payload>.*)$/;
const KERNEL_STATE_RE = /\s(?<session>\S+) State: (?<from>\w+) => (?<to>\w+)(?: \((?<reason>[^)]*)\))?/;
const KERNEL_DIGEST_MAX_LINES = 40;

/**
 * Read a string field out of a SEND payload. When the payload parsed, only the
 * exact path counts: a regex over the whole payload would pick up a nested field
 * of the same name (`params.method` for a message with no top-level `method`).
 * The regex is for a payload the log cut short, and takes the first occurrence,
 * which in the supervisor's field order is the outer one.
 */
function payloadField(payload, parsed, path, name) {
	if (parsed) {
		const value = path.reduce((o, k) => o?.[k], parsed);
		return typeof value === 'string' ? value : null;
	}
	const m = new RegExp(`"${name}":"(?<raw>(?:[^"\\\\]|\\\\.)*)`).exec(payload);
	if (!m) { return null; }
	// Decode JSON escapes (\\, \t, \uXXXX, ...). A value cut mid-escape will not
	// decode; drop the dangling escape and retry rather than lose the value.
	for (const raw of [m.groups.raw, m.groups.raw.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, '')]) {
		try { return JSON.parse(`"${raw}"`); } catch { /* try the trimmed form */ }
	}
	return m.groups.raw;
}

/**
 * Summarize one supervisor-log line as a kernel event, or null when the line is
 * not a SEND or a state change worth showing. Keeps what tells requests apart --
 * the code an execute_request runs, the comm and RPC method a comm_msg calls --
 * and drops the rest of the payload.
 *
 * Two kinds of line are dropped as noise: the idle/busy flip that brackets
 * every comm and info request (the SEND line already says the request
 * happened), and `comm_info_request`, which the frontend sends repeatedly to
 * list comms. A busy/idle flip for an execute_request, and any transition
 * outside idle/busy (starting, ready, exited, ...), are kept.
 * @returns {{session: string, text: string} | null}
 */
export function summarizeKernelLine(line) {
	const state = KERNEL_STATE_RE.exec(line);
	if (state) {
		const { session, from, to, reason } = state.groups;
		const idleBusyFlip = [from, to].every(s => s === 'idle' || s === 'busy');
		if (idleBusyFlip && reason !== 'execute_request') { return null; }
		return { session, text: `State ${from} => ${to}${reason ? ` (${reason})` : ''}` };
	}
	const send = KERNEL_SEND_RE.exec(line);
	if (!send) { return null; }
	const { session, type, payload } = send.groups;
	if (type === 'comm_info_request') { return null; }
	let parsed = null;
	try { parsed = JSON.parse(payload); } catch { /* cut short in the log; fall back to regex */ }
	let detail = '';
	if (type === 'execute_request') {
		const code = payloadField(payload, parsed, ['code'], 'code') ?? '';
		const oneLine = code.replace(/\s*\n\s*/g, '; ');
		detail = ` code=${JSON.stringify(oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine)}`;
	} else if (type === 'comm_msg') {
		const commId = payloadField(payload, parsed, ['comm_id'], 'comm_id');
		const method = payloadField(payload, parsed, ['data', 'method'], 'method');
		// UI-comm RPCs wrap the real method: {"method":"call_method","params":{"method":"setConsoleWidth"}}
		const inner = method === 'call_method' ? parsed?.data?.params?.method : null;
		detail = `${commId ? ` ${commId}` : ''}${method ? ` method=${method}${typeof inner === 'string' ? `(${inner})` : ''}` : ''}`;
	} else if (type === 'comm_open') {
		const target = payloadField(payload, parsed, ['target_name'], 'target_name');
		detail = target ? ` target=${target}` : '';
	}
	return { session, text: `SEND ${type}${detail}` };
}

function stripAnsi(s) {
	// eslint-disable-next-line no-control-regex -- stripping terminal color codes
	return String(s).replace(/\[[0-9;]*m/g, '');
}

/** Recursively collect `*.log` paths under a directory. */
function collectLogFiles(root) {
	const out = [];
	const stack = [root];
	while (stack.length) {
		const d = stack.pop();
		let entries;
		try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
		for (const ent of entries) {
			const p = join(d, ent.name);
			if (ent.isDirectory()) { stack.push(p); }
			else if (ent.name.endsWith('.log')) { out.push(p); }
		}
	}
	return out;
}

const ISO = (ms) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');

/**
 * Key for collapsing consecutive near-identical log lines: drop the leading
 * timestamp and the final whitespace-delimited token, so a run that differs only
 * in a trailing identifier ("Clearing model cache for bedrock" / "... for
 * openai") folds into one entry.
 */
function nearDuplicateKey(line) {
	const body = line.replace(LOG_TS_RE, '').replace(/^[[\]\s\d:.TZ-]+/, '');
	return body.replace(/\s+\S+$/, '').slice(0, 160);
}

/**
 * Render the kernel events inside the failure window, in time order, each
 * tagged against the wait the same way the console digest is.
 *
 * This is the evidence for the question a test step cannot answer: did request
 * A reach the kernel before request B? A test that presses Enter on some code
 * and then clicks a button has only dispatched both; the execute_request and the
 * button's comm RPC travel separately and can arrive in either order. The shell
 * channel serves requests in ARRIVAL order, so the send order here is what
 * decides whether B queued behind A.
 *
 * Over budget, it drops post-deadline lines first, then the earliest lines
 * before the action, so the wait and the lead-up to it survive. When the wait's
 * start is unknown nothing is "before action", so it keeps the latest lines,
 * nearest the failure, rather than the earliest.
 * @param {{at: number, session: string, text: string}[]} events
 * @returns {string|null}
 */
export function renderKernelDigest(events, actionStartMs, deadlineMs) {
	if (!events.length) { return null; }
	const win = { actionStartT: actionStartMs, deadlineT: deadlineMs };
	const entries = [];
	for (const e of [...events].sort((a, b) => a.at - b.at)) {
		const prev = entries[entries.length - 1];
		const phase = phaseLabel(e.at, win);
		if (prev && prev.session === e.session && prev.text === e.text && prev.phase === phase) { prev.count++; continue; }
		entries.push({ ...e, count: 1, phase });
	}
	let head = 0;
	let tail = entries.length;
	while (tail - head > KERNEL_DIGEST_MAX_LINES && entries[tail - 1].phase === 'after deadline') { tail--; }
	while (tail - head > KERNEL_DIGEST_MAX_LINES && entries[head].phase === 'before action') { head++; }
	if (actionStartMs == null) {
		head = Math.max(head, tail - KERNEL_DIGEST_MAX_LINES);
	} else {
		tail = Math.min(tail, head + KERNEL_DIGEST_MAX_LINES);
	}

	const out = [
		'Kernel messages inside the window (from the "<Language> Supervisor" logs: every request the frontend SENT to a kernel, in send order, plus its execute busy/idle and lifecycle state changes). A kernel\'s shell channel serves requests in the order they ARRIVE, so this -- not the order of the test\'s steps -- settles whether one request reached the kernel before another:',
	];
	if (head > 0) { out.push(`... (${head} earlier kernel events omitted)`); }
	for (const e of entries.slice(head, tail)) {
		out.push(`${ISO(e.at).slice(11)} [${e.phase}] ${e.session} ${e.text}${e.count > 1 ? ` (x${e.count})` : ''}`);
	}
	if (tail < entries.length) { out.push(`... (${entries.length - tail} later kernel events omitted)`); }
	return out.join('\n');
}

/**
 * Mine an attached log bundle for what happened inside the failure window.
 *
 * Two things this reports that a severity grep structurally cannot:
 *  - **info/debug lines in the window.** The line that settles a diagnosis is
 *    often a success (`Fetched 11 models from API`), not an error. Filtering on
 *    error keywords hides exactly the evidence that refutes an "external
 *    dependency broke" theory.
 *  - **silence.** A log that stops emitting the moment the UI should have
 *    appeared, and stays quiet for the whole wait, is a strong positive signal.
 *    Absence of lines cannot be grepped for; it has to be derived.
 *
 * @param {string} logsZipPath  attached logs-*.zip
 * @param {object} opts
 * @param {string} opts.tmpDir            scratch dir for the unzip
 * @param {{actionStartT,deadlineT}|null} opts.window  from findFailureWindow()
 * @param {{wallTime,monotonicTime}|null} opts.clock   from extractTraceClock()
 * @param {string[]} [opts.hints]         from relevanceHintsForSpec()
 * @returns {string|null}
 */
export function mineLogs(logsZipPath, opts = {}) {
	const { tmpDir, window: win, clock, hints = [] } = opts;
	const dir = join(tmpDir, `logsx-${randomBytes(4).toString('hex')}`);
	try {
		mkdirSync(dir, { recursive: true });
		execFileSync('unzip', ['-o', logsZipPath, '-d', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
	} catch {
		return null;
	}

	const logFiles = collectLogFiles(dir);
	if (!logFiles.length) { return null; }

	const deadlineMs = traceTimeToWallMs(win?.deadlineT, clock);
	const actionStartMs = traceTimeToWallMs(win?.actionStartT, clock);
	// Reach 5s behind the action so the setup that preceded the wait is visible,
	// and 2s past the deadline so teardown is present but clearly labelled.
	const windowStart = actionStartMs != null ? actionStartMs - 5000
		: (deadlineMs != null ? deadlineMs - 35000 : null);
	const windowEnd = deadlineMs != null ? deadlineMs + 2000 : null;

	// No usable window => legacy severity grep.
	if (windowStart == null || windowEnd == null) {
		return legacyGrep(logFiles, dir, clock ? 'no failing action could be located in the trace' : 'no trace clock available');
	}

	const MAX_LINES = 80;
	const MAX_CHARS = 9000;
	const LINE_CHARS = 200;
	const PER_FILE_RELEVANT = 30;
	const PER_FILE_OTHER = 8;
	// Reserve most of the budget for logs owned by the feature under test, so a
	// chatty bystander cannot crowd them out of the excerpt entirely.
	const RELEVANT_SHARE = Math.ceil(MAX_LINES * 0.7);

	const perFile = [];   // { rel, relevant, lines[] } -- merged round-robin below
	const silence = [];
	const kernelEvents = [];   // { at, session, text } from the supervisor logs
	let sawAnyTimestamp = false;
	// The runner log's own "Test start" marker. It is the only wall-clock anchor
	// for where the test itself begins: the trace's t= origin sits earlier (app
	// launch and fixture setup), so anything derived from the window deadline
	// instead lands minutes off.
	let testStartMs = null;

	for (const f of logFiles) {
		const rel = f.slice(dir.length + 1).replace(/\\/g, '/');
		let content;
		try { content = readFileSync(f, 'utf8'); } catch { continue; }
		const rank = logRelevance(rel, hints);
		const relevant = rank > 0;
		const perFileCap = relevant ? PER_FILE_RELEVANT : PER_FILE_OTHER;
		const isRunnerLog = rel.endsWith('e2e-test-runner.log');
		const isSupervisorLog = / Supervisor\.log$/.test(rel);

		// Track the last entry AT OR BEFORE the deadline, not the last entry
		// overall: a log whose only late activity is the test's post-deadline
		// teardown was still silent for the whole wait, which is the signal we
		// want. Measuring "last entry overall" hides exactly that case.
		let lastTsInWait = null;
		let carried = null;     // running timestamp for untimestamped lines
		const lines = [];

		for (const raw of content.split('\n')) {
			const line = stripAnsi(raw).trim();
			if (!line) { continue; }
			const ts = parseLogTimestamp(line);
			if (ts != null) {
				carried = ts;
				sawAnyTimestamp = true;
				if (deadlineMs == null || ts <= deadlineMs) { lastTsInWait = ts; }
				if (isRunnerLog && testStartMs == null && / Test start: /.test(line)) { testStartMs = ts; }
			}
			const at = ts ?? carried;
			if (at == null || at < windowStart || at > windowEnd) { continue; }
			// Kernel events have their own section and budget, ahead of the
			// per-file cap: a busy kernel fills that cap within a second.
			if (isSupervisorLog && ts != null) {
				const ev = summarizeKernelLine(line);
				if (ev) { kernelEvents.push({ at, ...ev }); }
			}
			if (lines.length >= perFileCap) { continue; }
			if (ALWAYS_NOISE_RE.test(line)) { continue; }
			// Keep verbose channels only when they carry a warning/error.
			if (VERBOSE_NOISE_RE.test(line) && !/\[(error|warning)\]/i.test(line)) { continue; }
			if (isRunnerLog && RUNNER_ECHO_RE.test(line)) { continue; }
			// Collapse consecutive near-duplicates (e.g. 13 successive
			// "Clearing model cache for <provider>" lines) into one (xN) entry.
			// Left uncollapsed they burn a relevant log's whole share and push the
			// lines nearest the failure out of the excerpt.
			const key = nearDuplicateKey(line);
			const prev = lines[lines.length - 1];
			if (prev && prev.key === key) {
				prev.count++;
				prev.at = at;
				continue;
			}
			lines.push({ at, key, count: 1, text: `[${rel}] ${line.slice(0, LINE_CHARS)}` });
		}

		if (lines.length) { perFile.push({ rel, relevant, rank, lines }); }

		// Silence signal: the log emitted something INSIDE the window (proving it
		// was live while the test ran) and then stopped well before the deadline.
		// Requiring activity inside the window is what keeps out bystanders that
		// have been idle since startup -- they were never part of this story, and
		// they otherwise dominate the section by sheer idle time.
		if (lastTsInWait != null && deadlineMs != null && lastTsInWait >= windowStart) {
			const quietFor = deadlineMs - lastTsInWait;
			if (quietFor > 3000) {
				silence.push({
					quietFor,
					rank,
					text: `- ${rel}: last entry ${ISO(lastTsInWait)}, ${(quietFor / 1000).toFixed(1)}s before the deadline (silent for the rest of the wait)`,
				});
			}
		}
	}

	if (!sawAnyTimestamp) { return legacyGrep(logFiles, dir, 'no parseable timestamps in the logs'); }

	// Merge round-robin within each tier so a single high-volume log cannot
	// consume the budget, and give the feature-relevant tier a reserved share so
	// a chatty bystander cannot starve it. Display order is chronological.
	// Budget is enforced HERE, during selection -- not while printing. Printing is
	// chronological, so a print-time cap would chop the tail: exactly the lines
	// nearest the failure, which are the ones that matter most.
	let charBudget = MAX_CHARS;
	const roundRobin = (files, limit) => {
		const picked = [];
		for (let round = 0; picked.length < limit; round++) {
			let added = false;
			for (const pf of files) {
				if (round >= pf.lines.length) { continue; }
				const l = pf.lines[round];
				if (charBudget - l.text.length < 0) { continue; }
				charBudget -= l.text.length;
				picked.push(l);
				added = true;
				if (picked.length >= limit) { break; }
			}
			if (!added) { break; }
		}
		return picked;
	};
	const relevantFiles = perFile.filter(p => p.relevant).sort((a, b) => b.rank - a.rank);
	const otherFiles = perFile.filter(p => !p.relevant);
	const totalInWindow = perFile.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.count, 0), 0);
	const fromRelevant = roundRobin(relevantFiles, RELEVANT_SHARE);
	const fromOther = roundRobin(otherFiles, MAX_LINES - fromRelevant.length);
	const capped = [...fromRelevant, ...fromOther].sort((a, b) => a.at - b.at);
	// Relevant logs first, then longest-quiet, so the feature's own log leads.
	silence.sort((a, b) => b.rank - a.rank || b.quietFor - a.quietFor);

	const out = [];
	out.push(`Failure window: ${ISO(windowStart)} .. ${ISO(windowEnd)} (deadline ${deadlineMs != null ? ISO(deadlineMs) : 'unknown'})`);
	const windowSource = describeWindowSource(win);
	if (windowSource) { out.push(windowSource); }
	if (testStartMs != null) {
		out.push(`Test start: ${ISO(testStartMs)} (from e2e-test-runner.log) -- anchor trace t= values on this and the timeline's "Trace t=0" line, never on the deadline above, which is a mined heuristic rather than a clock.`);
	}
	out.push('All severities are included inside the window -- an info-level success line often refutes an "external dependency broke" theory, so do not assume the absence of errors means the absence of evidence.');

	if (silence.length) {
		out.push('');
		out.push('Went quiet before the deadline (a log that stops exactly when the UI should have appeared is positive evidence, not missing data):');
		for (const s of silence.slice(0, 8)) { out.push(s.text); }
	}

	const kernelDigest = renderKernelDigest(kernelEvents, actionStartMs, deadlineMs);
	if (kernelDigest) {
		out.push('');
		out.push(kernelDigest);
	}

	if (capped.length) {
		out.push('');
		out.push('Lines inside the window (sampled across logs, feature-relevant logs first):');
		for (const l of capped) {
			out.push(l.count > 1 ? `${l.text} (x${l.count})` : l.text);
		}
		const shownRaw = capped.reduce((n, l) => n + l.count, 0);
		if (totalInWindow > shownRaw) {
			out.push(`... (${totalInWindow - shownRaw} more lines in window omitted)`);
		}
	} else {
		out.push('');
		out.push('No log lines at all inside the window -- every attached log was silent while the test waited.');
	}

	return out.join('\n');
}

/**
 * Original behaviour: first N error-matching lines per file, unordered.
 * `reason` names why no window was usable, so the excerpt does not blame a
 * missing trace clock when the clock was fine and the failing action was not.
 */
function legacyGrep(logFiles, dir, reason) {
	const PER_FILE = 20;
	const MAX_LINES = 60;
	const MAX_CHARS = 5000;
	const collected = [];
	const seen = new Set();
	for (const f of logFiles) {
		const rel = f.slice(dir.length + 1).replace(/\\/g, '/');
		let content;
		try { content = readFileSync(f, 'utf8'); } catch { continue; }
		let perFile = 0;
		for (const raw of content.split('\n')) {
			const line = stripAnsi(raw).trim();
			if (!LOG_ERROR_RE.test(line) || LOG_NOISE_RE.test(line)) { continue; }
			const dedupeKey = line.replace(/^[\d\-T:.Z\s]+/, '').slice(0, 200);
			if (seen.has(dedupeKey)) { continue; }
			seen.add(dedupeKey);
			collected.push(`[${rel}] ${line.slice(0, 300)}`);
			if (++perFile >= PER_FILE) { break; }
			if (collected.length >= MAX_LINES) { break; }
		}
		if (collected.length >= MAX_LINES) { break; }
	}
	if (!collected.length) { return null; }
	let text = collected.join('\n');
	if (text.length > MAX_CHARS) { text = `${text.slice(0, MAX_CHARS)}\n... (truncated)`; }
	return `(${reason} -- falling back to an error-line grep, which cannot show info-level evidence, sequence, or silence)\n${text}`;
}
