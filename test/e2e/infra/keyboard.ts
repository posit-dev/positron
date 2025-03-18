/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test from '@playwright/test';
import { Code } from './code.js';

export class Keyboard {
	constructor(private code: Code) { }

	private getModifierKey(): string {
		return process.platform === 'darwin' ? 'Meta' : 'Control';
	}

	get hotKeys() {
		return {
			copy: () => this.pressHotKeys(`Cmd+C`),
			paste: () => this.pressHotKeys(`Cmd+V`),
			cut: () => this.pressHotKeys(`Cmd+X`),
			selectAll: () => this.pressHotKeys(`Cmd+A`),
			save: () => this.pressHotKeys(`Cmd+S`),
			undo: () => this.pressHotKeys(`Cmd+Z`),
			openFile: () => this.pressHotKeys(`Cmd+O`),
			find: () => this.pressHotKeys(`Cmd+F`),
			closeTab: () => this.pressHotKeys(`Cmd+W`),
			firstTab: () => this.pressHotKeys(`Cmd+1`),
			switchTabLeft: () => this.pressHotKeys(`Cmd+Shift+[`),
			switchTabRight: () => this.pressHotKeys(`Cmd+Shift+]`),
			closeAllEditors: () => this.pressHotKeys(`Cmd+K Cmd+W`),
			visualMode: () => this.pressHotKeys(`Cmd+Shift+F4`),
		};
	}

	private async pressHotKeys(action: string) {
		const modifierKey = this.getModifierKey(); // Now handled inside this function

		await test.step(`Press hotkeys: ${action}`, async () => {
			// Replace "Cmd" with the platform-appropriate modifier key
			const keySequences = action.split(' ').map(keys => keys.replace(/Cmd/g, modifierKey));

			for (const key of keySequences) {
				await this.code.driver.page.keyboard.press(key);
			}
		});
	}

	async press(keys: string, options: { delay?: number } = {}) {
		const { delay = 0 } = options;
		await this.code.driver.page.keyboard.press(keys, { delay });
	}

	async type(text: string, options: { delay?: number } = {}) {
		const { delay = 0 } = options;
		await this.code.driver.page.keyboard.type(text, { delay });
	}
}
