/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import * as os from 'os';
import { IElement } from '../driver';
import { expect, Locator } from '@playwright/test';

interface FlatVariables {
	value: string;
	type: string;
}

const VARIABLE_ITEMS = '.variables-instance[style*="z-index: 1"] .list .variable-item';
const VARIABLE_NAMES = 'name-column';
const VARIABLE_DETAILS = 'details-column';
const VARIABLES_NAME_COLUMN = '.variables-instance[style*="z-index: 1"] .variable-item .name-column';
const VARIABLES_SECTION = '[aria-label="Variables Section"]';
const VARIABLES_INTERPRETER = '.positron-variables-container .action-bar-button-text';

/*
 *  Reuseable Positron variables functionality for tests to leverage.
 */
export class PositronVariables {

	constructor(private code: Code) { }

	async getFlatVariables(): Promise<Map<string, FlatVariables>> {
		const variables = new Map<string, FlatVariables>();
		const variableItems = await this.code.waitForElements(VARIABLE_ITEMS, true);

		for (const item of variableItems) {
			const name = item.children.find(child => child.className === VARIABLE_NAMES)?.textContent;
			const details = item.children.find(child => child.className === VARIABLE_DETAILS);

			const value = details?.children[0].textContent;
			const type = details?.children[1].textContent;

			if (!name || !value || !type) {
				throw new Error('Could not parse variable item');
			}

			variables.set(name, { value, type });
		}
		return variables;
	}

	async waitForVariableRow(variableName: string): Promise<Locator> {
		const desiredRow = this.code.driver.getLocator(`${VARIABLES_NAME_COLUMN} .name-value:text("${variableName}")`);
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

		await this.code.driver.getKeyboard().press(`${modifier}+Alt+B`);
		await this.code.waitForElement(VARIABLES_SECTION);
	}

	async toggleVariable({ variableName, action }: { variableName: string; action: 'expand' | 'collapse' }) {
		await this.waitForVariableRow(variableName);
		const variable = this.code.driver.page.locator('.name-value', { hasText: variableName });

		const chevronIcon = variable.locator('..').locator('.gutter .expand-collapse-icon');
		const isExpanded = await chevronIcon.evaluate((el) => el.classList.contains('codicon-chevron-down'));

		// perform action based on the 'action' parameter
		if (action === 'expand' && !isExpanded) {
			await chevronIcon.click();
		} else if (action === 'collapse' && isExpanded) {
			await chevronIcon.click();
		}

		const expectedClass = action === 'expand'
			? 'expand-collapse-icon codicon codicon-chevron-down'
			: 'expand-collapse-icon codicon codicon-chevron-right';

		await expect(chevronIcon).toHaveClass(expectedClass);
	}

	async expandVariable(variableName: string) {
		await this.toggleVariable({ variableName, action: 'expand' });
	}

	async collapseVariable(variableName: string) {
		await this.toggleVariable({ variableName, action: 'collapse' });
	}

	async getVariablesInterpreter(): Promise<IElement> {
		const interpreter = await this.code.waitForElement(VARIABLES_INTERPRETER);
		return interpreter;
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
		const variable = this.code.driver.page.locator(`.name-value:text-is("${parentVariable}")`);

		// get the children of the parent variable, which are indented
		const children = await variable.locator('..').locator('..').locator('..').locator('..').locator('.variable-item')
			.filter({ has: this.code.driver.page.locator('.name-column-indenter[style*="margin-left: 40px"]') }).all();

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
}
