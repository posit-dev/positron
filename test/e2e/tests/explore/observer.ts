/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '@playwright/test';
import { Application } from '../../infra/application';
import { AppState } from './types';

const PROBE_TIMEOUT = 500;

/**
 * Gather compact application state after each action.
 * Wrapped in a single "Observe state" test.step so it appears as one
 * collapsible entry in the Playwright report.
 */
export async function observeState(app: Application): Promise<AppState> {
	return await test.step('Observe state', async () => {
		const page = app.code.driver.page;

		try {
			const state = await Promise.race([
				page.evaluate(() => {
					const activeTab = document.querySelector('.tab.active .label-name');
					const activeEditor = activeTab?.textContent?.trim();

					const consoleSelector = '.console-instance[style*="z-index: auto"]';
					const consoleLines = document.querySelectorAll(`${consoleSelector} div span`);
					const consoleLinesCount = consoleLines.length;
					const lastConsoleOutput = consoleLinesCount > 0
						? consoleLines[consoleLinesCount - 1]?.textContent?.trim()
						: undefined;

					const variableSelector = '.variables-instance[style*="z-index: 1"] .variable-item:not(.disabled)';
					const variableCount = document.querySelectorAll(variableSelector).length;

					const plotImg = document.querySelector('.plot-instance img');
					const plotVisible = plotImg
						? (plotImg as HTMLElement).offsetWidth > 0 && (plotImg as HTMLElement).offsetHeight > 0
						: false;

					return { activeEditor, consoleLinesCount, lastConsoleOutput, variableCount, plotVisible };
				}),
				new Promise<AppState>((resolve) =>
					setTimeout(() => resolve({}), PROBE_TIMEOUT)
				),
			]);
			return state;
		} catch {
			return {};
		}
	});
}
