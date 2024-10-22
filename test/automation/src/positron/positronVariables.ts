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
			const rightColumn = details?.children[1].textContent || '';

			if (!name || !value) {
				throw new Error('Could not parse variable item');
			}

			variables.set(name, { value, type: rightColumn });
		}
		return variables;
	}

	async waitForVariableRow(variableName: string): Promise<Locator> {
		const desiredRow = this.code.driver.getLocator(`.name-value:text-is("${variableName}")`);
		await expect(desiredRow).toBeVisible();
		return desiredRow;
	}

	async doubleClickVariableRow(variableName: string) {

		const desiredRow = await this.waitForVariableRow(variableName);
		await desiredRow.dblclick();
	}

	async openVariables() {

		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		await this.code.driver.getKeyboard().press(`${modifier}+Alt+B`);

		await this.code.waitForElement(VARIABLES_SECTION);

	}

	async toggleVariable({ variableName, action }: { variableName: string; action: 'expand' | 'collapse' }) {
		await this.waitForVariableRow(variableName);
		const variable = this.code.driver.getLocator('.name-value', { hasText: variableName });

		const chevronIcon = variable.locator('..').locator('.gutter .expand-collapse-icon');
		const isExpanded = await chevronIcon.evaluate((el) => el.classList.contains('codicon-chevron-down'));

		// perform action based on the 'action' parameter
		if (action === 'expand' && !isExpanded) {
			await chevronIcon.click();
		} else if (action === 'collapse' && isExpanded) {
			await chevronIcon.click();
		} else {
			console.log(`Variable ${variableName} is already ${action}ed`);
		}
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

	async verifyVariableChildrenValues(variableName: string, expectedChildren: { key: string; value: string }[], collapseParent = true) {
		await this.expandVariable(variableName);

		for (const { key, value } of expectedChildren) {
			const namedVariable = this.code.driver.getLocator(`.name-value:text-is("${key}")`);
			await expect(namedVariable).toBeVisible();

			// check the value corresponding to the child (e.g., value next to it in the details column)
			const valueLocator = namedVariable.locator('..').locator('..').locator('..').locator('.details-column .value');
			await expect(valueLocator).toHaveText(value);
		}

		if (collapseParent) { await this.collapseVariable(variableName); }
	}
}
