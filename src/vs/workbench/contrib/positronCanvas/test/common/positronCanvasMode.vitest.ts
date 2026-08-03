/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { shouldStartInCanvasMode } from '../../common/positronCanvasMode.js';

describe('shouldStartInCanvasMode', () => {

	it('honors a fresh --canvas unconditionally', () => {
		expect(shouldStartInCanvasMode(true, false, false)).toBe(true);
	});

	it('lets an explicitly configured setting beat the stored intent in both directions', () => {
		// Configuration is what the user asked for; storage is only what they
		// last did.
		expect(shouldStartInCanvasMode(false, false, true)).toBe(false);
		expect(shouldStartInCanvasMode(false, true, false)).toBe(true);
	});

	it('relaunches into whatever the workspace quit in when nothing is configured', () => {
		expect(shouldStartInCanvasMode(false, undefined, true)).toBe(true);
		expect(shouldStartInCanvasMode(false, undefined, false)).toBe(false);
	});
});
