/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../code';

export class PositronTerminal {

	constructor(private code: Code) { }

	async sendKeysToTerminal(key: string) {
		await this.clickTerminalTab();
		await this.code.driver.getKeyboard().press(key);
	}

	async clickTerminalTab() {
		this.code.driver.page.getByRole('tab', { name: 'Terminal (⌃`)' }).locator('a').click();
	}
}
