/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test from '@playwright/test';
import { Code } from '../infra/code.js';

/**
 * Provides hotkey shortcuts for common operations.
 */
export class HotKeys {
	constructor(private code: Code) { }

	private getModifierKey(): string {
		return process.platform === 'darwin' ? 'Meta' : 'Control';
	}

	// --- Editing actions ---
	public async copy() {
		await this.pressHotKeys(`Cmd+C`);
	}

	public async cut() {
		await this.pressHotKeys(`Cmd+X`);
	}

	public async paste() {
		await this.pressHotKeys(`Cmd+V`);
	}

	public async selectAll() {
		await this.pressHotKeys(`Cmd+A`);
	}

	public async undo() {
		await this.pressHotKeys(`Cmd+Z`);
	}

	// --- File actions ---
	public async save() {
		await this.pressHotKeys(`Cmd+S`);
	}

	public async openFile() {
		await this.pressHotKeys(`Cmd+O`);
	}

	// --- Find & Navigation ---
	public async find() {
		await this.pressHotKeys(`Cmd+F`);
	}

	public async firstTab() {
		await this.pressHotKeys(`Cmd+1`);
	}

	public async switchTabLeft() {
		await this.pressHotKeys(`Cmd+Shift+[`);
	}

	public async switchTabRight() {
		await this.pressHotKeys(`Cmd+Shift+]`);
	}

	public async closeTab() {
		await this.pressHotKeys(`Cmd+W`);
	}

	public async closeAllEditors() {
		await this.pressHotKeys(`Cmd+K Cmd+W`);
	}

	public async scrollToTop() {
		const platform = process.platform;

		if (platform === 'win32' || platform === 'linux') {
			await this.code.driver.page.keyboard.press('Home');
		} else {
			await this.pressHotKeys(`Cmd+ArrowUp`);
		}
	}

	// --- Console & Visuals ---
	public async visualMode() {
		await this.pressHotKeys(`Cmd+Shift+F4`);
	}

	public async focusConsole() {
		await this.pressHotKeys(`Cmd+K F`);
	}

	/**
	 * Press the hotkeys.
	 * Note: Supports multiple key sequences separated by spaces.
	 * @param keyCombo the hotkeys to press (e.g. "Cmd+Shift+P").
	 */
	private async pressHotKeys(keyCombo: string) {
		const modifierKey = this.getModifierKey();

		await test.step(`Press hotkeys: ${keyCombo}`, async () => {
			// Replace "Cmd" with the platform-appropriate modifier key
			// and (for Windows and Ubuntu) replace "Option" with "Alt"
			const keySequences = keyCombo.split(' ').map(keys => keys.replace(/Cmd/g, modifierKey));

			for (const key of keySequences) {
				await this.code.driver.page.keyboard.press(key);
			}
		});
	}
}
