/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test from '@playwright/test';
import { Code } from './code.js';

/**
 * Keyboard class to handle keyboard interactions
 */
export class Keyboard {
	constructor(private code: Code) { }

	private getModifierKey(): string {
		return process.platform === 'darwin' ? 'Meta' : 'Control';
	}


	/**
	 * Provides hotkey shortcuts for common operations.
	 * @returns An object with methods for performing hotkey actions.
	 */
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
			focusConsole: () => this.pressHotKeys(`Cmd+K F`),
			toggleBottomPanel: () => this.pressHotKeys(`Cmd+J`)
		};
	}

	/**
	 * Press the hotkeys.
	 * Note: Supports multiple key sequences separated by spaces.
	 * @param keyCombo the hotkeys to press (e.g. "Cmd+Shift+P").
	 */
	private async pressHotKeys(keyCombo: string, options: { platformAdjust?: boolean } = {}) {
		const { platformAdjust = true } = options;
		const modifierKey = this.getModifierKey();

		await test.step(`Press hotkeys: ${keyCombo}`, async () => {
			// Replace "Cmd" with the platform-appropriate modifier key
			const keySequences = keyCombo.split(' ').map(keys => keys.replace(/Cmd/g, platformAdjust ? modifierKey : 'Cmd'));

			for (const key of keySequences) {
				await this.code.driver.page.keyboard.press(key);
			}
		});
	}

	/**
	 * Press a key.
	 * @param key the key to press.
	 * @param options the options to pass to the press function.
	 */
	async press(key: string, options: { delay?: number } = {}) {
		const { delay = 0 } = options;
		await this.code.driver.page.keyboard.press(key, { delay });
	}

	/**
	 * Type text.
	 * @param text the text to type.
	 * @param options the options to pass to the type function.
	 */
	async type(text: string, options: { delay?: number } = {}) {
		const { delay = 0 } = options;
		await this.code.driver.page.keyboard.type(text, { delay });
	}
}
