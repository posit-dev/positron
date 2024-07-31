/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from '../code';
import { Selector } from '../terminal';

const TERMINAL_TAB = 'a[aria-label="Terminal (⌃`)"]';

export class PositronTerminal {

	constructor(private code: Code) { }

	async sendKeysToTerminal(key: string) {
		await this.code.waitAndClick(Selector.TerminalView);
		await this.code.driver.getKeyboard().press(key);
	}

	async clickTerminalTab() {
		await this.code.waitAndClick(TERMINAL_TAB);
	}
}
