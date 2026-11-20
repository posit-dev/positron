/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { shiftWheelToHorizontal } from '../../common/positronWheel.js';

describe('shiftWheelToHorizontal', () => {
	test('converts shift + vertical wheel to horizontal on Windows and Linux (#11063)', () => {
		expect([
			shiftWheelToHorizontal({ deltaX: 0, deltaY: 100, shiftKey: true }, false),
			shiftWheelToHorizontal({ deltaX: 0, deltaY: -100, shiftKey: true }, false),
		]).toEqual([
			{ deltaX: 100, deltaY: 0 },
			{ deltaX: -100, deltaY: 0 },
		]);
	});

	test('leaves shift + vertical wheel alone on macOS, which converts it before the event arrives (#3755)', () => {
		expect(shiftWheelToHorizontal({ deltaX: 0, deltaY: 100, shiftKey: true }, true))
			.toEqual({ deltaX: 0, deltaY: 100 });
	});

	test('leaves an event that already carries delta X alone', () => {
		// macOS, or a mouse driver on another platform, already converted it.
		expect([
			shiftWheelToHorizontal({ deltaX: 100, deltaY: 0, shiftKey: true }, true),
			shiftWheelToHorizontal({ deltaX: 100, deltaY: 0, shiftKey: true }, false),
		]).toEqual([
			{ deltaX: 100, deltaY: 0 },
			{ deltaX: 100, deltaY: 0 },
		]);
	});

	test('leaves a wheel without shift alone', () => {
		expect(shiftWheelToHorizontal({ deltaX: 0, deltaY: 100, shiftKey: false }, false))
			.toEqual({ deltaX: 0, deltaY: 100 });
	});
});
