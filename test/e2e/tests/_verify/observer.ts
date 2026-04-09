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
					// -- Existing probes --
					const activeTab = document.querySelector('.tab.active .label-name');
					const activeEditor = activeTab?.textContent?.trim();

					const consoleSelector = '.console-instance[style*="z-index: auto"]';
					const consoleLines = document.querySelectorAll(`${consoleSelector} div span`);
					const consoleLinesCount = consoleLines.length;
					const lastConsoleOutput = consoleLinesCount > 0
						? consoleLines[consoleLinesCount - 1]?.textContent?.trim()
						: undefined;

					const variableSelector = '.variables-instance[style*="z-index: 1"] .variable-item:not(.disabled)';
					const variableElements = document.querySelectorAll(variableSelector);
					const variableCount = variableElements.length;

					const plotImg = document.querySelector('.plot-instance img');
					const plotVisible = plotImg
						? (plotImg as HTMLElement).offsetWidth > 0 && (plotImg as HTMLElement).offsetHeight > 0
						: false;

					// -- New probes --

					// Variable names (up to 20)
					const variableNames: string[] = [];
					variableElements.forEach((el, i) => {
						if (i >= 20) { return; }
						const name = el.querySelector('.name-column-value, .name-value')?.textContent?.trim();
						if (name) { variableNames.push(name); }
					});

					// Session count and active session
					// Note: returns 0 when console panel is not focused/rendered in DOM
					const sessionTabs = document.querySelectorAll('[data-testid*="console-tab"]');
					const sessionCount = sessionTabs.length;
					const activeSessionTab = document.querySelector('[data-testid*="console-tab"] .tab-button--active');
					const activeSession = activeSessionTab?.closest('[data-testid*="console-tab"]')?.textContent?.trim();

					// Notifications
					const notifications: string[] = [];
					document.querySelectorAll('.notification-toast .notification-list-item-message, .notifications-toasts .notification-toast-message').forEach((el, i) => {
						if (i >= 5) { return; }
						const text = (el as HTMLElement).textContent?.trim();
						if (text) { notifications.push(text); }
					});

					// Open tabs
					const openTabs: string[] = [];
					document.querySelectorAll('.tab .label-name').forEach((el, i) => {
						if (i >= 10) { return; }
						const text = (el as HTMLElement).textContent?.trim();
						if (text) { openTabs.push(text); }
					});

					// Focused panel
					let focusedPanel: string | undefined;
					const activeElement = document.activeElement;
					if (activeElement) {
						const panelMap: Array<[string, string]> = [
							['.console-instance', 'console'],
							['.terminal-wrapper', 'terminal'],
							['.editor-instance', 'editor'],
							['.variables-instance', 'variables'],
							['.plot-instance', 'plots'],
						];
						for (const [selector, name] of panelMap) {
							if (activeElement.closest(selector)) {
								focusedPanel = name;
								break;
							}
						}
					}

					return {
						activeEditor, consoleLinesCount, lastConsoleOutput,
						variableCount, variableNames, plotVisible,
						sessionCount, activeSession, notifications,
						openTabs, focusedPanel,
					};
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
