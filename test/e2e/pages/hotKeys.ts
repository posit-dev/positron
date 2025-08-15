/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';
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

	public async copy() {
		await this.pressHotKeys('Cmd+C');
	}

	public async cut() {
		await this.pressHotKeys('Cmd+X');
	}

	public async paste() {
		await this.pressHotKeys('Cmd+V');
	}

	public async redo() {
		await this.pressHotKeys('Cmd+Shift+Z');
	}

	public async selectAll() {
		await this.pressHotKeys('Cmd+A');
	}

	public async undo() {
		await this.pressHotKeys('Cmd+Z');
	}

	// ------------------------
	// --- Notebook Actions ---
	// ------------------------

	public async executeNotebookCell() {
		await this.pressHotKeys('Shift+Enter', 'Execute notebook cell');
	}

	public async runFileInConsole() {
		await this.pressHotKeys('Cmd+Shift+Enter', 'Run file in console');
	}

	// --------------------
	// --- File Actions ---
	// --------------------

	public async openFile() {
		await this.pressHotKeys('Cmd+O');
	}

	public async save() {
		await this.pressHotKeys('Cmd+S');
	}

	// -------------------------
	// --- Find & Navigation ---
	// -------------------------

	public async closeAllEditors() {
		await this.pressHotKeys('Cmd+K Cmd+W', 'Close all editors');
	}

	public async closeTab() {
		await this.pressHotKeys('Cmd+W', 'Close current tab');
	}

	public async find() {
		await this.pressHotKeys('Cmd+F', 'Find');
	}

	public async firstTab() {
		await this.pressHotKeys('Cmd+1', 'Switch to first tab');
	}

	public async scrollToTop() {
		const platform = process.platform;

		if (platform === 'win32' || platform === 'linux') {
			await this.code.driver.page.keyboard.press('Home');
		} else {
			await this.pressHotKeys('Cmd+ArrowUp', 'Scroll to top');
		}
	}

	public async switchTabLeft() {
		await this.pressHotKeys('Cmd+Shift+[', 'Switch tab left');
	}

	public async switchTabRight() {
		await this.pressHotKeys('Cmd+Shift+]', 'Switch tab right');
	}

	// ------------------------
	// --- Console & Visuals ---
	// ------------------------

	public async focusConsole() {
		await this.pressHotKeys('Cmd+K F', 'Focus console');
	}

	public async visualMode() {
		await this.pressHotKeys('Cmd+Shift+F4', 'Visual mode');
	}

	public executeCodeInConsole() {
		return this.pressHotKeys('Cmd+J O', 'Execute code in console');
	}

	// ----------------------
	// --- Layout Views ---
	// ----------------------

	public async showSecondarySidebar() {
		await this.pressHotKeys('Cmd+J B', 'Show secondary sidebar');
	}

	public async closeSecondarySidebar() {
		await this.pressHotKeys('Cmd+J A', 'Hide secondary sidebar');
	}

	public async fullSizeSecondarySidebar() {
		await this.pressHotKeys('Cmd+J G', 'Full size secondary sidebar');
	}

	public async stackedLayout() {
		await this.pressHotKeys('Cmd+J H', 'Stacked layout');
	}

	public async toggleBottomPanel() {
		await this.pressHotKeys('Cmd+J C', 'Toggle bottom panel');
	}

	public async notebookLayout() {
		await this.pressHotKeys('Cmd+J N', 'Notebook layout');
	}

	public async closePrimarySidebar() {
		await this.pressHotKeys('Cmd+B C', 'Close primary sidebar');
	}

	public async minimizeBottomPanel() {
		await this.pressHotKeys('Cmd+J P', 'Minimize bottom panel');
	}

	// -------------------------
	// --- Workspace Actions ---
	// -------------------------

	public async closeWorkspace() {
		await this.pressHotKeys('Cmd+J W');
		await expect(this.code.driver.page.locator('.explorer-folders-view')).not.toBeVisible();
	}

	public async importSettings() {
		await this.pressHotKeys('Cmd+J I', 'Import settings');
	}

	public async jupyterCellAddTag() {
		await this.pressHotKeys('Cmd+J J', 'Add Jupyter cell tag');
	}

	public async newFolderFromTemplate() {
		await this.pressHotKeys('Cmd+J F', 'New folder from template');
	}

	public async openUserSettingsJSON() {
		await this.pressHotKeys('Cmd+J U', 'Open user settings JSON');
	}

	public async openWorkspaceSettingsJSON() {
		await this.pressHotKeys('Cmd+J K', 'Open workspace settings JSON');
	}

	public async reloadWindow() {
		await this.pressHotKeys('Cmd+R R', 'Reload window');
	}

	public async openWelcomeWalkthrough() {
		await this.pressHotKeys('Cmd+J L', 'Open welcome walkthrough');
	}

	public async resetWelcomeWalkthrough() {
		await this.pressHotKeys('Cmd+J X', 'Reset welcome walkthrough');
	}

	public async openFolder() {
		await this.pressHotKeys('Cmd+J Q', 'Open Folder');
	}

	// -----------------------
	// ---  Data Explorer  ---
	// -----------------------

	public async showDataExplorerSummaryPanel() {
		await this.pressHotKeys('Cmd+J Y', 'Expand/show the Summary Panel in DE');
	}

	public async hideDataExplorerSummaryPanel() {
		await this.pressHotKeys('Cmd+J Z', 'Collapse/hide the Summary Panel in DE');
	}

	/**
	 * Press the hotkeys.
	 * Note: Supports multiple key sequences separated by spaces.
	 * @param keyCombo the hotkeys to press (e.g. "Cmd+Shift+P").
	 */
	private async pressHotKeys(keyCombo: string, description?: string): Promise<void> {
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
		const stepDescription = description
			? `Shortcut: ${description}`
			: `Press hotkeys: ${keyCombo}`;

		await stepWrapper(stepDescription, async () => {
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
