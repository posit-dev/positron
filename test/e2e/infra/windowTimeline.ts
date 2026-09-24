/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Pure analysis of the native window samples recorded by `startWindowTimeline`
// (electronMain.ts). Kept free of Playwright so it can be unit tested.

/** One recorded native window state, taken on an event or by the poll. */
export interface WindowSample {
	/** Epoch milliseconds. */
	readonly t: number;
	readonly id: number;
	/** The BrowserWindow event, `created`, `closed`, or `poll`. */
	readonly event: string;
	readonly title: string;
	readonly visible: boolean;
	readonly minimized: boolean;
}

/** A span during which a window was on screen (visible and not minimized). */
export interface VisibleInterval {
	readonly id: number;
	/** The title when the span started. */
	readonly title: string;
	readonly start: number;
	/** Undefined when the window was still on screen at the end of the samples. */
	readonly end: number | undefined;
}

/** A span during which two or more windows were on screen at once. */
export interface VisibleOverlap {
	readonly start: number;
	readonly end: number | undefined;
	readonly durationMs: number;
	/** The windows on screen during the span, with the title each had when it appeared. */
	readonly windows: { readonly id: number; readonly title: string }[];
}

const onScreen = (sample: WindowSample) => sample.visible && !sample.minimized;

/** Per-window on-screen spans, in start order. */
export function visibleIntervals(samples: readonly WindowSample[]): VisibleInterval[] {
	const open = new Map<number, { title: string; start: number }>();
	const intervals: VisibleInterval[] = [];
	for (const sample of [...samples].sort((a, b) => a.t - b.t)) {
		const current = open.get(sample.id);
		if (onScreen(sample) && !current) {
			open.set(sample.id, { title: sample.title, start: sample.t });
		} else if (!onScreen(sample) && current) {
			intervals.push({ id: sample.id, title: current.title, start: current.start, end: sample.t });
			open.delete(sample.id);
		}
	}
	for (const [id, current] of open) {
		intervals.push({ id, title: current.title, start: current.start, end: undefined });
	}
	return intervals.sort((a, b) => a.start - b.start);
}

/**
 * Spans with two or more windows on screen. `now` closes spans still open at
 * the end of the samples (for their duration).
 */
export function visibleOverlaps(samples: readonly WindowSample[], now = Date.now()): VisibleOverlap[] {
	const edges = visibleIntervals(samples).flatMap(interval => [
		{ t: interval.start, delta: 1, interval },
		{ t: interval.end ?? Infinity, delta: -1, interval },
	]).sort((a, b) => a.t - b.t || a.delta - b.delta);

	const overlaps: VisibleOverlap[] = [];
	const live = new Set<VisibleInterval>();
	let start: number | undefined;
	let members = new Map<number, string>();
	for (const edge of edges) {
		if (edge.delta > 0) {
			live.add(edge.interval);
		} else {
			live.delete(edge.interval);
		}
		if (live.size >= 2) {
			start ??= edge.t;
			for (const interval of live) {
				members.set(interval.id, interval.title);
			}
		} else if (start !== undefined) {
			const end = Number.isFinite(edge.t) ? edge.t : undefined;
			overlaps.push({
				start,
				end,
				durationMs: (end ?? now) - start,
				windows: [...members].map(([id, title]) => ({ id, title })),
			});
			start = undefined;
			members = new Map();
		}
	}
	return overlaps;
}

/** A readable, relative-time rendering of the samples for reports. */
export function formatTimeline(samples: readonly WindowSample[], origin = samples[0]?.t ?? 0): string {
	return samples.map(s => {
		const state = `${s.visible ? 'visible' : 'hidden'}${s.minimized ? ',minimized' : ''}`;
		return `+${((s.t - origin) / 1000).toFixed(3)}s  win ${s.id}  ${s.event.padEnd(12)} ${state.padEnd(18)} ${JSON.stringify(s.title)}`;
	}).join('\n');
}
