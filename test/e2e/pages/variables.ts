/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../infra/code';
import * as os from 'os';
import { expect, Locator } from '@playwright/test';

interface FlatVariables {
	value: string;
	type: string;
}

const VARIABLE_ITEMS = '.variable-item:not(.disabled)';
const VARIABLE_NAMES = 'name-column';
const VARIABLE_DETAILS = 'details-column';
const CURRENT_VARIABLES_GROUP = '.variables-instance[style*="z-index: 1"]';
const VARIABLES_NAME_COLUMN = `${CURRENT_VARIABLES_GROUP} .variable-item .name-column`;
const VARIABLES_INTERPRETER = '.positron-variables-container .action-bar-button-text';
const VARIABLE_CHEVRON_ICON = '.gutter .expand-collapse-icon';
const VARIABLE_INDENTED = '.name-column-indenter[style*="margin-left: 40px"]';
const VARIABLES_GROUP_SELECTOR = '.positron-variables-container .action-bar-button-text';

/*
 *  Reuseable Positron variables functionality for tests to leverage.
 */
export class Variables {
	interpreterLocator = this.code.driver.page.locator(VARIABLES_INTERPRETER);

	constructor(private code: Code) { }

	async getFlatVariables(): Promise<Map<string, FlatVariables>> {
		const variables = new Map<string, FlatVariables>();
		await expect(this.code.driver.page.locator(VARIABLE_ITEMS).first()).toBeVisible();
		const variableItems = await this.code.driver.page.locator(VARIABLE_ITEMS).all();

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

	async waitForVariableRow(variableName: string): Promise<Locator> {
		const desiredRow = this.code.driver.page.locator(`${VARIABLES_NAME_COLUMN} .name-value:text("${variableName}")`);
		await desiredRow.waitFor({ state: 'attached' });
		return desiredRow;
	}

	async doubleClickVariableRow(variableName: string) {
		const desiredRow = await this.waitForVariableRow(variableName);
		await desiredRow.dblclick();
	}

	async toggleVariablesView() {
		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		await this.code.driver.page.keyboard.press(`${modifier}+Alt+B`);
	}

	async toggleVariable({ variableName, action }: { variableName: string; action: 'expand' | 'collapse' }) {
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

	async selectVariablesGroup(name: string) {
		await this.code.driver.page.locator(VARIABLES_GROUP_SELECTOR).click();
		await this.code.driver.page.locator('a.action-menu-item', { hasText: name }).first().isVisible();
		await this.code.wait(500);
		await this.code.driver.page.locator('a.action-menu-item', { hasText: name }).first().click();
	}

	async clickDatabaseIconForVariableRow(rowName: string) {
		const DATABASE_ICON = '.codicon-database';
		await this.code.driver.page.locator(VARIABLE_ITEMS).filter({ hasText: rowName }).locator(DATABASE_ICON).click();
	}
}
