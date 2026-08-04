/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CanvasLaunchWindowAssigner, selectCanvasLaunchWindow } from '../../common/positronCanvasLaunch.js';

function launchWindow(canvas?: boolean) {
	return { config: { canvas } };
}

describe('CanvasLaunchWindowAssigner', () => {
	it('assigns each Canvas launch to exactly one window', () => {
		const assigner = new CanvasLaunchWindowAssigner();
		const firstLaunch = { canvas: true };
		const secondLaunch = { canvas: true };

		expect([
			assigner.assign(firstLaunch),
			assigner.assign(firstLaunch),
			assigner.assign(secondLaunch),
			assigner.assign({}),
			assigner.assign(undefined),
		]).toEqual([true, false, true, false, false]);
	});
});

describe('selectCanvasLaunchWindow', () => {
	it('returns nothing when the launch opened no windows', () => {
		expect(selectCanvasLaunchWindow([], undefined)).toBeUndefined();
	});

	it('targets a single reused window', () => {
		const reused = launchWindow();

		expect(selectCanvasLaunchWindow([reused], reused)).toBe(reused);
	});

	it('leaves a freshly opened window to its own startup entry', () => {
		const fresh = launchWindow(true);

		expect(selectCanvasLaunchWindow([fresh], fresh)).toBeUndefined();
	});

	it('targets only the last active window when several were used', () => {
		const first = launchWindow();
		const lastActive = launchWindow();

		expect(selectCanvasLaunchWindow([first, lastActive], lastActive)).toBe(lastActive);
	});

	it('falls back to the first window when the last active one is unrelated', () => {
		const used = launchWindow();
		const unrelated = launchWindow();

		expect(selectCanvasLaunchWindow([used], unrelated)).toBe(used);
	});

	it('sends nothing when the last active window already carries the flag', () => {
		const reused = launchWindow();
		const fresh = launchWindow(true);

		expect(selectCanvasLaunchWindow([reused, fresh], fresh)).toBeUndefined();
	});

	it('sends nothing when any used window carries the flag', () => {
		const fresh = launchWindow(true);
		const reused = launchWindow();

		expect(selectCanvasLaunchWindow([fresh, reused], reused)).toBeUndefined();
	});

	it('treats a window with no configuration yet as reused', () => {
		const loading = { config: undefined };

		expect(selectCanvasLaunchWindow([loading], loading)).toBe(loading);
	});
});
