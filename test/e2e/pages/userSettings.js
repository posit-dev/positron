"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserSettings = exports.USER_SETTINGS_FILENAME = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const test_1 = require("@playwright/test");
exports.USER_SETTINGS_FILENAME = 'settings.json';
class UserSettings {
    code;
    hotKeys;
    settingsPath;
    settingsFilePath;
    constructor(code, hotKeys) {
        this.code = code;
        this.hotKeys = hotKeys;
        this.settingsPath = process.env.PLAYWRIGHT_USER_DATA_DIR || 'missing PLAYWRIGHT_USER_DATA_DIR environment variable';
        this.settingsFilePath = path_1.default.join(this.settingsPath, exports.USER_SETTINGS_FILENAME);
    }
    /**
     * Sets the provided settings by merging with existing settings.
     * @param settings Object with key-value pairs to set
     */
    async mergeSetting(settings) {
        await fs_1.promises.mkdir(path_1.default.dirname(this.settingsPath), { recursive: true });
        let existingContent = {};
        try {
            const fileContent = await fs_1.promises.readFile(this.settingsFilePath, 'utf-8');
            if (fileContent.trim()) {
                existingContent = JSON.parse(fileContent);
            }
        }
        catch { }
        const mergedContent = { ...existingContent, ...settings };
        await fs_1.promises.writeFile(this.settingsFilePath, JSON.stringify(mergedContent, null, 2), 'utf-8');
    }
    /**
     * Removes the specified keys from the settings.
     * @param keysToRemove Array of keys to remove
     */
    async remove(keysToRemove) {
        let currentSettings = {};
        try {
            const fileContent = await fs_1.promises.readFile(this.settingsFilePath, 'utf-8');
            if (fileContent.trim()) {
                currentSettings = JSON.parse(fileContent);
            }
        }
        catch { }
        for (const key of keysToRemove) {
            delete currentSettings[key];
        }
        await fs_1.promises.writeFile(this.settingsFilePath, JSON.stringify(currentSettings, null, 2), 'utf-8');
    }
    /**
     * Gets all user settings as an object.
     */
    async getSettings() {
        try {
            const fileContent = await fs_1.promises.readFile(this.settingsFilePath, 'utf-8');
            if (fileContent.trim()) {
                return JSON.parse(fileContent);
            }
        }
        catch { }
        return {};
    }
    /**
     * Clears all settings (resets to empty object).
     */
    async clear() {
        await fs_1.promises.mkdir(path_1.default.dirname(this.settingsPath), { recursive: true });
        await fs_1.promises.writeFile(this.settingsFilePath, '{}', 'utf-8');
    }
    /**
     * Backs up the current settings as a string.
     */
    async backup() {
        try {
            return await fs_1.promises.readFile(this.settingsFilePath, 'utf-8');
        }
        catch {
            return '';
        }
    }
    /**
     * Restores the settings from a string.
     * @param settings The settings JSON string
     */
    async restore(settings) {
        await fs_1.promises.mkdir(path_1.default.dirname(this.settingsPath), { recursive: true });
        await fs_1.promises.writeFile(this.settingsFilePath, settings.trim(), 'utf-8');
    }
    /**
     * Write settings to disk, then open/save/close the file in the editor to trigger reload.
     * @param settings Object with key-value pairs to set
     * @param editor An object with openTab, save, and closeTab methods for UI automation
     */
    async set(settings, options) {
        const { keepOpen = true } = options || {};
        await this.mergeSetting(settings);
        await this.hotKeys.openUserSettingsJSON();
        await (0, test_1.expect)(this.code.driver.currentPage.getByRole('tab', { name: exports.USER_SETTINGS_FILENAME })).toBeVisible();
        await this.hotKeys.save();
        if (!keepOpen) {
            await this.hotKeys.closeTab();
        }
    }
}
exports.UserSettings = UserSettings;
//# sourceMappingURL=userSettings.js.map