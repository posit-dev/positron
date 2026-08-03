/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { selectCanvasLaunchWindow } from '../../common/positronCanvasLaunch.js';

function window(canvas?: boolean) {
	return { config: { canvas } };
}

describe('selectCanvasLaunchWindow', () => {
	it('returns nothing when the launch opened no windows', () => {
		expect(selectCanvasLaunchWindow([], undefined)).toBeUndefined();
	});

	it('targets a single reused window', () => {
		const reused = window();

		expect(selectCanvasLaunchWindow([reused], reused)).toBe(reused);
	});

	it('leaves a freshly opened window to its own startup entry', () => {
		const fresh = window(true);

		expect(selectCanvasLaunchWindow([fresh], fresh)).toBeUndefined();
	});

	it('targets only the last active window when several were used', () => {
		const first = window();
		const lastActive = window();

		expect(selectCanvasLaunchWindow([first, lastActive], lastActive)).toBe(lastActive);
	});

	it('falls back to the first window when the last active one is unrelated', () => {
		const used = window();
		const unrelated = window();

		expect(selectCanvasLaunchWindow([used], unrelated)).toBe(used);
	});

	it('sends nothing when the last active window already carries the flag', () => {
		const reused = window();
		const fresh = window(true);

		expect(selectCanvasLaunchWindow([reused, fresh], fresh)).toBeUndefined();
	});

	it('treats a window with no configuration yet as reused', () => {
		const loading = { config: undefined };

		expect(selectCanvasLaunchWindow([loading], loading)).toBe(loading);
	});
});
