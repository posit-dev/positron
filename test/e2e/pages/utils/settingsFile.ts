/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const BACKUP_SUFFIX = '.playwright-backup';

export class SettingsFile {
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

	public async append(settings: object): Promise<void> {
		await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });

		let existingContent = {};
		let fileExists = await this.exists();

		if (fileExists) {
			try {
				const fileContent = await fs.readFile(this.settingsPath, 'utf-8');
				if (fileContent.trim()) {
					existingContent = JSON.parse(fileContent);
				}
			} catch (error) {
				fileExists = false;
			}
		}

		const mergedContent = { ...existingContent, ...settings };
		await fs.writeFile(this.settingsPath, JSON.stringify(mergedContent, null, 2), 'utf-8');
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
}
