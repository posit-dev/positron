/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { shouldPresentCanvasStartupCurtain } from '../../electron-browser/positronCanvas.contribution.js';

describe('shouldPresentCanvasStartupCurtain', () => {

	it('never presents the curtain when ai.enabled is false, regardless of other signals', () => {
		expect(shouldPresentCanvasStartupCurtain(false, false, true, true, true)).toBe(false);
		expect(shouldPresentCanvasStartupCurtain(false, false, false, true, false)).toBe(false);
		expect(shouldPresentCanvasStartupCurtain(false, false, false, undefined, true)).toBe(false);
	});

	it('never presents the curtain when Canvas is engaged in another window, regardless of other signals', () => {
		expect(shouldPresentCanvasStartupCurtain(true, true, true, true, true)).toBe(false);
		expect(shouldPresentCanvasStartupCurtain(true, true, false, true, false)).toBe(false);
		expect(shouldPresentCanvasStartupCurtain(true, true, false, undefined, true)).toBe(false);
	});

	it('falls through to shouldStartInCanvasMode when neither veto applies', () => {
		expect(shouldPresentCanvasStartupCurtain(true, false, true, false, false)).toBe(true);
		expect(shouldPresentCanvasStartupCurtain(true, false, false, true, false)).toBe(true);
		expect(shouldPresentCanvasStartupCurtain(true, false, false, false, true)).toBe(false);
		expect(shouldPresentCanvasStartupCurtain(true, false, false, undefined, false)).toBe(false);
	});
});
