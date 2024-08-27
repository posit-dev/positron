/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import * as os from 'os';
import { IElement } from '../driver';
import { Locator } from '@playwright/test';

interface FlatVariables {
	value: string;
	type: string;
}

const VARIABLE_ITEMS = '.variables-instance[style*="z-index: 1"] .list .variable-item';
const VARIABLE_NAMES = 'name-column';
const VARIABLE_DETAILS = 'details-column';
const VARIABLES_NAME_COLUMN = '.variable-item .name-column';
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

	async openVariables() {

		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		await this.code.driver.getKeyboard().press(`${modifier}+Alt+B`);

		await this.code.waitForElement(VARIABLES_SECTION);

	}

	async getVariablesInterpreter(): Promise<IElement> {
		const interpreter = await this.code.waitForElement(VARIABLES_INTERPRETER);
		return interpreter;
	}
}
