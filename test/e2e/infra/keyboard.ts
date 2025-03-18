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
			copy: () => this.hotKeysPress(`Cmd+C`),
			paste: () => this.hotKeysPress(`Cmd+V`),
			cut: () => this.hotKeysPress(`Cmd+X`),
			selectAll: () => this.hotKeysPress(`Cmd+A`),
			save: () => this.hotKeysPress(`Cmd+S`),
			undo: () => this.hotKeysPress(`Cmd+Z`),
			openFile: () => this.hotKeysPress(`Cmd+O`),
			find: () => this.hotKeysPress(`Cmd+F`),
			closeTab: () => this.hotKeysPress(`Cmd+W`),
			firstTab: () => this.hotKeysPress(`Cmd+1`),
			switchTabLeft: () => this.hotKeysPress(`Cmd+Shift+[`),
			switchTabRight: () => this.hotKeysPress(`Cmd+Shift+]`),
			closeAllEditors: () => this.hotKeysPress(`Cmd+K Cmd+W`),
			visualMode: () => this.hotKeysPress(`Cmd+Shift+F4`),
		};
	}

	private async hotKeysPress(action: string) {
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
