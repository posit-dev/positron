/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';

/**
 * Opt-in timing markers for the console-execution latency investigation.
 *
 * Events buffer in memory and flush on an interval, so a measured interval never
 * pays for a synchronous file write.
 *
 * See `test/e2e/utils/perf-trace/schema.ts` for the event shape. Correlation
 * needs no new wire field: `ExecuteRequest` reuses Positron's execution id as
 * the Jupyter `msg_id`, so `execution_id` and `jupyter_msg_id` are the same
 * value and Ark's `parent_msg_id` already points back at the submission.
 */

/**
 * Where the harness leaves its pid and the trace directory, for processes that
 * cannot see its environment.
 *
 * The extension host is one of those: `getResolvedShellEnv` returns `{}` when
 * the app was launched from a CLI (`shellEnv.ts`), which is exactly how
 * Playwright starts it, so `POSITRON_PERF_TRACE_DIR` never arrives here. That
 * empty environment is also why the path is hardcoded rather than taken from
 * `os.tmpdir()`: with no `TMPDIR` set, this process would resolve a different
 * directory than the harness did.
 */
const POINTER_FILE = process.platform === 'win32'
	? path.join(os.tmpdir(), 'positron-perf-trace-dir')
	: '/tmp/positron-perf-trace-dir';

let resolved = false;
let traceDir: string | undefined;

/**
 * Resolved on first use rather than at module load, because the harness writes
 * the pointer before launching the app but this module may be evaluated either
 * side of that.
 */
function dir(): string | undefined {
	if (!resolved) {
		resolved = true;
		traceDir = process.env.POSITRON_PERF_TRACE_DIR || pointedDir();
	}
	return traceDir;
}

/**
 * The trace directory named by the pointer, if the harness that wrote it is
 * still running.
 *
 * A crashed run leaves both the pointer and its trace directory behind, so
 * neither one's existence distinguishes an ordinary session from a measured
 * one. The writer's liveness does, and it is what stops a stale pointer from
 * making every later session append trace files.
 */
function pointedDir(): string | undefined {
	try {
		const [pid, pointed] = fs.readFileSync(POINTER_FILE, 'utf8').trim().split('\n');
		if (!pointed || !fs.existsSync(pointed) || !alive(Number(pid))) {
			return undefined;
		}
		return pointed;
	} catch {
		return undefined;
	}
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means the process exists but belongs to another user.
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
}

export function perfTraceEnabled(): boolean {
	return dir() !== undefined;
}

type PerfTraceIds = {
	sample_id?: string;
	submission_id?: string;
	execution_id?: string;
	jupyter_msg_id?: string;
	parent_msg_id?: string;
	lsp_request_id?: string | number;
};

type PerfTraceAttrs = Record<string, string | number | boolean | null>;

const RUN_ID = process.env.POSITRON_PERF_TRACE_RUN_ID || process.env.GITHUB_RUN_ID || 'local';

let buffer: string[] = [];
let file: string | undefined;
let timer: NodeJS.Timeout | undefined;

function sink(target: string): string {
	if (!file) {
		file = path.join(target, `exthost-r-${process.pid}.jsonl`);
		fs.mkdirSync(target, { recursive: true });
	}
	return file;
}

/**
 * Starts the periodic flush.
 *
 * Driven from the first marker rather than from the first flush: a run that
 * never fills the buffer would otherwise never schedule a flush, and every event
 * would be lost when the extension host exits.
 */
function ensureFlushing(): void {
	if (timer) {
		return;
	}
	// 250ms rather than a second: the extension host is killed on app
	// shutdown, so an `exit` handler is not reliably reached, and a sample that
	// emits only a handful of events would otherwise never be written at all.
	// The write blocks the loop that relays IOPub messages, but at a few hundred
	// bytes it stays under the noise floor of the intervals being measured.
	timer = setInterval(flushPerfTrace, 250);
	timer.unref();
	process.on('exit', flushPerfTrace);
}

export function flushPerfTrace(): void {
	const target = dir();
	if (buffer.length === 0 || !target) {
		return;
	}
	const lines = buffer.join('\n') + '\n';
	buffer = [];
	try {
		fs.appendFileSync(sink(target), lines);
	} catch {
		// A dropped timing line must never disturb the session being measured.
	}
}

/**
 * Records a checkpoint.
 *
 * `attrs` is metadata only. Code and output bodies stay out: the point is a
 * readable timeline, and copying payloads would land in the measured interval.
 */
export function perfMark(name: string, ids?: PerfTraceIds, attrs?: PerfTraceAttrs): void {
	if (!perfTraceEnabled()) {
		return;
	}

	ensureFlushing();

	const mono = performance.now();
	buffer.push(JSON.stringify({
		v: 1,
		run_id: RUN_ID,
		proc: 'exthost',
		pid: process.pid,
		name,
		t_mono_us: Math.round(mono * 1000),
		t_wall_us: Math.round((performance.timeOrigin + mono) * 1000),
		...(ids ? { ids } : {}),
		...(attrs ? { attrs } : {}),
	}));

	if (buffer.length > 512) {
		flushPerfTrace();
	}
}

/** Emits a paired clock reading, so the analysis can align this process's monotonic clock. */
export function perfClockPair(): void {
	perfMark('clock.pair');
}
