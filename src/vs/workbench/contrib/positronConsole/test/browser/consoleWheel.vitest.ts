/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWheelScrollUp } from '../../browser/components/consoleWheel.js';

describe('isWheelScrollUp', () => {
	test('a plain wheel up scrolls up, and engages scroll lock, on every platform', () => {
		expect([
			isWheelScrollUp({ deltaX: 0, deltaY: -100, shiftKey: false }, false),
			isWheelScrollUp({ deltaX: 0, deltaY: -100, shiftKey: false }, true),
		]).toEqual([true, true]);
	});

	test('a wheel down does not scroll up', () => {
		expect(isWheelScrollUp({ deltaX: 0, deltaY: 100, shiftKey: false }, false)).toBe(false);
	});

	test('shift + wheel up scrolls horizontally on Windows and Linux, so it does not engage scroll lock (#11063)', () => {
		expect(isWheelScrollUp({ deltaX: 0, deltaY: -100, shiftKey: true }, false)).toBe(false);
	});

	test('shift + wheel up with delta Y scrolls up on macOS, which converts shift + wheel itself', () => {
		expect(isWheelScrollUp({ deltaX: 0, deltaY: -100, shiftKey: true }, true)).toBe(true);
	});
});
