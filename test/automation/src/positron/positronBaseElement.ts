/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../code';

/*
 * Base class for Positron elements similar to a PageObject
 * This uses the Code class to interact with the UI
 */
export class PositronBaseElement {
	myselector: string;

	constructor(myselector: string, protected code: Code = this.code) {
		this.myselector = myselector;
	}

	async click(): Promise<void> {
		await this.code.waitAndClick(this.myselector);
	}

	async isNotVisible(retryCount: number = 200): Promise<void> {
		await this.code.waitForElement(this.myselector, (result) => !result, retryCount);
	}

	async waitforVisible(): Promise<void> {
		await this.code.waitForElement(this.myselector);
	}

	async hover(): Promise<void> {
		await this.code.driver.getLocator(this.myselector).hover();
	}
}

export class PositronTextElement extends PositronBaseElement {
	constructor(myselector: string, code: Code) {
		super(myselector, code);
	}

	async waitForText(expectedText: string): Promise<string> {
		return await this.code.waitForTextContent(this.myselector, expectedText);
	}
}
