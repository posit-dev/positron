"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
exports.Welcome = void 0;
const test_1 = __importStar(require("@playwright/test"));
const LOGO = '.product-logo';
const FOOTER = '.gettingStartedCategoriesContainer div.footer';
const START_SECTION = '.positron-welcome-page-start';
const HELP_TITLE = '.welcome-help-links';
const OPEN_SECTION = '.start-container';
const RECENT_SECTION = '.recently-opened';
const WALKTHROUGH_SECTION = '.getting-started';
const HEADING_ROLE = 'heading';
const BUTTON_ROLE = 'button';
class Welcome {
    code;
    get logo() { return this.code.driver.currentPage.locator(LOGO); }
    get footer() { return this.code.driver.currentPage.locator(FOOTER); }
    get startSection() { return this.code.driver.currentPage.locator(START_SECTION); }
    get startButtons() { return this.startSection.getByRole(BUTTON_ROLE); }
    get helpSection() { return this.code.driver.currentPage.locator(HELP_TITLE); }
    get helpTitle() { return this.helpSection.getByRole(HEADING_ROLE); }
    get helpLinks() { return this.helpSection.getByRole(BUTTON_ROLE); }
    get openSection() { return this.code.driver.currentPage.locator(OPEN_SECTION); }
    get openTitle() { return this.openSection.getByRole(HEADING_ROLE); }
    get openButtons() { return this.openSection.getByRole(BUTTON_ROLE); }
    get recentSection() { return this.code.driver.currentPage.locator(RECENT_SECTION); }
    get recentTitle() { return this.recentSection.getByRole(HEADING_ROLE); }
    get newNotebookButton() { return this.startButtons.getByText('New Notebook'); }
    get newFileButton() { return this.startButtons.getByText('New File'); }
    get newFolderFromTemplateButton() { return this.startButtons.getByText('New Folder'); }
    get openFolderButton() { return this.startButtons.getByText('Open Folder'); }
    get walkthroughSection() { return this.code.driver.currentPage.locator(WALKTHROUGH_SECTION); }
    get walkthroughButtons() { return this.walkthroughSection.getByRole(BUTTON_ROLE); }
    constructor(code) {
        this.code = code;
    }
    async expectLogoToBeVisible() {
        await test_1.default.step('Verify logo is visible', async () => {
            await (0, test_1.expect)(this.logo).toBeVisible();
        });
    }
    async expectFooterToBeVisible() {
        await test_1.default.step('Verify footer is visible', async () => {
            await (0, test_1.expect)(this.footer).toBeVisible();
            await (0, test_1.expect)(this.footer).toHaveText('Show welcome page on startup');
        });
    }
    async expectTabTitleToBe(title) {
        await test_1.default.step(`Verify tab title: ${title}`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.getByRole('tab', { name: title })).toBeVisible();
        });
    }
    async expectConnectToBeVisible(visible) {
        await test_1.default.step(`Verify "Connect to..." is ${visible ? '' : 'NOT'} visible`, async () => {
            const connectButton = this.code.driver.currentPage.getByRole(BUTTON_ROLE, { name: 'Connect to...' });
            if (visible) {
                await (0, test_1.expect)(connectButton).toBeVisible();
            }
            else {
                await (0, test_1.expect)(connectButton).not.toBeVisible();
            }
        });
    }
    async expectStartToContain(startButtons) {
        await test_1.default.step(`Verify start section contains expected buttons: ${startButtons}`, async () => {
            await (0, test_1.expect)(this.startSection).toBeVisible();
            for (const button of startButtons) {
                await (0, test_1.expect)(this.startButtons.filter({ hasText: button })).toBeVisible();
            }
        });
    }
    async expectHelpToContain(helpButtons) {
        await test_1.default.step(`Verify help section contains expected links: ${helpButtons}`, async () => {
            await (0, test_1.expect)(this.helpTitle).toBeVisible();
            await (0, test_1.expect)(this.helpTitle).toHaveText('Help');
            for (const link of helpButtons) {
                await (0, test_1.expect)(this.helpLinks.filter({ hasText: link })).toBeVisible();
            }
        });
    }
    async expectRecentToContain(recentItems) {
        await test_1.default.step(`Verify recent section contains expected items: ${recentItems}`, async () => {
            if (recentItems.length === 0) {
                await (0, test_1.expect)(this.recentSection).toContainText('You have no recent folders,open a folderto start');
                return;
            }
            await (0, test_1.expect)(this.recentSection).toBeVisible();
            await (0, test_1.expect)(this.recentTitle).toHaveText('Recent');
            for (const item of recentItems) {
                await (0, test_1.expect)(this.recentSection.getByRole(BUTTON_ROLE, { name: item })).toBeVisible();
            }
        });
    }
    async expectWalkthroughsToContain(walkthroughs) {
        await test_1.default.step(`Verify walkthrough section contains expected items: ${walkthroughs}`, async () => {
            await (0, test_1.expect)(this.walkthroughSection).toBeVisible();
            await (0, test_1.expect)(this.walkthroughSection).toContainText('Walkthroughs');
            for (const item of walkthroughs) {
                await (0, test_1.expect)(this.walkthroughButtons.filter({ hasText: item })).toBeVisible();
            }
        });
    }
    async expectWalkthroughsToHaveCount(count) {
        await test_1.default.step(`Verify walkthroughs count is ${count}`, async () => {
            const walkthroughs = this.walkthroughSection.getByRole(BUTTON_ROLE);
            await (0, test_1.expect)(walkthroughs).toHaveCount(count);
        });
    }
}
exports.Welcome = Welcome;
//# sourceMappingURL=welcome.js.map