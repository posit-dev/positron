"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HotKeys = void 0;
const test_1 = __importStar(require("@playwright/test"));
/**
 * Provides hotkey shortcuts for common operations. References the keybindings defined in `test/e2e/fixtures/keybindings.json`.
 */
class HotKeys {
    code;
    constructor(code) {
        this.code = code;
    }
    getModifierKey() {
        return process.platform === 'darwin' ? 'Meta' : 'Control';
    }
    isExternalBrowser() {
        return (/(8080|8787)/.test(this.code.driver.currentPage.url()));
    }
    // ----------------------
    // --- Editing Actions ---
    // ----------------------
    async copy() {
        await this.pressHotKeys('Cmd+C', 'Copy');
    }
    async cut() {
        await this.pressHotKeys('Cmd+X', 'Cut');
    }
    async paste() {
        await this.pressHotKeys('Cmd+V', 'Paste');
    }
    async redo() {
        await this.pressHotKeys('Cmd+Shift+Z', 'Redo');
    }
    async selectAll() {
        await this.pressHotKeys('Cmd+A', 'Select All');
    }
    async undo() {
        await this.pressHotKeys('Cmd+Z', 'Undo');
    }
    // ------------------------
    // --- Notebook Actions ---
    // ------------------------
    async executeNotebookCell() {
        await this.pressHotKeys('Shift+Enter', 'Execute notebook cell');
    }
    async runFileInConsole() {
        await this.pressHotKeys('Cmd+Shift+Enter', 'Run file in console');
    }
    async runLineOfCode() {
        await this.pressHotKeys('Cmd+Enter', 'Run line of code');
        await this.code.driver.currentPage.waitForTimeout(500); // Wait for the console to process the command
    }
    async selectNotebookKernel() {
        await this.pressHotKeys('Cmd+J D', 'Select notebook kernel');
    }
    async searchInNotebook() {
        await this.pressHotKeys('Cmd+F', 'Search in notebook');
    }
    // --------------------
    // --- File Actions ---
    // --------------------
    async openFile() {
        await this.pressHotKeys('Cmd+O', 'Open File');
    }
    async save() {
        await this.pressHotKeys('Cmd+S', 'Save');
    }
    // ---------------------------
    // --- Command Palette ---
    // ---------------------------
    /**
     * Opens the command palette using a custom keybinding.
     * We use Cmd+J E instead of the default Ctrl+Shift+P because
     * Ctrl+Shift+P opens private browsing in Firefox, blocking
     * cross-browser e2e tests.
     */
    async openCommandPalette() {
        await this.pressHotKeys('Cmd+J E', 'Open Command Palette');
    }
    // -------------------------
    // --- Find & Navigation ---
    // -------------------------
    async closeAllEditors() {
        await this.pressHotKeys('Cmd+K Cmd+W', 'Close all editors');
        if (this.isExternalBrowser()) {
            const dontSaveButton = this.code.driver.currentPage.getByRole('button', { name: 'Don\'t Save' });
            if (await dontSaveButton.isVisible()) {
                await dontSaveButton.click();
            }
        }
    }
    async closeTab() {
        await this.pressHotKeys('Cmd+W', 'Close current tab');
    }
    async find() {
        await this.pressHotKeys('Cmd+F', 'Find');
    }
    async firstTab() {
        await this.pressHotKeys('Cmd+1', 'Switch to first tab');
    }
    async scrollToTop() {
        const platform = process.platform;
        if (platform === 'win32' || platform === 'linux') {
            await this.code.driver.currentPage.keyboard.press('Home');
        }
        else {
            await this.pressHotKeys('Cmd+ArrowUp', 'Scroll to top');
        }
    }
    async switchTabLeft() {
        await this.pressHotKeys('Cmd+Shift+[', 'Switch tab left');
    }
    async switchTabRight() {
        await this.pressHotKeys('Cmd+Shift+]', 'Switch tab right');
    }
    // ------------------------
    // --- Terminal Actions ---
    // ------------------------
    async killAllTerminals() {
        await this.pressHotKeys('Cmd+J T', 'Kill all terminals');
    }
    // ------------------------
    // --- Console & Visuals ---
    // ------------------------
    async focusConsole() {
        await this.pressHotKeys('Cmd+K F', 'Focus console');
    }
    async visualMode() {
        await this.pressHotKeys('Cmd+Shift+F4', 'Visual mode');
    }
    executeCodeInConsole() {
        return this.pressHotKeys('Cmd+J O', 'Execute code in console');
    }
    async sendInterrupt() {
        await this.pressHotKeys('Cmd+C', 'Send interrupt to console');
    }
    // ----------------------
    // --- Layout Views ---
    // ----------------------
    async showSecondarySidebar() {
        await this.pressHotKeys('Cmd+J B', 'Show secondary sidebar');
    }
    async closeSecondarySidebar() {
        await this.pressHotKeys('Cmd+J A', 'Hide secondary sidebar');
    }
    async fullSizeSecondarySidebar() {
        await this.pressHotKeys('Cmd+J G', 'Full size secondary sidebar');
    }
    async stackedLayout() {
        await this.pressHotKeys('Cmd+J H', 'Stacked layout');
    }
    async toggleBottomPanel() {
        await this.pressHotKeys('Cmd+J C', 'Toggle bottom panel');
    }
    async notebookLayout() {
        await this.pressHotKeys('Cmd+J N', 'Notebook layout');
    }
    async closePrimarySidebar() {
        await this.pressHotKeys('Cmd+B C', 'Close primary sidebar');
    }
    async minimizeBottomPanel() {
        await this.pressHotKeys('Cmd+J P', 'Minimize bottom panel');
    }
    async restoreBottomPanel() {
        await this.pressHotKeys('Cmd+J V', 'Restore bottom panel');
    }
    // -------------------------
    // --- Workspace Actions ---
    // -------------------------
    async closeWorkspace() {
        await this.pressHotKeys('Cmd+J W', 'Close workspace');
        await (0, test_1.expect)(this.code.driver.currentPage.locator('.explorer-folders-view')).not.toBeVisible();
    }
    async importSettings() {
        await this.pressHotKeys('Cmd+J I', 'Import settings');
    }
    async jupyterCellAddTag() {
        await this.pressHotKeys('Cmd+J J', 'Add Jupyter cell tag');
    }
    async newFolderFromTemplate() {
        await this.pressHotKeys('Cmd+J F', 'New folder from template');
    }
    async openUserSettingsJSON() {
        await this.pressHotKeys('Cmd+J U', 'Open user settings JSON');
    }
    async openWorkspaceSettingsJSON() {
        await this.pressHotKeys('Cmd+J K', 'Open workspace settings JSON', true);
    }
    async reloadWindow(waitForReady = false) {
        await this.pressHotKeys('Cmd+R R', 'Reload window');
        // wait for workbench to disappear, reappear and be ready
        await this.code.driver.currentPage.waitForTimeout(3000);
        await this.code.driver.currentPage.locator('.monaco-workbench').waitFor({ state: 'visible' });
        if (waitForReady) {
            await (0, test_1.expect)(this.code.driver.currentPage.locator('text=/^Waiting for extensions|^Starting|^Preparing|Reconnecting|^Reactivating|^Discovering( \\w+)? interpreters|starting\\.$/i')).toHaveCount(0, { timeout: 90000 });
        }
    }
    async openWelcomeWalkthrough() {
        await this.pressHotKeys('Cmd+J L', 'Open welcome walkthrough');
    }
    async resetWelcomeWalkthrough() {
        await this.pressHotKeys('Cmd+J X', 'Reset welcome walkthrough');
    }
    async openFolder() {
        await this.pressHotKeys('Cmd+J Q', 'Open Folder');
    }
    // -----------------------
    // ---  Data Explorer  ---
    // -----------------------
    async showDataExplorerSummaryPanel() {
        await this.pressHotKeys('Cmd+J Y', 'Show the DE Summary Panel');
    }
    async hideDataExplorerSummaryPanel() {
        await this.pressHotKeys('Cmd+J Z', 'Hide the DE Summary Panel');
    }
    async showDataExplorerSummaryPanelRight() {
        await this.pressHotKeys('Cmd+J M', 'Show the DE Summary Panel on Right');
    }
    // -----------------------
    // ---  Assistant Actions ---
    // -----------------------
    configureProviders() {
        return this.pressHotKeys('Cmd+L B', 'Configure Language Model Providers');
    }
    // -----------------------
    // ---  Debug Actions  ---
    // -----------------------
    async debugCell() {
        await this.pressHotKeys('Cmd+L A', 'Debugger: Debug Cell');
    }
    async clearAllBreakpoints() {
        await this.pressHotKeys('Cmd+J S', 'Debugger: Clear All Breakpoints');
    }
    // -----------------------
    // ---     Plots       ---
    // -----------------------
    clearPlots() {
        return this.pressHotKeys('Cmd+L C', 'Clear Plots');
    }
    // -----------------------
    // --- Quarto Actions  ---
    // -----------------------
    runCurrentQuartoCell() {
        return this.pressHotKeys('Cmd+L Q', 'Quarto: Run Current Cell');
    }
    runCurrentQuartoCode() {
        return this.pressHotKeys('Cmd+L R', 'Quarto: Run Current Code');
    }
    // -----------------------
    // ---   Formatting	   ---
    // -----------------------
    formatDocument() {
        return this.pressHotKeys('Cmd+L F', 'Format Document');
    }
    // -----------------------
    // ---   Publishing	   ---
    // -----------------------
    publishDocument() {
        return this.pressHotKeys('Cmd+L P', 'Publish Document');
    }
    /**
     * Press the hotkeys.
     * Note: Supports multiple key sequences separated by spaces.
     * @param keyCombo the hotkeys to press (e.g. "Cmd+Shift+P").
     */
    async pressHotKeys(keyCombo, description, needsFocusFirst = false) {
        const stepWrapper = (label, fn) => {
            try {
                // Check if running in a test context
                if (test_1.default.info().title) {
                    return test_1.default.step(label, fn); // Use test.step if inside a test
                }
            }
            catch (e) {
                // Catch errors if not in a test context
            }
            return fn(); // Run directly if not in a test
        };
        const modifierKey = this.getModifierKey();
        const stepDescription = description
            ? `Shortcut: ${description}`
            : `Press hotkeys: ${keyCombo}`;
        await stepWrapper(stepDescription, async () => {
            // For external browser testing, first click on the titlebar to ensure focus
            if (this.isExternalBrowser() && needsFocusFirst) {
                const titlebarDragRegion = this.code.driver.currentPage.locator('.titlebar-drag-region');
                if (await titlebarDragRegion.isVisible()) {
                    await titlebarDragRegion.click();
                }
            }
            // Replace "Cmd" with the platform-appropriate modifier key
            // and (for Windows and Ubuntu) replace "Option" with "Alt"
            const keySequences = keyCombo.split(' ').map(keys => {
                return keys
                    .replace(/cmd/gi, modifierKey)
                    .replace(/option/gi, process.platform !== 'darwin' ? 'Alt' : 'Option');
            });
            // Hacky solution to get shortcut to show up as an action in the trace
            if (!this.code.driver.currentPage.isClosed()) {
                try {
                    await this.code.driver.currentPage.evaluate(msg => {
                    }, `Shortcut: ${description}`);
                }
                catch (e) {
                    // Ignore - context may not be ready after navigation
                }
            }
            for (const key of keySequences) {
                await this.code.driver.currentPage.keyboard.press(key);
            }
        });
    }
}
exports.HotKeys = HotKeys;
//# sourceMappingURL=hotKeys.js.map