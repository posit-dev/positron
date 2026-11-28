/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { computeWheelScrollDeltas } from '../../utilities/wheelUtilities.js';

type WheelInput = Parameters<typeof computeWheelScrollDeltas>[0];

const wheel = (deltaX: number, deltaY: number, modifiers: Partial<WheelInput> = {}): WheelInput =>
	({ deltaX, deltaY, shiftKey: false, altKey: false, ...modifiers });

describe('computeWheelScrollDeltas', () => {
	test('shift with a vertical wheel scrolls horizontally on Windows and Linux (#11063)', () => {
		expect(computeWheelScrollDeltas(wheel(0, 100, { shiftKey: true }), false))
			.toEqual({ deltaX: 100, deltaY: 0 });
	});

	test('shift does not swap delta Y on macOS (#3755)', () => {
		expect(computeWheelScrollDeltas(wheel(0, 100, { shiftKey: true }), true))
			.toEqual({ deltaX: 0, deltaY: 100 });
	});
});
