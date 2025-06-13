/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Clipboard } from './clipboard';
import { Code } from '../infra/code';
import { Editor } from './editor';
import { Editors } from './editors';
import { HotKeys } from './hotKeys.js';

export type Setting = [key: string, value: string];
const FILENAME = 'settings.json';

export class UserSettings {

	constructor(private code: Code, private editors: Editors, private editor: Editor, private clipboard: Clipboard, private hotKeys: HotKeys) { }

	// --- User Settings Methods ---

	async openSettings(): Promise<void> {
		await this.hotKeys.openUserSettingsJSON();
	}

	async set(settings: Setting[]): Promise<void> {
		await this.openSettings();

		// Get the current content
		await this.hotKeys.selectAll();
		await this.hotKeys.copy();
		const currentContent = await this.clipboard.getClipboardText() || '{}';

		// Parse the current content
		let currentSettings;
		let cleanedContent;
		try {
			// Clean up the JSON string by removing trailing commas
			cleanedContent = currentContent.replace(/,\s*([\]}])/g, '$1');
			currentSettings = JSON.parse(cleanedContent);
		} catch (e) {
			console.error('Error parsing settings:', e);
			console.error('Actual content:', cleanedContent);
			currentSettings = {};
		}

		// Add the new settings
		for (const [key, value] of settings) {
			try {
				// Try to parse the value as JSON if it's not already parsed
				currentSettings[key] = typeof value === 'string' &&
					(value.startsWith('"') || value.startsWith('{') ||
						value.startsWith('[') || value === 'true' ||
						value === 'false' || !isNaN(Number(value))) ?
					JSON.parse(value) : value;
			} catch {
				// If parsing fails, use the value as is
				currentSettings[key] = value;
			}
		}

		// Convert back to properly formatted JSON
		const updatedContent = JSON.stringify(currentSettings, null, 2);

		// Replace the entire content
		await this.hotKeys.selectAll();
		await this.clipboard.setClipboardText(updatedContent);
		await this.hotKeys.paste();

		// Save and wait for changes to be applied
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(FILENAME);
		// Wait for the settings to be applied
		await this.code.driver.page.waitForTimeout(2000);
		await this.hotKeys.closeTab();
	}

	async remove(keysToRemove: string[]): Promise<void> {
		const settings = await this.getSettings();
		const updatedSettings = settings.filter(([key]) => !keysToRemove.includes(key));

		// Convert back to JSON
		const newSettingsJson = `{ ${updatedSettings.map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ')} }`;

		// Clear the file and write new settings
		await this.openSettings();
		const file = 'settings.json';
		await this.hotKeys.selectAll();
		await this.code.driver.page.keyboard.press('Delete');
		await this.editor.selectTabAndType(file, newSettingsJson);
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(file);
		await this.hotKeys.closeTab();
	}

	// Read all settings in settings.json into an array of key-value pairs
	async getSettings(): Promise<[key: string, value: string][]> {
		await this.openSettings();

		// Select all content and copy to clipboard
		await this.hotKeys.selectAll();
		await this.hotKeys.copy();

		// Retrieve clipboard contents
		const rawText = await this.clipboard.getClipboardText();
		if (!rawText) {
			await this.hotKeys.closeTab();
			return [];
		}

		// Clean up the JSON string
		let cleanedText = rawText.trim();

		// Remove trailing commas before parsing (fixes invalid JSON issue)
		cleanedText = cleanedText.replace(/,\s*([\]}])/g, '$1');

		// Parse JSON safely
		try {
			const json = JSON.parse(cleanedText);
			await this.hotKeys.closeTab();
			return Object.entries(json) as [string, string][];
		} catch (e) {
			console.error('Error parsing workspace settings:', e);
			await this.hotKeys.closeTab();
			return [];
		}
	}

	async clear(): Promise<void> {
		await this.openSettings();
		const file = 'settings.json';
		await this.hotKeys.selectAll();
		await this.code.driver.page.keyboard.press('Delete');
		await this.editor.type('{', true); // will auto close }
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(file);
		await this.hotKeys.closeTab();
	}

	async backup(): Promise<string> {
		await this.openSettings();

		// Select all content and copy to clipboard
		await this.hotKeys.selectAll();
		await this.hotKeys.copy();
		await this.hotKeys.closeTab();

		const clipboardText = await this.clipboard.getClipboardText();
		return clipboardText ?? '';
	}

	async restore(settings: string): Promise<void> {
		await this.openSettings();

		// Clear current file
		await this.hotKeys.selectAll();
		await this.code.driver.page.keyboard.press('Delete');

		// Copy original settings to clipboard
		await this.clipboard.setClipboardText(settings.trim());

		// Paste clipboard contents into the editor
		await this.hotKeys.paste();

		// Save and close
		await this.editors.saveOpenedFile();
		await this.editors.waitForActiveTabNotDirty(FILENAME);
		await this.hotKeys.closeTab();
	}
}
