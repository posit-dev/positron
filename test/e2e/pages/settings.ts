/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Clipboard } from './clipboard';
import { Code } from '../infra/code';
import { Editor } from './editor';
import { Editors } from './editors';
import { QuickAccess } from './quickaccess';

export class Settings {

	constructor(private code: Code, private editors: Editors, private editor: Editor, private quickaccess: QuickAccess, private clipboard: Clipboard) { }

	async addUserSettings(settings: [key: string, value: string][]): Promise<void> {
		await this.openUserSettingsFile();
		const file = 'settings.json';
		await this.editors.saveOpenedFile();
		await this.code.driver.page.keyboard.press('ArrowRight');
		await this.editor.waitForTypeInEditor(file, settings.map(v => `"${v[0]}": ${v[1]},`).join(''));
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(file);
		// Wait for the settings to be applied. I ran into this specifically with Chromium locally but it seems fine in CI :shrug:
		await this.code.driver.page.waitForTimeout(1000);
	}

	async clearUserSettings(): Promise<void> {
		await this.openUserSettingsFile();
		const file = 'settings.json';
		await this.quickaccess.runCommand('editor.action.selectAll');
		await this.code.driver.page.keyboard.press('Delete');
		await this.editor.waitForTypeInEditor(file, `{`); // will auto close }
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(file);
		await this.quickaccess.runCommand('workbench.action.closeActiveEditor');
	}

	async openUserSettingsFile(): Promise<void> {
		await this.quickaccess.runCommand('workbench.action.openSettingsJson');
		await this.editor.waitForEditorFocus('settings.json', 1);
	}

	// Open the workspace settings JSON file
	async openWorkspaceSettingsFile(): Promise<void> {
		await this.quickaccess.runCommand('workbench.action.openWorkspaceSettingsFile');
		await this.editor.waitForEditorFocus('settings.json', 1);
	}

	// Read all settings in settings.json into an array of key-value pairs
	async getWorkspaceSettings(): Promise<[key: string, value: string][]> {
		await this.openWorkspaceSettingsFile();

		// Select all content and copy to clipboard
		await this.quickaccess.runCommand('editor.action.selectAll');
		await this.quickaccess.runCommand('editor.action.clipboardCopyAction');

		// Retrieve clipboard contents
		const rawText = await this.clipboard.getClipboardText();
		if (!rawText) {
			return [];
		}

		// Clean up the JSON string
		let cleanedText = rawText.trim();

		// Remove trailing commas before parsing (fixes invalid JSON issue)
		cleanedText = cleanedText.replace(/,\s*([\]}])/g, '$1');

		// Parse JSON safely
		try {
			const json = JSON.parse(cleanedText);
			return Object.entries(json) as [string, string][];
		} catch (e) {
			console.error('Error parsing workspace settings:', e);
			return [];
		}
	}

	// Remove specific settings from the workspace settings
	async removeWorkspaceSettings(keysToRemove: string[]): Promise<void> {
		const settings = await this.getWorkspaceSettings();
		const updatedSettings = settings.filter(([key]) => !keysToRemove.includes(key));

		// Convert back to JSON
		const newSettingsJson = `{ ${updatedSettings.map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ')} }`;

		// Clear the file and write new settings
		await this.openWorkspaceSettingsFile();
		const file = 'settings.json';
		await this.quickaccess.runCommand('editor.action.selectAll');
		await this.code.driver.page.keyboard.press('Delete');
		await this.editor.waitForTypeInEditor(file, newSettingsJson);
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(file);
		await this.quickaccess.runCommand('workbench.action.closeActiveEditor');
	}

	// Backup current workspace settings
	async backupWorkspaceSettings(): Promise<string> {
		await this.openWorkspaceSettingsFile();

		// Select all content and copy to clipboard
		await this.quickaccess.runCommand('editor.action.selectAll');
		await this.quickaccess.runCommand('editor.action.clipboardCopyAction');

		const clipboardText = await this.clipboard.getClipboardText();
		return clipboardText ?? '';
	}

	// Restore original workspace settings
	async restoreWorkspaceSettings(settings: string): Promise<void> {
		await this.openWorkspaceSettingsFile();
		const file = 'settings.json';

		// Clear current file
		await this.quickaccess.runCommand('editor.action.selectAll');
		await this.code.driver.page.keyboard.press('Delete');

		// Copy original settings to clipboard
		await this.clipboard.setClipboardText(settings.trim());

		// Paste clipboard contents into the editor
		await this.quickaccess.runCommand('editor.action.clipboardPasteAction');

		// Save and close
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(file);
		await this.quickaccess.runCommand('workbench.action.closeActiveEditor');
	}
}
