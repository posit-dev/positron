/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator } from '@playwright/test';
import { Code } from '../code';

export class PositronTerminal {
	terminalTab: Locator;

	constructor(private code: Code) {
		this.terminalTab = this.code.driver.page.getByRole('tab', { name: 'Terminal' }).locator('a');
	}

	async sendKeysToTerminal(key: string) {
		await this.clickTerminalTab();
		await this.code.driver.getKeyboard().press(key);
	}

	async clickTerminalTab() {
		await this.terminalTab.click();
	}
}
