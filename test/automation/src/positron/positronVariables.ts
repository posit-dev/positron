/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import * as os from 'os';

interface FlatVariables {
	value: string;
	type: string;
}

const VARIABLE_ITEMS = '.variables-instance .list .variable-item';
const VARIABLE_NAMES = '.name-column';
const VARIABLE_DETAILS = '.details-column';
const VARIABLES_NAME_COLUMN = '.variable-item .name-column';
const VARIABLES_SECTION = '[aria-label="Variables Section"]';

export class PositronVariables {

	constructor(private code: Code) { }

	async getFlatVariables(): Promise<Map<string, FlatVariables>> {

		const variablesLocator = this.code.driver.getLocator(VARIABLE_ITEMS);
		const nameLocators = variablesLocator.locator(VARIABLE_NAMES);
		const detailLocators = variablesLocator.locator(VARIABLE_DETAILS);

		const names = await Promise.all(Array.from({ length: await nameLocators.count() }, async (_, i) => {
			return await nameLocators.nth(i).innerText();
		}));

		const details = await Promise.all(Array.from({ length: await detailLocators.count() }, async (_, i) => {
			return await detailLocators.nth(i).innerText();
		}));

		const variablesMap = new Map<string, FlatVariables>();
		for (let i = 0; i < names.length; i++) {
			const detailsParts: string[] = details[i].split('\n');
			variablesMap.set(names[i], { value: detailsParts[0], type: detailsParts[1] });
		}

		return variablesMap;

	}

	async doubleClickVariableRow(variableName: string) {

		const desiredRow = this.code.driver.getLocator(`${VARIABLES_NAME_COLUMN} .name-value:text("${variableName}")`);

		await desiredRow.waitFor({ state: 'attached' });

		await desiredRow.dblclick();

	}

	async openVariables() {

		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		await this.code.driver.getKeyboard().press(`${modifier}+Alt+B`);

		await this.code.waitForElement(VARIABLES_SECTION);

	}
}
