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
// so the windowing logic has a single home. NOTE: the older analysis helpers
// (collectFailingSelectors / selectorTokens / buildDomPresence / cleanConsole /
// buildConsoleDigest / parseTrace) predate this module and are still copy-pasted
// into all three of those files; new shared logic belongs here instead.
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

/**
 * Locate the failing action: the first errored `after` event and the `before`
 * that opened it. `actionStartT` is when the test STARTED waiting and
 * `deadlineT` is when it gave up -- the interval between them is the only
 * period in which a cause can live. Anything after `deadlineT` is teardown or
 * post-failure noise, not a cause.
 * @returns {{actionStartT: number|null, deadlineT: number|null, method: string|null} | null}
 */
export function findFailureWindow(events) {
	for (let i = 0; i < events.length; i++) {
		const e = events[i];
		if (e.type !== 'after' || !e.error) { continue; }
		let before = null;
		for (let j = i - 1; j >= 0; j--) {
			if (events[j].type === 'before') { before = events[j]; break; }
		}
		const deadlineT = e.endTime ?? e.startTime ?? null;
		if (deadlineT == null) { continue; }
		return {
			actionStartT: before?.startTime ?? null,
			deadlineT,
			method: before ? `${before.class || '?'}.${before.method || '?'}` : null,
		};
	}
	return null;
}

/**
 * Classify a trace timestamp against the failure window. The `after deadline`
 * bucket is the one that matters most: an event there CANNOT have caused the
 * failure, and is very often the test's own `finally`/teardown (a sign-out, a
 * settings reset) whose side effects look like a root cause if read naively.
 * @returns {'before action' | 'during wait' | 'after deadline' | null}
 */
export function phaseLabel(t, window) {
	if (t == null || !window?.deadlineT) { return null; }
	if (t > window.deadlineT) { return 'after deadline'; }
	if (window.actionStartT != null && t < window.actionStartT) { return 'before action'; }
	return 'during wait';
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

// Kept for the fallback path (no trace clock, or logs with no parseable
// timestamps): the original severity grep, so we never end up with nothing.
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
		return legacyGrep(logFiles, dir);
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

	if (!sawAnyTimestamp) { return legacyGrep(logFiles, dir); }

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
	if (testStartMs != null) {
		out.push(`Test start: ${ISO(testStartMs)} (from e2e-test-runner.log) -- anchor trace t= values on this and the timeline's "Trace t=0" line, never on the deadline above, which is a mined heuristic rather than a clock.`);
	}
	out.push('All severities are included inside the window -- an info-level success line often refutes an "external dependency broke" theory, so do not assume the absence of errors means the absence of evidence.');

	if (silence.length) {
		out.push('');
		out.push('Went quiet before the deadline (a log that stops exactly when the UI should have appeared is positive evidence, not missing data):');
		for (const s of silence.slice(0, 8)) { out.push(s.text); }
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

/** Original behaviour: first N error-matching lines per file, unordered. */
function legacyGrep(logFiles, dir) {
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
	return `(no trace clock available -- falling back to an error-line grep, which cannot show info-level evidence or silence)\n${text}`;
}
