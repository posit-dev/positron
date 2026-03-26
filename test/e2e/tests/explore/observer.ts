/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/application';
import { AppState } from './types';

const PROBE_TIMEOUT = 2000;

/**
 * Probe a single piece of state. Returns undefined on any failure.
 */
async function probe<T>(fn: () => Promise<T>): Promise<T | undefined> {
	try {
		return await Promise.race([
			fn(),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), PROBE_TIMEOUT)),
		]);
	} catch {
		return undefined;
	}
}

/**
 * Gather compact application state after each action.
 * Every probe is independent and failure-tolerant.
 */
export async function observeState(app: Application): Promise<AppState> {
	const page = app.code.driver.page;

	const [activeEditor, consoleLinesCount, lastConsoleOutput, variableCount, plotVisible] = await Promise.all([
		// Active editor tab
		probe(async () => {
			const tab = page.locator('.tab.active .label-name');
			const text = await tab.textContent();
			return text?.trim();
		}),

		// Console line count
		probe(async () => {
			const activeConsole = '.console-instance[style*="z-index: auto"]';
			const lines = page.locator(`${activeConsole} div span`);
			return await lines.count();
		}),

		// Last console output line
		probe(async () => {
			const activeConsole = '.console-instance[style*="z-index: auto"]';
			const lines = page.locator(`${activeConsole} div span`);
			const count = await lines.count();
			if (count === 0) { return undefined; }
			const last = await lines.nth(count - 1).textContent();
			return last?.trim();
		}),

		// Variable count
		probe(async () => {
			const currentGroup = '.variables-instance[style*="z-index: 1"]';
			const items = page.locator(`${currentGroup} .variable-item:not(.disabled)`);
			return await items.count();
		}),

		// Plot visible
		probe(async () => {
			const plot = page.locator('.plot-instance img');
			return await plot.isVisible();
		}),
	]);

	return {
		activeEditor,
		consoleLinesCount,
		lastConsoleOutput,
		variableCount,
		plotVisible,
	};
}
