/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const BACKUP_SUFFIX = '.playwright-backup';

export class SettingsFileManager {
	private readonly settingsPath: string;

	constructor(settingsPath: string) {
		this.settingsPath = settingsPath;
	}

	public async exists(): Promise<boolean> {
		try {
			await fs.access(this.settingsPath);
			return true;
		} catch {
			return false;
		}
	}

	public async ensureExists(): Promise<void> {
		if (!(await this.exists())) {
			await this.append({});
		}
	}

	public async backupIfExists(): Promise<void> {
		const backupPath = `${this.settingsPath}${BACKUP_SUFFIX}`;

		if (await this.exists()) {
			await fs.copyFile(this.settingsPath, backupPath);
		}
	}

	public async delete(): Promise<void> {
		try {
			await fs.unlink(this.settingsPath);
		} catch {
			// do nothing
		}
	}

	public async restoreFromBackup(): Promise<void> {
		const backupPath = `${this.settingsPath}${BACKUP_SUFFIX}`;

		try {
			await fs.access(backupPath);
			await fs.copyFile(backupPath, this.settingsPath);
			await fs.unlink(backupPath);
		} catch {
			await this.delete();
		}
	}

	/**
	 * Appends settings object to the settings file by merging with existing settings
	 */
	public async append(settings: object): Promise<void> {
		const existingContent = await this.readFileContent({});
		const mergedContent = { ...existingContent, ...settings };
		await this.writeFileContent(mergedContent);
	}

	/**
	 * Appends keybindings to the keybindings file which is stored as an array of objects
	 */
	public async appendKeybindings(keybindings: object[]): Promise<void> {
		const existingBindings = await this.readFileContent([] as object[]);
		const mergedBindings = [...existingBindings, ...keybindings];
		await this.writeFileContent(mergedBindings);
	}

	/**
	 * Reads and parses the file content, returning a default value if the file doesn't exist or is empty
	 */
	private async readFileContent<T>(defaultValue: T): Promise<T> {
		await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });

		let content = defaultValue;
		const fileExists = await this.exists();

		if (fileExists) {
			try {
				const fileContent = await fs.readFile(this.settingsPath, 'utf-8');
				if (fileContent.trim()) {
					content = JSON.parse(fileContent);
				}
			} catch (error) {
				// If reading or parsing fails, use the default value
			}
		}

		return content;
	}

	/**
	 * Writes content to the file as formatted JSON
	 */
	private async writeFileContent(content: any): Promise<void> {
		await fs.writeFile(this.settingsPath, JSON.stringify(content, null, 2), 'utf-8');
	}

	/**
	 * Returns the path to the VS Code user settings file for the current platform/user.
	 */
	static getVSCodeSettingsPath(): string {
		const home = os.homedir();
		const platform = process.platform;
		if (platform === 'win32') {
			if (process.env.APPDATA) {
				return path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
			} else if (process.env.USERPROFILE) {
				return path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
			} else {
				return path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
			}
		} else if (platform === 'darwin') {
			return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
		} else {
			const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
			return path.join(configHome, 'Code', 'User', 'settings.json');
		}
	}

	/**
	 * Returns the path to the Positron user settings file for the given userDataDir.
	 */
	static getPositronSettingsPath(userDataDir: string): string {
		return path.join(userDataDir, 'User', 'settings.json');
	}

	/**
	 * Returns the path to the VS Code keybindings file for the current platform/user.
	 */
	static getKeyBindingsPath(userDataDir: string, projectName: string): string {
		return projectName.includes('browser')
			? path.join(userDataDir, 'data', 'User', 'keybindings.json')
			: path.join(userDataDir, 'User', 'keybindings.json');
	}
}
