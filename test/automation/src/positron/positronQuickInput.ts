/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const QUICKINPUT_OK_BUTTON = '.quick-input-widget .quick-input-action a:has-text("OK")';

/*
 *  Extends Microsoft's QuickInput functionality to provide Positron-specific functionality.
 */
export class PositronQuickInput {

	constructor(private code: Code) { }

	async clickOkOnQuickInput(): Promise<void> {
		await this.code.driver.getLocator(QUICKINPUT_OK_BUTTON).click();
	}
}
