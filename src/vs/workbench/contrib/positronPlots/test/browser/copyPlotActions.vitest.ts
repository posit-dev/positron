/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildCopyPlotActions } from '../../browser/components/copyPlotActions.js';

describe('buildCopyPlotActions', () => {
	it('lists the one-click copy first and never checks it', () => {
		const actions = buildCopyPlotActions(() => { }, () => { });
		expect(actions[0].label).toBe('Copy Plot to Clipboard');
		expect(actions[0].checked).toBeFalsy();
	});

	it('lists Copy Plot at Custom Size second', () => {
		const actions = buildCopyPlotActions(() => { }, () => { });
		expect(actions).toHaveLength(2);
		expect(actions[1].label).toBe('Copy Plot at Custom Size...');
	});

	it('has only the one-click copy when custom size is unavailable', () => {
		const actions = buildCopyPlotActions(() => { }, undefined);
		expect(actions).toHaveLength(1);
	});

	it('runs the matching callback for each action', async () => {
		const copy = vi.fn();
		const custom = vi.fn();
		const actions = buildCopyPlotActions(copy, custom);
		await actions[0].run();
		await actions[1].run();
		expect(copy).toHaveBeenCalledTimes(1);
		expect(custom).toHaveBeenCalledTimes(1);
	});
});
