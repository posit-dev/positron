/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

interface FlatVariables {
	value: string;
	type: string;
}

const VARIABLE_ITEMS = '.variables-instance .list .variable-item';
const VARIABLE_NAMES = '.name-column';
const VARIABLE_DETAILS = '.details-column';

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

		const desiredRow = this.code.driver.getLocator(`.variable-item .name-column .name-value:text("${variableName}")`);

		await desiredRow.dblclick();

	}


}
