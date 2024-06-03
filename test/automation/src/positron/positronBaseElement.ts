/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../code';

/*
 * Base class for Positron elements similar to a PageObject
 * This uses the Code class to interact with the UI
 */
export class PositronBaseElement {
	myselector: string;

	constructor(myselector: string, private code: Code = this.code) {
		this.myselector = myselector;
	}

	async click(): Promise<void> {
		await this.code.waitAndClick(this.myselector);
	}

	async isNotVisible(): Promise<void> {
		await this.code.waitForElement(this.myselector, (result) => !result);
	}
}
