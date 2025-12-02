/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../infra/code';
import test, { expect, Locator } from '@playwright/test';
import { HotKeys } from './hotKeys.js';
import { ContextMenu } from './dialog-contextMenu.js';

interface FlatVariables {
	value: string;
	type: string;
}

const VARIABLE_ITEMS = '.variable-item:not(.disabled)';
const VARIABLE_NAMES = 'name-column';
const VARIABLE_DETAILS = 'details-column';
const CURRENT_VARIABLES_GROUP = '.variables-instance[style*="z-index: 1"]';
const VARIABLES_NAME_COLUMN = `${CURRENT_VARIABLES_GROUP} .variable-item .name-column`;
const VARIABLES_INTERPRETER = '.positron-variables-container .action-bar-button-label';
const VARIABLE_CHEVRON_ICON = '.gutter .expand-collapse-icon';
const VARIABLE_INDENTED = '.name-column-indenter[style*="margin-left: 40px"]';
const VARIABLES_GROUP_SELECTOR = '.positron-variables-container .action-bar-button-label';
const VARIABLES_FILTER_SELECTOR = '.positron-variables-container .action-bar-filter-input .text-input';

/*
 *  Reuseable Positron variables functionality for tests to leverage.
 */
export class Variables {
	get interpreterLocator(): Locator { return this.code.driver.page.locator(VARIABLES_INTERPRETER); }
	variablesPane: Locator;
	variablesRuntime: (name: string | RegExp) => Locator;

	constructor(private code: Code, private hotKeys: HotKeys, private contextMenu: ContextMenu) {
		this.variablesPane = this.code.driver.page.locator('[id="workbench.panel.positronSession"]');
		this.variablesRuntime = (name: string | RegExp) => this.variablesPane.getByRole('button', { name });
	}

	async getFlatVariables(): Promise<Map<string, FlatVariables>> {
		const variables = new Map<string, FlatVariables>();
		await expect(this.code.driver.page.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).first()).toBeVisible();
		const variableItems = await this.code.driver.page.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).all();
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
		await this.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
		await this.code.driver.page.keyboard.press('V');
	}

	async waitForVariableRow(variableName: string): Promise<Locator> {
		const desiredRow = this.code.driver.page.locator(VARIABLES_NAME_COLUMN).filter({ hasText: variableName });
		await expect(desiredRow).toBeVisible();
		return desiredRow;
	}

	async doubleClickVariableRow(variableName: string) {
		await test.step(`Double click variable: ${variableName}`, async () => {
			await this.hotKeys.showSecondarySidebar();
			const desiredRow = this.code.driver.page.locator(VARIABLES_NAME_COLUMN).filter({ hasText: variableName });
			await desiredRow.dblclick();
		});
	}

	async hasProgressBar(): Promise<boolean> {
		const progressBar = this.code.driver.page.locator('.variables-core .monaco-progress-container');
		return await progressBar.isVisible();
	}

	async toggleVariable({ variableName, action }: { variableName: string; action: 'expand' | 'collapse' }) {
		await test.step(`${action} variable: ${variableName}`, async () => {
			await this.waitForVariableRow(variableName);
			const variable = this.code.driver.page.locator(`${CURRENT_VARIABLES_GROUP} .name-value`, { hasText: variableName });

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
		const variable = this.code.driver.page.locator(`${CURRENT_VARIABLES_GROUP} .name-value:text-is("${parentVariable}")`);

		// get the children of the parent variable, which are indented
		const children = await variable.locator('..').locator('..').locator('..').locator('..').locator(VARIABLE_ITEMS)
			.filter({ has: this.code.driver.page.locator(VARIABLE_INDENTED) }).all();

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

	async getCurrentVariablesGroup(): Promise<string> {
		const group = await this.code.driver.page.locator(VARIABLES_GROUP_SELECTOR).innerText();
		return group;
	}

	/**
	 * Select a session in the variables pane.
	 * @param name the name of the session to select
	 */
	async selectSession(name: string) {
		await this.contextMenu.triggerAndClick({
			menuTrigger: this.code.driver.page.locator('.positron-variables .positron-action-bar').nth(1).locator('button'),
			menuItemLabel: name,
		});
	}

	async selectVariablesGroup(name: string) {
		await this.code.driver.page.locator(VARIABLES_GROUP_SELECTOR).click();
		await this.code.driver.page.locator('a.action-menu-item', { hasText: name }).first().isVisible();
		await this.code.wait(500);
		await this.code.driver.page.locator('a.action-menu-item', { hasText: name }).first().click();
	}

	async getVariablesGroupList() {
		await this.code.driver.page.locator(VARIABLES_GROUP_SELECTOR).click();
		const groupList = await this.code.driver.page.locator('a.action-menu-item').all();
		const groupNames = await Promise.all(groupList.map(async (group) => group.innerText()));
		return groupNames;
	}

	async setFilterText(filterText: string) {
		await this.code.driver.page.locator(VARIABLES_FILTER_SELECTOR).fill(filterText);
	}

	async clickDatabaseIconForVariableRow(rowName: string) {
		const DATABASE_ICON = '.codicon-database';
		await this.code.driver.page.locator(`${CURRENT_VARIABLES_GROUP} ${VARIABLE_ITEMS}`).filter({ hasText: rowName }).locator(DATABASE_ICON).click();
	}

	async clickSessionLink() {
		await this.code.driver.page.getByLabel('Active View Switcher').getByText('Session').click();
	}

	async clickDeleteAllVariables() {
		await this.code.driver.page.getByLabel('Delete all objects').click();
	}

	/**
	 * Verify: Confirm the runtime is visible in the variables pane.
	 * @param language the language of the runtime: Python or R
	 * @param version the version of the runtime: e.g. 3.10.15
	 */
	async expectRuntimeToBe(expectation: 'visible' | 'not.visible', sessionName: string | RegExp) {
		await test.step(`Verify runtime is ${expectation}: ${sessionName}`, async () => {
			await this.hotKeys.showSecondarySidebar();
			expectation === 'visible'
				? await expect(this.variablesRuntime(sessionName)).toBeVisible()
				: await expect(this.variablesRuntime(sessionName)).not.toBeVisible();
		});
	}


	/**
	 * Verify: Confirm the variable is visible and has the expected value.
	 * @param variableName the name of the variable to check
	 * @param value the expected value of the variable
	 * @param timeout (optional) timeout in milliseconds for visibility (default 15000)
	 */
	async expectVariableToBe(variableName: string, value: string, timeout: number = 15000) {
		await test.step(`Verify variable: ${variableName} with value: ${value}`, async () => {
			await this.focusVariablesView();
			const variableRow = this.code.driver.page
				.locator('.variables-instance[style*="z-index: 1"]')
				.locator('.name-column')
				.filter({ hasText: variableName })
				.locator('..');

			await expect(variableRow).toBeVisible({ timeout });
			await expect(variableRow.locator('.details-column .value')).toHaveText(value);
		});
	}

	async expectVariableToNotExist(variableName: string) {
		await test.step(`Verify variable does not exist: ${variableName}`, async () => {
			await this.focusVariablesView();
			const row = this.code.driver.page
				.locator('.variables-instance[style*="z-index: 1"] .variable-item')
				.filter({ hasText: variableName });

			await expect(row).toHaveCount(0);
		});
	}

	/**
	 * Verify: Confirm the session is selected in the variables pane.
	 * @param sessionName the name of the session to check is selected
	 */
	async expectSessionToBe(sessionName: string | RegExp) {
		await test.step(`Verify session is selected in variables pane: ${sessionName}`, async () => {
			await expect(this.interpreterLocator).toBeVisible();
			await expect(this.interpreterLocator).toHaveText(sessionName);
		});
	}
}
