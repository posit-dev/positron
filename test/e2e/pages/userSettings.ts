/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import path from 'path';
import { HotKeys } from './hotKeys.js';
import { Code } from '../infra/code';
import { expect } from '@playwright/test';

export const USER_SETTINGS_FILENAME = 'settings.json';

export class UserSettings {
	private readonly settingsPath: string;
	private readonly settingsFilePath: string;

	constructor(private code: Code, private hotKeys: HotKeys) {
		this.settingsPath = process.env.PLAYWRIGHT_USER_DATA_DIR || 'missing PLAYWRIGHT_USER_DATA_DIR environment variable';
		this.settingsFilePath = path.join(this.settingsPath, USER_SETTINGS_FILENAME);
	}

	/**
	 * Sets the provided settings by merging with existing settings.
	 * @param settings Object with key-value pairs to set
	 */
	async mergeSetting(settings: Record<string, unknown>): Promise<void> {
		await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
		let existingContent = {};
		try {
			const fileContent = await fs.readFile(this.settingsFilePath, 'utf-8');
			if (fileContent.trim()) {
				existingContent = JSON.parse(fileContent);
			}
		} catch { }
		const mergedContent = { ...existingContent, ...settings };
		await fs.writeFile(this.settingsFilePath, JSON.stringify(mergedContent, null, 2), 'utf-8');
	}

	/**
	 * Removes the specified keys from the settings.
	 * @param keysToRemove Array of keys to remove
	 */
	async remove(keysToRemove: string[]): Promise<void> {
		let currentSettings = {};
		try {
			const fileContent = await fs.readFile(this.settingsFilePath, 'utf-8');
			if (fileContent.trim()) {
				currentSettings = JSON.parse(fileContent);
			}
		} catch { }
		for (const key of keysToRemove) {
			delete currentSettings[key];
		}
		await fs.writeFile(this.settingsFilePath, JSON.stringify(currentSettings, null, 2), 'utf-8');
	}

	/**
	 * Gets all user settings as an object.
	 */
	async getSettings(): Promise<Record<string, unknown>> {
		try {
			const fileContent = await fs.readFile(this.settingsFilePath, 'utf-8');
			if (fileContent.trim()) {
				return JSON.parse(fileContent);
			}
		} catch { }
		return {};
	}

	/**
	 * Clears all settings (resets to empty object).
	 */
	async clear(): Promise<void> {
		await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
		await fs.writeFile(this.settingsFilePath, '{}', 'utf-8');
	}

	/**
	 * Backs up the current settings as a string.
	 */
	async backup(): Promise<string> {
		try {
			return await fs.readFile(this.settingsFilePath, 'utf-8');
		} catch {
			return '';
		}
	}

	/**
	 * Restores the settings from a string.
	 * @param settings The settings JSON string
	 */
	async restore(settings: string): Promise<void> {
		await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
		await fs.writeFile(this.settingsFilePath, settings.trim(), 'utf-8');
	}

	/**
	 * Write settings to disk, then open/save/close the file in the editor to trigger reload.
	 * @param settings Object with key-value pairs to set
	 * @param editor An object with openTab, save, and closeTab methods for UI automation
	 */
	async set(settings: Record<string, unknown>, options?: { keepOpen: boolean }): Promise<void> {
		const { keepOpen = true } = options || {};

		await this.mergeSetting(settings);
		await this.hotKeys.openUserSettingsJSON();
		await expect(this.code.driver.page.getByRole('tab', { name: USER_SETTINGS_FILENAME })).toBeVisible();
		await this.hotKeys.save();
		if (!keepOpen) {
			await this.hotKeys.closeTab();
		}
	}
}
