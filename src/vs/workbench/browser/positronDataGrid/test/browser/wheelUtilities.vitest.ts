/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { computeWheelScrollDeltas } from '../../utilities/wheelUtilities.js';

type WheelInput = Parameters<typeof computeWheelScrollDeltas>[0];

// A wheel event with no modifier keys held.
const wheel = (deltaX: number, deltaY: number, modifiers: Partial<WheelInput> = {}): WheelInput =>
	({ deltaX, deltaY, shiftKey: false, altKey: false, ...modifiers });

describe('computeWheelScrollDeltas', () => {
	test('a plain vertical wheel scrolls vertically on every platform', () => {
		expect([
			computeWheelScrollDeltas(wheel(0, 100), false),
			computeWheelScrollDeltas(wheel(0, 100), true),
		]).toEqual([
			{ deltaX: 0, deltaY: 100 },
			{ deltaX: 0, deltaY: 100 },
		]);
	});

	// The platform cases of the shift conversion are covered by positronWheel.vitest.ts. These
	// check that the data grid applies it, and in the right order with its own adjustments.
	test('shift with a vertical wheel scrolls horizontally on Windows and Linux (#11063)', () => {
		expect(computeWheelScrollDeltas(wheel(0, 100, { shiftKey: true }), false))
			.toEqual({ deltaX: 100, deltaY: 0 });
	});

	test('shift does not swap delta Y on macOS', () => {
		expect(computeWheelScrollDeltas(wheel(0, 100, { shiftKey: true }), true))
			.toEqual({ deltaX: 0, deltaY: 100 });
	});

	test('the non-dominant axis is zeroed before the shift conversion', () => {
		// Delta X is jitter, so it is dropped and delta Y becomes the horizontal scroll.
		expect(computeWheelScrollDeltas(wheel(3, 100, { shiftKey: true }), false))
			.toEqual({ deltaX: 100, deltaY: 0 });
	});

	test('alt multiplies the converted delta by 10', () => {
		expect(computeWheelScrollDeltas(wheel(0, 100, { shiftKey: true, altKey: true }), false))
			.toEqual({ deltaX: 1000, deltaY: 0 });
	});
});
