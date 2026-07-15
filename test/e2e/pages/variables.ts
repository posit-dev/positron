/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../infra/code';
import test, { expect, Locator } from '@playwright/test';
import { HotKeys } from './hotKeys.js';

interface FlatVariables {
	value: string;
	type: string;
}

const VARIABLE_ITEMS = '.variable-item:not(.disabled)';
const VARIABLE_NAMES = 'name-column';
const VARIABLE_DETAILS = 'details-column';
const CURRENT_VARIABLES_GROUP = '.variables-instance[style*="z-index: 1"]';
const VARIABLES_NAME_COLUMN = `${CURRENT_VARIABLES_GROUP} .variable-item .name-column`;
const VARIABLE_CHEVRON_ICON = '.gutter .expand-collapse-icon';
const VARIABLE_INDENTED = '.name-column-indenter[style*="margin-left: 40px"]';
const VARIABLES_FILTER_SELECTOR = '.positron-variables-container .action-bar-filter-input .text-input';

/*
 *  Reuseable Positron variables functionality for tests to leverage.
 */
export class Variables {
	variablesPane: Locator;
	memoryMeter: Locator;
	memoryDropdown: Locator;
	memorySizeLabel: Locator;
	lowMemoryWarning: Locator;

	constructor(private code: Code, private hotKeys: HotKeys) {
		this.variablesPane = this.code.driver.currentPage.locator('[id="workbench.panel.positronSession"]');
		this.memoryMeter = this.code.driver.currentPage.locator('.memory-usage-meter');
		this.memoryDropdown = this.code.driver.currentPage.locator('.memory-usage-dropdown');
		this.memorySizeLabel = this.code.driver.currentPage.locator('.memory-size-label');
		this.lowMemoryWarning = this.code.driver.currentPage.locator('.memory-usage-meter .memory-low-warning');
	}

	async getFlatVariables(): Promise<Map<string, FlatVariables>> {
		const variables = new Map<string, FlatVariables>();
		await expect(this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).first()).toBeVisible();
		const variableItems = await this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).all();
		for (const item of variableItems) {
			const nameElement = item.locator(`.${VARIABLE_NAMES}`).first();
			const detailsElement = item.locator(`.${VARIABLE_DETAILS}`).first();

			const name = await nameElement.textContent();
			const value = detailsElement
				? await detailsElement.locator(':scope > *').nth(0).textContent()
				: null;
			const type = detailsElement
				? await detailsElement.locator(':scope > *').nth(1).textContent()
				: null;

			if (!name || !value || !type) {
				throw new Error('Could not parse variable item');
			}

			variables.set(name.trim(), { value: value.trim(), type: type.trim() });
		}
		return variables;
	}

	async focusVariablesView() {
		await this.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
		await this.code.driver.currentPage.keyboard.press('V');
	}

	async waitForVariableRow(variableName: string): Promise<Locator> {
		const desiredRow = this.code.driver.currentPage.locator(VARIABLES_NAME_COLUMN).getByText(variableName, { exact: true });
		await expect(desiredRow).toBeVisible();
		return desiredRow;
	}

	async doubleClickVariableRow(variableName: string) {
		await test.step(`Double click variable: ${variableName}`, async () => {
			await this.hotKeys.showSecondarySidebar();
			const desiredRow = this.code.driver.currentPage.locator(VARIABLES_NAME_COLUMN).getByText(variableName, { exact: true });
			await desiredRow.dblclick();
		});
	}

	async hasProgressBar(): Promise<boolean> {
		const progressBar = this.code.driver.currentPage.locator('.variables-core .monaco-progress-container');
		return await progressBar.isVisible();
	}

	/**
	 * Scroll the variables list by wheel. Positive y scrolls down, negative scrolls up.
	 */
	async scroll(delta: { y: number }): Promise<void> {
		const list = this.code.driver.currentPage.locator('.variables-instance').first();
		await list.hover();
		await this.code.driver.currentPage.mouse.wheel(0, delta.y);
	}

	async toggleVariable({ variableName, action }: { variableName: string; action: 'expand' | 'collapse' }) {
		await test.step(`${action} variable: ${variableName}`, async () => {
			await this.waitForVariableRow(variableName);
			const variable = this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} .name-value`).getByText(variableName, { exact: true });

			const chevronIcon = variable.locator('..').locator(VARIABLE_CHEVRON_ICON);
			const isExpanded = await chevronIcon.evaluate((el) => el.classList.contains('codicon-chevron-down'));

			// perform action based on the 'action' parameter
			if (action === 'expand' && !isExpanded) {
				await chevronIcon.click();
			} else if (action === 'collapse' && isExpanded) {
				await chevronIcon.click();
			}

			const expectedClass = action === 'expand'
				? /codicon-chevron-down/
				: /codicon-chevron-right/;

			await expect(chevronIcon).toHaveClass(expectedClass);
		});
	}

	async expandVariable(variableName: string) {
		await this.toggleVariable({ variableName, action: 'expand' });
	}

	async collapseVariable(variableName: string) {
		await this.toggleVariable({ variableName, action: 'collapse' });
	}

	/**
	 * Gets the data (value and type) for the children of a parent variable.
	 * NOTE: it assumes that either ALL variables are collapsed or ONLY the parent variable is expanded.
	 *
	 * @param parentVariable the parent variable to get the children of
	 * @param collapseParent whether to collapse the parent variable after getting the children data
	 * @returns a map of the children's name, value, and type
	 */
	async getVariableChildren(parentVariable: string, collapseParent = true): Promise<{ [key: string]: { value: string; type: string } }> {
		await this.expandVariable(parentVariable);
		const variable = this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} .name-value:text-is("${parentVariable}")`);

		// get the children of the parent variable, which are indented
		const children = await variable.locator('..').locator('..').locator('..').locator('..').locator(VARIABLE_ITEMS)
			.filter({ has: this.code.driver.currentPage.locator(VARIABLE_INDENTED) }).all();

		// create a map of the children's name, value, and type
		const result: { [key: string]: { value: string; type: string } } = {};
		for (const child of children) {
			const childName = await child.locator('.name-value').textContent() || '';
			const childValue = await child.locator('.details-column .value').textContent() || '';
			const childType = await child.locator('.details-column .right-column').textContent() || '';

			if (childName) {
				result[childName] = { value: childValue, type: childType };
			}
		}

		// collapse the parent variable if the flag is set
		if (collapseParent) { await this.collapseVariable(parentVariable); }

		return result;
	}

	async setFilterText(filterText: string) {
		await this.code.driver.currentPage.locator(VARIABLES_FILTER_SELECTOR).fill(filterText);
	}

	variableRow(name: string): Locator {
		return this.code.driver.currentPage
			.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`)
			.filter({ has: this.code.driver.currentPage.getByText(name, { exact: true }) })
			.first();
	}

	async clickDatabaseIconForVariableRow(rowName: string) {
		const DATABASE_ICON = '.codicon-database';
		await this.code.driver.currentPage.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).filter({ has: this.code.driver.currentPage.getByText(rowName, { exact: true }) }).locator(DATABASE_ICON).click();
	}

	async clickSessionLink() {
		await this.code.driver.currentPage.getByLabel('Active View Switcher').getByText('Session').click();
	}

	async clickDeleteAllVariables() {
		await this.code.driver.currentPage.getByLabel('Delete all objects').click();
	}

	/**
	 * Verify: Confirm the variable is visible and has the expected value.
	 * @param variableName the name of the variable to check
	 * @param value the expected value of the variable
	 * @param timeout (optional) timeout in milliseconds for visibility (default 15000)
	 */
	async expectVariableToBe(variableName: string, value: string | RegExp, timeout: number = 15000) {
		await test.step(`Verify variable: ${variableName} with value: ${value}`, async () => {
			await this.focusVariablesView();
			const variableRow = this.code.driver.currentPage
				.locator('.variables-instance[style*="z-index: 1"]')
				.locator('.variable-item')
				.filter({ has: this.code.driver.currentPage.locator('.name-column').getByText(variableName, { exact: true }) });

			await expect(variableRow).toBeVisible({ timeout });
			await expect(variableRow.locator('.details-column .value')).toHaveText(value, { timeout: 3000 });
		});
	}

	async expectVariableToNotExist(variableName: string) {
		await test.step(`Verify variable does not exist: ${variableName}`, async () => {
			await this.focusVariablesView();
			const row = this.code.driver.currentPage
				.locator('.variables-instance[style*="z-index: 1"] .variable-item')
				.filter({ has: this.code.driver.currentPage.getByText(variableName, { exact: true }) });

			await expect(row).toHaveCount(0);
		});
	}

	/**
	 * Wait for the memory meter to be visible and showing a real value (not loading state).
	 * Focuses the variables view first to ensure the meter is visible.
	 */
	async expectMemoryMeterReady() {
		await this.focusVariablesView();
		await expect(this.memoryMeter).toBeVisible({ timeout: 30000 });
		await expect(this.memorySizeLabel).not.toHaveText('Mem', { timeout: 30000 });
	}

	/**
	 * Verify the low-memory warning icon is (or is not) shown in the memory meter.
	 * When expected to be visible, also checks the accessible "Low memory" label.
	 * @param visible whether the warning icon is expected to be visible
	 */
	async expectLowMemoryWarning(visible: boolean) {
		await test.step(`Verify low memory warning icon ${visible ? 'is' : 'is not'} visible`, async () => {
			await this.focusVariablesView();
			if (visible) {
				await expect(this.lowMemoryWarning).toBeVisible({ timeout: 30000 });
				await expect(this.lowMemoryWarning).toHaveAttribute('aria-label', /Low memory/);
			} else {
				await expect(this.lowMemoryWarning).not.toBeVisible({ timeout: 30000 });
			}
		});
	}

	/**
	 * Verify the non-kernel segments of the memory usage bar render with their
	 * designated theme colors.
	 *
	 * Regression guard: the Positron-overhead (`.positron`) and other-processes
	 * (`.other`) segments color themselves via registered Positron color tokens
	 * (`--vscode-positronMemoryUsageBar-*`). A previous upstream merge removed the
	 * upstream `--vscode-gauge-*` colors these segments used to reference, leaving
	 * the CSS variables undefined so the segments fell back to a fully transparent
	 * `background-color`. For each segment this asserts the segment's rendered
	 * color (a) matches the resolved value of its designated token and (b) is not
	 * transparent -- catching both a segment wired to the wrong token and an
	 * undefined token (which leaves the background transparent). Assertions target
	 * the segment's actual color and interpolate the observed value, so a failure
	 * reports what the segment actually rendered. Comparing against the resolved
	 * token (rather than a hard-coded color) keeps the check theme-independent.
	 *
	 * The caller must disable the low-memory state (both thresholds set to 0);
	 * otherwise these segments are intentionally recolored to the error color.
	 *
	 * Uses `toBeAttached` (not `toBeVisible`) because a segment can occupy a
	 * sub-pixel width in the compact toolbar bar while still carrying the color
	 * under test.
	 */
	async expectMemoryBarSegmentsColored() {
		await test.step('Verify memory bar segments render with their designated colors', async () => {
			await this.focusVariablesView();

			const segmentColors: Record<string, string> = {
				positron: '--vscode-positronMemoryUsageBar-overheadForeground',
				other: '--vscode-positronMemoryUsageBar-otherForeground',
			};

			for (const [segmentClass, cssVariable] of Object.entries(segmentColors)) {
				const segment = this.memoryMeter.locator(`.memory-bar-segment.${segmentClass}`).first();
				await expect(segment).toBeAttached({ timeout: 30000 });

				const { actual, expected } = await segment.evaluate((el, variable) => {
					const actual = window.getComputedStyle(el).backgroundColor;
					// Resolve the expected token through a probe in the same
					// custom-property scope, so both values share the browser's
					// canonical rgb()/rgba() serialization and compare directly.
					const parent = el.parentElement ?? el;
					const probe = document.createElement('div');
					probe.style.backgroundColor = `var(${variable})`;
					parent.appendChild(probe);
					const expected = window.getComputedStyle(probe).backgroundColor;
					probe.remove();
					return { actual, expected };
				}, cssVariable);

				// Assert against the segment's actual rendered color (not the probe)
				// and interpolate the observed values, so a failure reports the real
				// color the segment rendered rather than only the transparent sentinel.
				expect(actual, `.memory-bar-segment.${segmentClass} should render ${cssVariable} (expected "${expected}", got "${actual}")`).toBe(expected);
				expect(actual, `.memory-bar-segment.${segmentClass} (${cssVariable}) rendered a transparent background ("${actual}"); the color token likely did not resolve`).not.toBe('rgba(0, 0, 0, 0)');
			}
		});
	}

	/**
	 * Open the memory usage dropdown by clicking the memory meter.
	 * Does nothing if already open.
	 */
	async openMemoryDropdown() {
		if (!await this.memoryDropdown.isVisible()) {
			await this.memoryMeter.click();
			await expect(this.memoryDropdown).toBeVisible({ timeout: 15000 });
		}
	}

	/**
	 * Close the memory usage dropdown by pressing Escape.
	 */
	async closeMemoryDropdown() {
		await this.code.driver.currentPage.keyboard.press('Escape');
		await expect(this.memoryDropdown).not.toBeVisible();
	}

	/**
	 * Verify sessions appear (or do not appear) in the memory usage dropdown.
	 * Opens the dropdown if not already visible, checks all sessions, then closes it.
	 * @param sessions record mapping session names to expected visibility
	 */
	async expectSessionsInMemoryDropdown(sessions: Record<string, boolean>) {
		await this.openMemoryDropdown();

		for (const [sessionName, visible] of Object.entries(sessions)) {
			const sessionLocator = this.memoryDropdown.locator('.usage-name').filter({ hasText: sessionName });
			if (visible) {
				await expect(sessionLocator).toBeVisible({ timeout: 15000 });
			} else {
				await expect(sessionLocator).not.toBeVisible({ timeout: 15000 });
			}
		}

		await this.closeMemoryDropdown();
	}
}
