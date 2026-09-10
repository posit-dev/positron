/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Opt-in timing markers for the console-execution latency investigation.
 *
 * Disabled unless an e2e sample installs `__positronPerfTrace` on the global and
 * sets `enabled`, so a normal session allocates no buffer and each call site
 * costs a property read plus the `ids` and `attrs` literals its caller builds.
 * Those literals are the entire disabled-path cost on the per-message call
 * sites, which is why none of them derives a value from the message payload.
 *
 * Events buffer in memory and the harness drains them after the measured
 * interval; nothing is written to disk or sent over IPC while a measurement is
 * running.
 *
 * See `test/e2e/utils/perf-trace/schema.ts` for the event shape and the
 * identifier chain that joins these events to the extension host and Ark.
 */

type PerfTraceIds = {
	sample_id?: string;
	submission_id?: string;
	execution_id?: string;
	jupyter_msg_id?: string;
	parent_msg_id?: string;
	lsp_request_id?: string | number;
};

type PerfTraceAttrs = Record<string, string | number | boolean | null>;

type PerfTraceEvent = {
	v: number;
	run_id: string;
	proc: 'renderer';
	pid: number;
	name: string;
	t_mono_us: number;
	t_wall_us: number;
	ids?: PerfTraceIds;
	attrs?: PerfTraceAttrs;
};

type PerfTraceState = {
	enabled: boolean;
	runId?: string;
	sampleId?: string;
	events: PerfTraceEvent[];
};

function state(): PerfTraceState | undefined {
	const candidate = (globalThis as { __positronPerfTrace?: PerfTraceState }).__positronPerfTrace;
	return candidate?.enabled ? candidate : undefined;
}

export function isPerfTraceEnabled(): boolean {
	return state() !== undefined;
}

/**
 * Records a checkpoint on the browser clock.
 *
 * `attrs` is for metadata only. Output bodies and source text are deliberately
 * excluded: they would dominate the artifact and the copying would land inside
 * the interval being measured.
 */
export function perfMark(name: string, ids?: PerfTraceIds, attrs?: PerfTraceAttrs): void {
	const trace = state();
	if (!trace) {
		return;
	}

	const mono = performance.now();
	trace.events.push({
		v: 1,
		run_id: trace.runId ?? 'unknown',
		proc: 'renderer',
		pid: 0,
		name,
		t_mono_us: Math.round(mono * 1000),
		t_wall_us: Math.round((performance.timeOrigin + mono) * 1000),
		ids: { sample_id: trace.sampleId, ...ids },
		...(attrs ? { attrs } : {}),
	});
}

/**
 * Mints a submission identifier for one Enter.
 *
 * Ordinal-based rather than random so a timeline stays readable, and so two
 * submissions of the same expression in one sample remain distinguishable
 * without correlating by their text.
 */
let submissionOrdinal = 0;
export function nextPerfSubmissionId(): string | undefined {
	const trace = state();
	if (!trace) {
		return undefined;
	}
	submissionOrdinal++;
	return `${trace.sampleId ?? 'nosample'}-s${submissionOrdinal}`;
}
