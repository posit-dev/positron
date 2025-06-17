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

	// ----------------------
	// --- Editing Actions ---
	// ----------------------
	/**
	 * Copy selected content to clipboard
	 */
	public async copy() {
		await this.pressHotKeys(`Cmd+C`);
	}

	/**
	 * Cut selected content to clipboard
	 */
	public async cut() {
		await this.pressHotKeys(`Cmd+X`);
	}

	/**
	 * Paste content from clipboard
	 */
	public async paste() {
		await this.pressHotKeys(`Cmd+V`);
	}

	/**
	 * Redo the last undone action
	 */
	public async redo() {
		await this.pressHotKeys(`Cmd+Shift+Z`);
	}

	/**
	 * Select all content
	 */
	public async selectAll() {
		await this.pressHotKeys(`Cmd+A`);
	}

	/**
	 * Undo the last action
	 */
	public async undo() {
		await this.pressHotKeys(`Cmd+Z`);
	}

	// --------------------
	// --- File Actions ---
	// --------------------
	/**
	 * Open a file
	 */
	public async openFile() {
		await this.pressHotKeys(`Cmd+O`);
	}

	/**
	 * Save the current file
	 */
	public async save() {
		await this.pressHotKeys(`Cmd+S`);
	}

	// -------------------------
	// --- Find & Navigation ---
	// -------------------------
	/**
	 * Close all editor tabs
	 */
	public async closeAllEditors() {
		await this.pressHotKeys(`Cmd+K Cmd+W`);
	}

	/**
	 * Close the current tab
	 */
	public async closeTab() {
		await this.pressHotKeys(`Cmd+W`);
	}

	/**
	 * Open the find dialog
	 */
	public async find() {
		await this.pressHotKeys(`Cmd+F`);
	}

	/**
	 * Switch to the first tab
	 */
	public async firstTab() {
		await this.pressHotKeys(`Cmd+1`);
	}

	/**
	 * Scroll to the top of the document
	 */
	public async scrollToTop() {
		const platform = process.platform;

		if (platform === 'win32' || platform === 'linux') {
			await this.code.driver.page.keyboard.press('Home');
		} else {
			await this.pressHotKeys(`Cmd+ArrowUp`);
		}
	}

	/**
	 * Switch to the tab on the left
	 */
	public async switchTabLeft() {
		await this.pressHotKeys(`Cmd+Shift+[`);
	}

	/**
	 * Switch to the tab on the right
	 */
	public async switchTabRight() {
		await this.pressHotKeys(`Cmd+Shift+]`);
	}

	// ------------------------
	// --- Console & Visuals ---
	// ------------------------
	/**
	 * Focus the console
	 */
	public async focusConsole() {
		await this.pressHotKeys(`Cmd+K F`);
	}

	/**
	 * Switch to visual mode
	 */
	public async visualMode() {
		await this.pressHotKeys(`Cmd+Shift+F4`);
	}

	// ----------------------
	// --- Layout Views ---
	// ----------------------
	/**
	 * Toggle the sidebar visibility
	 */
	public async showSecondarySidebar() {
		await this.pressHotKeys(`Cmd+J B`);
	}

	public async hideSecondarySidebar() {
		await this.pressHotKeys(`Cmd+J A`);
	}

	// ----------------------
	// --- Workspace Actions ---
	// ----------------------
	/**
	 * Close the current workspace
	 */
	public async closeWorkspace() {
		await this.pressHotKeys(`Cmd+J W`);
	}

	/**
	 * Import settings
	 */
	public async importSettings() {
		await this.pressHotKeys(`Cmd+J I`);
	}

	/**
	 * Add a tag to a Jupyter cell
	 */
	public async jupyterCellAddTag() {
		await this.pressHotKeys(`Cmd+J J`);
	}

	/**
	 * Create a new folder from template
	 */
	public async newFolderFromTemplate() {
		await this.pressHotKeys(`Cmd+J F`);
	}

	/**
	 * Open user settings JSON
	 */
	public async openUserSettingsJSON() {
		await this.pressHotKeys(`Cmd+J U`);
	}

	/**
	 * Open workspace settings JSON
	 */
	public async openWorkspaceSettingsJSON() {
		await this.pressHotKeys(`Cmd+J K`);
	}

	/**
	 * Reload the window
	 */
	public async reloadWindow() {
		await this.pressHotKeys(`Cmd+R R`);
	}

	/**
	 * Open the welcome walkthrough
	 */
	public async welcomeWalkthrough() {
		await this.pressHotKeys(`Cmd+J L`);
	}

	/**
	 * Press the hotkeys.
	 * Note: Supports multiple key sequences separated by spaces.
	 * @param keyCombo the hotkeys to press (e.g. "Cmd+Shift+P").
	 */
	private async pressHotKeys(keyCombo: string) {
		const stepWrapper = (label: string, fn: () => Promise<void>) => {
			try {
				// Check if running in a test context
				if (test.info().title) {
					return test.step(label, fn); // Use test.step if inside a test
				}
			} catch (e) {
				// Catch errors if not in a test context
			}
			return fn(); // Run directly if not in a test
		};

		const modifierKey = this.getModifierKey();

		await stepWrapper(`Press hotkeys: ${keyCombo}`, async () => {
			// Replace "Cmd" with the platform-appropriate modifier key
			// and (for Windows and Ubuntu) replace "Option" with "Alt"
			const keySequences = keyCombo.split(' ').map(keys => {
				return keys
					.replace(/cmd/gi, modifierKey)
					.replace(/option/gi, process.platform !== 'darwin' ? 'Alt' : 'Option');
			});

			for (const key of keySequences) {
				await this.code.driver.page.keyboard.press(key);
			}
		});
	}
}
