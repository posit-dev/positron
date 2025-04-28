/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import path from 'path';

const BACKUP_SUFFIX = '.playwright-backup';

export class UserSettingsFileManager {
	private readonly settingsPath: string;
	private readonly writeDefaults: () => object;

	constructor(settingsPath: string, writeDummySettings: () => object) {
		this.settingsPath = settingsPath;
		this.writeDefaults = writeDummySettings;
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
			await this.writeDummy();
		}
	}

	public async backupIfExists(): Promise<void> {
		const backupPath = `${this.settingsPath}${BACKUP_SUFFIX}`;

		if (await this.exists()) {
			await fs.copyFile(this.settingsPath, backupPath);
			console.log(`📦 Backed up settings to: ${backupPath}`);
		} else {
			console.log(`ℹ️ No settings to back up`);
		}
	}

	public async writeDummy(): Promise<void> {
		await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
		await fs.writeFile(this.settingsPath, JSON.stringify(this.writeDefaults(), null, 2), 'utf-8');
		console.log(`✅ Wrote dummy settings: ${this.settingsPath}`);
	}

	public async delete(): Promise<void> {
		try {
			await fs.unlink(this.settingsPath);
			console.log(`❌ Deleted settings file: ${this.settingsPath}`);
		} catch {
			console.log(`ℹ️ No settings file to delete`);
		}
	}

	public async restoreFromBackup(): Promise<void> {
		const backupPath = `${this.settingsPath}${BACKUP_SUFFIX}`;

		try {
			await fs.access(backupPath);
			await fs.copyFile(backupPath, this.settingsPath);
			await fs.unlink(backupPath);
			console.log(`♻️ Restored settings from backup: ${backupPath}`);
		} catch {
			console.log(`ℹ️ No backup found, nothing to restore`);
		}
	}
}
