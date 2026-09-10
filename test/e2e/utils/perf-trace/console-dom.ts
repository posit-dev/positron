/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';
import { TraceEvent, TraceIds, TRACE_SCHEMA_VERSION, TraceName } from './schema.js';
import { runId } from './recorder.js';

/**
 * Browser-side DOM readiness measurement, alongside the existing metric.
 *
 * The harness assertions poll the DOM through CDP, so they report the poll
 * boundary a state change landed on rather than the change itself. A keydown
 * listener and a `MutationObserver` on one browser clock give the change itself,
 * and the difference between the two is the harness's own contribution.
 *
 * This observes DOM mutation, not paint. A node entering the DOM has not
 * necessarily been rastered, so these numbers are not user-visible latency.
 */

const ACTIVE_CONSOLE_INSTANCE = '.console-instance[style*="z-index: auto"]';

export type ConsoleDomSample = {
	/** Browser `performance.timeOrigin`, for placing the browser clock on the wall timeline. */
	timeOrigin: number;
	/** Matches of the expected output already present when arming. */
	baselineOutputCount: number;
	/** `performance.now()` of the real Enter keydown on the console input. */
	enter?: number;
	/** First mutation at which a fresh match of the expected output is present. */
	output?: number;
	/** First observation of fresh output and a ready prompt together. */
	ready?: number;
	/** Whether the prompt was already ready when fresh output first appeared. */
	promptReadyAtOutput: boolean;
	/** Mutation batches the observer processed, to gauge its own cost. */
	mutationBatches: number;
	/** Conditions never observed, named rather than left as absent numbers. */
	missing: string[];
};

/**
 * The two globals the browser side installs.
 *
 * Declared so the evaluated code can reach them through one narrowing cast
 * rather than an `any` at every access. `__positronPerfTrace` is the same object
 * `src/vs/base/common/positronPerfTrace.ts` reads.
 */
type PerfDomWindow = Window & {
	__positronPerfDom?: {
		error?: string;
		sample?: Omit<ConsoleDomSample, 'missing'>;
		stop?: () => void;
	};
	__positronPerfTrace?: {
		enabled: boolean;
		runId?: string;
		sampleId?: string;
		events: TraceEvent[];
	};
};

type ArmOptions = {
	/** Text the executed expression is expected to produce. */
	expectedOutput: string;
	/** Prompt string that marks the console ready, e.g. `>` or `>>>`. */
	prompt: string;
	/** Propagated to renderer-side markers so they join the harness's sample. */
	sampleId: string;
};

/**
 * Installs the listener and observer, and switches on renderer-side markers.
 *
 * Call before pressing Enter and outside the measured interval: this is a CDP
 * round trip and would otherwise be counted as execution latency.
 */
export async function armConsoleDomTrace(page: Page, options: ArmOptions): Promise<void> {
	// Event names below are string literals, not `TraceName.*`: this callback is
	// serialized and runs in the browser, which has no access to this module's
	// scope. Referencing `TraceName` here type-checks but throws at runtime.
	await page.evaluate(
		({ activeSelector, expectedOutput, prompt, sampleId, traceRunId }) => {
			const win = window as PerfDomWindow;
			const active = document.querySelector(activeSelector);
			if (!active) {
				win.__positronPerfDom = { error: 'no active console instance' };
				return;
			}

			// Renderer instrumentation is off until a sample arms it, so an
			// ordinary run never allocates an event buffer.
			const trace = {
				enabled: true,
				runId: traceRunId,
				sampleId,
				events: [] as TraceEvent[],
			};
			win.__positronPerfTrace = trace;

			// Paired reading from the browser clock, so the analysis can report
			// this process's drift rather than assuming there is none.
			const armMono = performance.now();
			trace.events.push({
				v: 1,
				run_id: traceRunId,
				proc: 'renderer',
				pid: 0,
				name: 'clock.pair',
				t_mono_us: Math.round(armMono * 1000),
				t_wall_us: Math.round((performance.timeOrigin + armMono) * 1000),
				ids: { sample_id: sampleId },
			});

			const freshOutputCount = () =>
				Array.from(active.querySelectorAll('div span'))
					.filter(node => (node.textContent ?? '').includes(expectedOutput)).length;

			const promptReady = () => {
				const line = active.querySelector('.active-line-number');
				return (line?.textContent ?? '').trim() === prompt;
			};

			const baselineOutputCount = freshOutputCount();

			const sample: {
				timeOrigin: number;
				baselineOutputCount: number;
				enter?: number;
				output?: number;
				ready?: number;
				promptReadyAtOutput: boolean;
				mutationBatches: number;
			} = {
				timeOrigin: performance.timeOrigin,
				baselineOutputCount,
				promptReadyAtOutput: false,
				mutationBatches: 0,
			};

			const onKeydown = (event: Event) => {
				const key = event as KeyboardEvent;
				if (key.key === 'Enter' && sample.enter === undefined) {
					sample.enter = performance.now();
				}
				// The focus chord (`Cmd+K F`) is otherwise invisible here: this is
				// the only marker for when the renderer actually receives it.
				const now = performance.now();
				trace.events.push({
					v: 1,
					run_id: traceRunId,
					proc: 'renderer',
					pid: 0,
					name: 'renderer.keydown.any',
					t_mono_us: Math.round(now * 1000),
					t_wall_us: Math.round((performance.timeOrigin + now) * 1000),
					ids: { sample_id: sampleId },
					attrs: { key: key.key, code: key.code, ctrl: key.ctrlKey, meta: key.metaKey, alt: key.altKey, shift: key.shiftKey },
				});
			};
			// Capture on the window: the console input's own element is replaced
			// as the editor re-renders, so a listener bound to it can be lost.
			window.addEventListener('keydown', onKeydown, true);

			const check = () => {
				const now = performance.now();
				const hasFreshOutput = freshOutputCount() > baselineOutputCount;
				if (!hasFreshOutput) {
					return;
				}
				if (sample.output === undefined) {
					sample.output = now;
					sample.promptReadyAtOutput = promptReady();
				}
				// Both conditions are checked together, so a prompt that was
				// already ready when output appeared does not wait for a further
				// mutation that may never come.
				if (sample.ready === undefined && promptReady()) {
					sample.ready = now;
					observer.disconnect();
				}
			};

			const observer = new MutationObserver(() => {
				sample.mutationBatches++;
				check();
			});
			observer.observe(active, { childList: true, subtree: true, characterData: true });

			// A blocked main thread produces no events at all, which reads the
			// same as an idle one. Two detectors, because `longtask` did not
			// report anything in the Electron renderer: the frame-gap fallback
			// needs no entry-type support and catches the same stalls.
			let longTasks: PerformanceObserver | undefined;
			try {
				longTasks = new PerformanceObserver(list => {
					for (const entry of list.getEntries()) {
						trace.events.push({
							v: 1,
							run_id: traceRunId,
							proc: 'renderer',
							pid: 0,
							name: 'renderer.longtask',
							t_mono_us: Math.round(entry.startTime * 1000),
							t_wall_us: Math.round((performance.timeOrigin + entry.startTime) * 1000),
							ids: { sample_id: sampleId },
							attrs: { duration_ms: entry.duration, entry_name: entry.name },
						});
					}
				});
				longTasks.observe({ entryTypes: ['longtask'] });
			} catch {
				// Not every embedder supports the entry type; the frame-gap
				// detector below covers the same ground without it.
			}

			// A frame that arrives late means the main thread was busy through
			// it. Cheaper than it looks: one callback per frame, and it stops
			// with the sample.
			let framePending = true;
			let lastFrame = performance.now();
			const onFrame = () => {
				if (!framePending) {
					return;
				}
				const now = performance.now();
				const gap = now - lastFrame;
				if (gap >= 50) {
					trace.events.push({
						v: 1,
						run_id: traceRunId,
						proc: 'renderer',
						pid: 0,
						name: 'renderer.longtask',
						t_mono_us: Math.round(lastFrame * 1000),
						t_wall_us: Math.round((performance.timeOrigin + lastFrame) * 1000),
						ids: { sample_id: sampleId },
						attrs: { duration_ms: gap, entry_name: 'frame-gap' },
					});
				}
				lastFrame = now;
				requestAnimationFrame(onFrame);
			};
			requestAnimationFrame(onFrame);

			win.__positronPerfDom = {
				sample,
				stop: () => {
					framePending = false;
					observer.disconnect();
					longTasks?.disconnect();
					window.removeEventListener('keydown', onKeydown, true);
				},
			};
		},
		{ activeSelector: ACTIVE_CONSOLE_INSTANCE, traceRunId: runId, ...options }
	);
}

/**
 * Retrieves the sample and tears down the observer.
 *
 * Call after the measured interval so the retrieval round trip is not part of
 * what the browser clock reports.
 */
export async function drainConsoleDomTrace(page: Page): Promise<{ dom: ConsoleDomSample; rendererEvents: TraceEvent[] }> {
	const raw = await page.evaluate(() => {
		const win = window as PerfDomWindow;
		const state = win.__positronPerfDom;
		const trace = win.__positronPerfTrace;
		const events: TraceEvent[] = trace?.events ?? [];
		if (trace) { trace.enabled = false; }
		if (!state || state.error || !state.sample) {
			return { error: state?.error ?? 'not armed', sample: undefined, events };
		}
		state.stop?.();
		return { error: undefined, sample: state.sample, events };
	});

	if (raw.error !== undefined || raw.sample === undefined) {
		throw new Error(`Console DOM trace was not armed: ${raw.error ?? 'no sample'}`);
	}

	const sample = raw.sample;
	const missing: string[] = [];
	if (sample.enter === undefined) { missing.push('enter'); }
	if (sample.output === undefined) { missing.push('output'); }
	if (sample.ready === undefined) { missing.push('ready'); }

	return {
		dom: { ...sample, missing },
		rendererEvents: raw.events,
	};
}

/**
 * Converts the browser-clock readings into trace events.
 *
 * The browser's `performance.now()` origin is unrelated to the harness's, so
 * each reading is paired with its wall equivalent derived from the browser's own
 * `timeOrigin` rather than being compared to a harness monotonic value.
 */
export function domSampleToEvents(dom: ConsoleDomSample, ids: TraceIds): TraceEvent[] {
	const events: TraceEvent[] = [];

	const push = (name: string, mono?: number) => {
		if (mono === undefined) { return; }
		events.push({
			v: TRACE_SCHEMA_VERSION,
			run_id: runId,
			proc: 'renderer',
			pid: 0,
			name,
			t_mono_us: Math.round(mono * 1000),
			t_wall_us: Math.round((dom.timeOrigin + mono) * 1000),
			ids,
		});
	};

	push(TraceName.renderer.enterKeydown, dom.enter);
	push(TraceName.renderer.domOutput, dom.output);
	push(TraceName.renderer.domReady, dom.ready);

	return events;
}
