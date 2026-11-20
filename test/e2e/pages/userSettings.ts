/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
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

	// A server in a container (Workbench) reads its own settings file there, not the
	// host's. Its fixture names that file as "<container>:<path>".
	private containerSettingsFile(): { container: string; file: string } | undefined {
		const target = process.env.PLAYWRIGHT_CONTAINER_USER_SETTINGS;
		if (!target) {
			return undefined;
		}
		const separator = target.indexOf(':');
		return { container: target.slice(0, separator), file: target.slice(separator + 1) };
	}

	private async readSettingsFile(): Promise<string> {
		const target = this.containerSettingsFile();
		if (!target) {
			return fs.readFile(this.settingsFilePath, 'utf-8');
		}
		return new Promise<string>((resolve, reject) => {
			execFile('docker', ['exec', target.container, 'cat', target.file], (error, stdout) => error ? reject(error) : resolve(stdout));
		});
	}

	private async writeSettingsFile(content: string): Promise<void> {
		const target = this.containerSettingsFile();
		if (!target) {
			await fs.mkdir(this.settingsPath, { recursive: true });
			await fs.writeFile(this.settingsFilePath, content, 'utf-8');
			return;
		}
		// Through stdin, so the file keeps the owner and mode its fixture gave it.
		await new Promise<void>((resolve, reject) => {
			const child = execFile('docker', ['exec', '-i', target.container, 'tee', target.file], error => error ? reject(error) : resolve());
			child.stdin?.end(content);
		});
	}

	/**
	 * Sets the provided settings by merging with existing settings.
	 * @param settings Object with key-value pairs to set
	 */
	async mergeSetting(settings: Record<string, unknown>): Promise<void> {
		let existingContent = {};
		try {
			const fileContent = await this.readSettingsFile();
			if (fileContent.trim()) {
				existingContent = JSON.parse(fileContent);
			}
		} catch { }
		const mergedContent = { ...existingContent, ...settings };
		await this.writeSettingsFile(JSON.stringify(mergedContent, null, 2));
	}

	/**
	 * Removes the specified keys from the settings.
	 * @param keysToRemove Array of keys to remove
	 */
	async remove(keysToRemove: string[]): Promise<void> {
		let currentSettings = {};
		try {
			const fileContent = await this.readSettingsFile();
			if (fileContent.trim()) {
				currentSettings = JSON.parse(fileContent);
			}
		} catch { }
		for (const key of keysToRemove) {
			delete currentSettings[key];
		}
		await this.writeSettingsFile(JSON.stringify(currentSettings, null, 2));
	}

	/**
	 * Gets all user settings as an object.
	 */
	async getSettings(): Promise<Record<string, unknown>> {
		try {
			const fileContent = await this.readSettingsFile();
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
		await this.writeSettingsFile('{}');
	}

	/**
	 * Backs up the current settings as a string.
	 */
	async backup(): Promise<string> {
		try {
			return await this.readSettingsFile();
		} catch {
			return '';
		}
	}

	/**
	 * Restores the settings from a string.
	 * @param settings The settings JSON string
	 */
	async restore(settings: string): Promise<void> {
		await this.writeSettingsFile(settings.trim());
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
		const page = this.code.driver.currentPage;
		const tab = page.getByRole('tab', { name: USER_SETTINGS_FILENAME });
		// Without the smoke-test flag (Workbench) the file opens in a modal editor, which has no tab.
		const modal = page.getByRole('dialog', { name: /settings\.json$/ });
		await expect(tab.or(modal)).toBeVisible();
		await this.hotKeys.save();
		if (await modal.isVisible()) {
			// A modal editor covers the workbench, so it never stays open.
			await modal.getByRole('button', { name: /Close Modal Editor/ }).click();
			await expect(modal).toHaveCount(0);
		} else if (!keepOpen) {
			await this.hotKeys.closeTab();
		}
	}
}
