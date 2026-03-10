"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsFile = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const BACKUP_SUFFIX = '.playwright-backup';
class SettingsFile {
    settingsPath;
    constructor(settingsPath) {
        this.settingsPath = settingsPath;
    }
    async exists() {
        try {
            await fs_1.promises.access(this.settingsPath);
            return true;
        }
        catch {
            return false;
        }
    }
    async ensureExists() {
        if (!(await this.exists())) {
            await this.append({});
        }
    }
    async backupIfExists() {
        const backupPath = `${this.settingsPath}${BACKUP_SUFFIX}`;
        if (await this.exists()) {
            await fs_1.promises.copyFile(this.settingsPath, backupPath);
        }
    }
    async delete() {
        try {
            await fs_1.promises.unlink(this.settingsPath);
        }
        catch {
            // do nothing
        }
    }
    async restoreFromBackup() {
        const backupPath = `${this.settingsPath}${BACKUP_SUFFIX}`;
        try {
            await fs_1.promises.access(backupPath);
            await fs_1.promises.copyFile(backupPath, this.settingsPath);
            await fs_1.promises.unlink(backupPath);
        }
        catch {
            await this.delete();
        }
    }
    async append(settings) {
        await fs_1.promises.mkdir(path_1.default.dirname(this.settingsPath), { recursive: true });
        let existingContent = {};
        let fileExists = await this.exists();
        if (fileExists) {
            try {
                const fileContent = await fs_1.promises.readFile(this.settingsPath, 'utf-8');
                if (fileContent.trim()) {
                    existingContent = JSON.parse(fileContent);
                }
            }
            catch (error) {
                fileExists = false;
            }
        }
        const mergedContent = { ...existingContent, ...settings };
        await fs_1.promises.writeFile(this.settingsPath, JSON.stringify(mergedContent, null, 2), 'utf-8');
    }
    /**
     * Returns the path to the VS Code user settings file for the current platform/user.
     */
    static getVSCodeSettingsPath() {
        const home = os_1.default.homedir();
        const platform = process.platform;
        if (platform === 'win32') {
            if (process.env.APPDATA) {
                return path_1.default.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
            }
            else if (process.env.USERPROFILE) {
                return path_1.default.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
            }
            else {
                return path_1.default.join(home, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
            }
        }
        else if (platform === 'darwin') {
            return path_1.default.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
        }
        else {
            const configHome = process.env.XDG_CONFIG_HOME || path_1.default.join(home, '.config');
            return path_1.default.join(configHome, 'Code', 'User', 'settings.json');
        }
    }
}
exports.SettingsFile = SettingsFile;
//# sourceMappingURL=settingsFile.js.map