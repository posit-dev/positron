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

	// Getter for hotKeys to allow dot notation (e.g., app.keyboard.hotKeys.save)
	get hotKeys() {
		const modifierKey = this.getModifierKey();
		return {
			copy: () => this.hotKeysPress(`Cmd+C`, modifierKey),
			paste: () => this.hotKeysPress(`Cmd+V`, modifierKey),
			cut: () => this.hotKeysPress(`Cmd+X`, modifierKey),
			selectAll: () => this.hotKeysPress(`Cmd+A`, modifierKey),
			save: () => this.hotKeysPress(`Cmd+S`, modifierKey),
			undo: () => this.hotKeysPress(`Cmd+Z`, modifierKey),
			openFile: () => this.hotKeysPress(`Cmd+O`, modifierKey),
			find: () => this.hotKeysPress(`Cmd+F`, modifierKey),
			closeTab: () => this.hotKeysPress(`Cmd+W`, modifierKey),
			firstTab: () => this.hotKeysPress(`Cmd+1`, modifierKey),
			switchTabLeft: () => this.hotKeysPress(`Cmd+Shift+[`, modifierKey),
			switchTabRight: () => this.hotKeysPress(`Cmd+Shift+]`, modifierKey),
			closeAllEditors: () => this.hotKeysPress(`Cmd+K Cmd+W`, modifierKey),
			visualMode: () => this.hotKeysPress(`Cmd+Shift+F4`, modifierKey),
		};
	}

	private async hotKeysPress(action: string, modifierKey: string) {
		await test.step(`Press hotkeys: ${action}`, async () => {
			// Split command if there are multiple sequential key presses
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
