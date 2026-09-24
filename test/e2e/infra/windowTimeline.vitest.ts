/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { visibleIntervals, visibleOverlaps, WindowSample } from './windowTimeline.js';

const sample = (t: number, id: number, visible: boolean, title = `w${id}`, minimized = false): WindowSample =>
	({ t, id, event: 'poll', title, visible, minimized });

describe('visibleIntervals', () => {
	test('pairs each appearance with the next hide, and leaves a still-visible window open', () => {
		expect(visibleIntervals([
			sample(0, 1, true, 'IDE'),
			sample(100, 2, false),
			sample(200, 2, true, 'Canvas'),
			sample(300, 1, false),
		])).toEqual([
			{ id: 1, title: 'IDE', start: 0, end: 300 },
			{ id: 2, title: 'Canvas', start: 200, end: undefined },
		]);
	});

	test('treats a minimized window as off screen', () => {
		expect(visibleIntervals([sample(0, 1, true), sample(50, 1, true, 'w1', true)]))
			.toEqual([{ id: 1, title: 'w1', start: 0, end: 50 }]);
	});
});

describe('visibleOverlaps', () => {
	test('reports each span with two windows on screen and who was in it', () => {
		const overlaps = visibleOverlaps([
			sample(0, 1, true, 'IDE'),
			sample(1000, 2, true, 'Canvas'),
			sample(1040, 1, false),
			sample(5000, 1, true, 'IDE'),
			sample(8000, 1, false),
		]);
		expect(overlaps).toEqual([
			{ start: 1000, end: 1040, durationMs: 40, windows: [{ id: 1, title: 'IDE' }, { id: 2, title: 'Canvas' }] },
			{ start: 5000, end: 8000, durationMs: 3000, windows: [{ id: 2, title: 'Canvas' }, { id: 1, title: 'IDE' }] },
		]);
	});

	test('does not count a hand-off within the same millisecond as an overlap', () => {
		expect(visibleOverlaps([sample(0, 1, true), sample(10, 1, false), sample(10, 2, true)])).toEqual([]);
	});

	test('measures an overlap still open at the end against now', () => {
		const [overlap] = visibleOverlaps([sample(0, 1, true), sample(100, 2, true)], 600);
		expect(overlap).toMatchObject({ start: 100, end: undefined, durationMs: 500 });
	});
});
