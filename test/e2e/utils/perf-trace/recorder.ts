/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { performance } from 'perf_hooks';
import os from 'os';
import path from 'path';
import { TraceEvent, TraceIds, TraceProc, TRACE_SCHEMA_VERSION, TraceName } from './schema.js';

/**
 * Harness-side trace recorder.
 *
 * Enabled only when `POSITRON_PERF_TRACE_DIR` is set, so an ordinary e2e run
 * pays a boolean check per marker and nothing else. Events accumulate in memory
 * and are appended once per sample: a synchronous write per marker would show up
 * in the interval being measured.
 */

const TRACE_DIR = process.env.POSITRON_PERF_TRACE_DIR;

export const traceEnabled = Boolean(TRACE_DIR);

/**
 * Hands this process's pid and trace directory to processes that cannot see its
 * environment.
 *
 * The extension host is the case that forced this: `getResolvedShellEnv` returns
 * `{}` when the app was launched from a CLI, which is how Playwright starts it,
 * so `POSITRON_PERF_TRACE_DIR` never reaches the extensions. The path is
 * hardcoded rather than `os.tmpdir()` for the same reason: with no `TMPDIR` in
 * that empty environment, the extension host would resolve a different one.
 *
 * Written at module load, before the app fixture launches, and removed on exit.
 * The pid is what makes a pointer this process never got to remove harmless: an
 * extension traces only while the writer is alive, so a crashed run cannot leave
 * every later session appending trace files.
 */
const POINTER_FILE = process.platform === 'win32'
	? path.join(os.tmpdir(), 'positron-perf-trace-dir')
	: '/tmp/positron-perf-trace-dir';

if (TRACE_DIR) {
	mkdirSync(TRACE_DIR, { recursive: true });
	writeFileSync(POINTER_FILE, `${process.pid}\n${TRACE_DIR}`);
	process.on('exit', () => {
		try {
			rmSync(POINTER_FILE, { force: true });
		} catch {
			// Nothing useful to do while exiting.
		}
	});
}

export const runId =
	process.env.POSITRON_PERF_TRACE_RUN_ID ||
	process.env.GITHUB_RUN_ID ||
	`local-${Date.now()}`;

/**
 * Wall and monotonic microseconds, read back to back.
 *
 * `performance.timeOrigin` plus `performance.now()` keeps sub-millisecond wall
 * resolution, which `Date.now()` would round away -- and rounding matters here,
 * because several of the intervals under investigation are single-digit
 * milliseconds.
 */
function clocks(): { t_mono_us: number; t_wall_us: number } {
	const mono = performance.now();
	return {
		t_mono_us: Math.round(mono * 1000),
		t_wall_us: Math.round((performance.timeOrigin + mono) * 1000),
	};
}

export class TraceRecorder {
	private readonly events: TraceEvent[] = [];
	private readonly file: string;

	constructor(public readonly sampleId: string) {
		// One file per sample keeps concurrent workers from interleaving writes
		// into a single file, and keeps a failed sample's events on disk.
		this.file = path.join(TRACE_DIR ?? '.', `harness-${sampleId}.jsonl`);
		if (traceEnabled) {
			mkdirSync(TRACE_DIR!, { recursive: true });
			this.clockPair();
		}
	}

	/** Records a checkpoint. A no-op when tracing is off. */
	mark(name: string, ids?: TraceIds, attrs?: TraceEvent['attrs']): void {
		if (!traceEnabled) { return; }
		this.push('harness', name, ids, attrs);
	}

	/**
	 * Brackets an operation with `<name>.start` / `<name>.end` markers.
	 *
	 * The end marker is emitted even when the operation throws, so a timed-out
	 * assertion still reports where the interval ended.
	 */
	async span<T>(startName: string, endName: string, operation: () => Promise<T>, ids?: TraceIds): Promise<T> {
		this.mark(startName, ids);
		try {
			return await operation();
		} finally {
			this.mark(endName, ids);
		}
	}

	/**
	 * Adopts events produced in another process, rebasing nothing: they carry
	 * their own clocks and the analysis aligns them.
	 */
	adopt(events: TraceEvent[]): void {
		if (!traceEnabled) { return; }
		this.events.push(...events);
	}

	clockPair(proc: TraceProc = 'harness'): void {
		if (!traceEnabled) { return; }
		this.push(proc, TraceName.clockPair);
	}

	/** Appends everything buffered so far. Safe to call more than once. */
	flush(): void {
		if (!traceEnabled || this.events.length === 0) { return; }
		const lines = this.events.map(event => JSON.stringify(event)).join('\n') + '\n';
		this.events.length = 0;
		appendFileSync(this.file, lines);
	}

	private push(proc: TraceProc, name: string, ids?: TraceIds, attrs?: TraceEvent['attrs']): void {
		this.events.push({
			v: TRACE_SCHEMA_VERSION,
			run_id: runId,
			proc,
			pid: process.pid,
			name,
			...clocks(),
			ids: { sample_id: this.sampleId, ...ids },
			...(attrs ? { attrs } : {}),
		});
	}
}

/**
 * The recorder for the sample currently being measured.
 *
 * Page objects mark against this rather than receiving a recorder, so the
 * shared `waitForConsoleContents()` and `waitForReady()` helpers can be
 * instrumented in place. Instrumenting the real helpers is the point: a copy of
 * their steps in the test would measure the copy, not what the metric runs.
 * Single-valued because a timing run uses one worker.
 */
let current: TraceRecorder | undefined;

export function setCurrentRecorder(recorder: TraceRecorder | undefined): void {
	current = recorder;
}

/** Marks against the current sample, if a sample is being measured. */
export function mark(name: string, ids?: TraceIds, attrs?: TraceEvent['attrs']): void {
	current?.mark(name, ids, attrs);
}

/** Brackets an operation against the current sample. */
export async function span<T>(startName: string, endName: string, operation: () => Promise<T>): Promise<T> {
	if (!current) {
		return operation();
	}
	return current.span(startName, endName, operation);
}

/**
 * A stable, filesystem-safe sample identifier.
 *
 * Repeated measurement runs the whole Playwright invocation again rather than
 * using `--repeat-each`, because the app and session are worker-scoped: a second
 * repetition would execute the same expression into the same warm console, which
 * both breaks the spec's exact-count assertion and measures a different
 * experiment. The iteration therefore arrives from the environment, and the
 * repeat index is kept only so an accidental `--repeat-each` still separates.
 */
export function makeSampleId(testTitle: string, repeatIndex: number): string {
	const slug = testTitle.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
	const tag = process.env.POSITRON_PERF_TRACE_SAMPLE_TAG;
	return `${slug}${tag ? `-${tag}` : ''}-r${repeatIndex}`;
}
