"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardPage = void 0;
const test_1 = require("@playwright/test");
class DashboardPage {
    code;
    quickInput;
    get title() { return this.code.driver.currentPage.getByRole('link', { name: 'Workbench projects' }); }
    get launchButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Launch' }); }
    get quitButton() { return this.code.driver.currentPage.getByRole('button', { name: 'Quit' }); }
    get newSessionButton() { return this.code.driver.currentPage.getByRole('button', { name: 'New Session', exact: true }).first(); }
    get positronProButton() { return this.code.driver.currentPage.getByRole('tab', { name: 'Positron Pro' }); }
    get sessionNameInput() { return this.code.driver.currentPage.getByRole('textbox', { name: 'Session Name' }); }
    project = (projectName) => this.code.driver.currentPage.getByRole('button', { name: projectName });
    projectNewSessionButton = (projectName) => this.project(projectName).locator('..').locator('..').getByRole('button', { name: 'Create new session' });
    projectCheckbox = (projectName) => this.project(projectName).locator('..').locator('..').locator('button[role="checkbox"]');
    constructor(code, quickInput) {
        this.code = code;
        this.quickInput = quickInput;
    }
    // #region Actions
    async goTo() {
        await this.code.driver.currentPage.goto('http://localhost:8787');
        await this.expectHeaderToBeVisible();
    }
    /**
     * Ensures a project exists, creating it if necessary
     * @param folderToOpen The folder name to create/check for
     * @returns true if a new session was created, false if project already existed
     */
    async ensureProjectExists(folderToOpen = 'qa-example-content') {
        const existingProject = this.project(folderToOpen);
        try {
            await (0, test_1.expect)(existingProject).toBeVisible({ timeout: 3000 });
            return false; // Project already exists
        }
        catch {
            // Project doesn't exist, create it
            await this.createNewProject(folderToOpen);
            return true; // New project was created
        }
    }
    /**
     * Creates a new project/session with the specified folder
     * @param folderToOpen The folder name for the new project
     */
    async createNewProject(folderToOpen) {
        await this.newSessionButton.click();
        await this.positronProButton.click();
        await this.sessionNameInput.fill(folderToOpen);
        await this.launchButton.click();
        await this.code.driver.currentPage.getByRole('button', { name: 'Open Folder', exact: true }).click();
        await this.quickInput.waitForQuickInputOpened();
        await this.quickInput.selectQuickInputElementContaining(folderToOpen);
        await this.quickInput.clickOkButton();
    }
    /**
     * Opens a session for the specified project, creating it if necessary
     * @param projectName The project name to open
     */
    async openSession(projectName = 'qa-example-content') {
        // Ensure the project exists before trying to open it
        // If a new project is created, it will auto-launch
        const newProjectCreated = await this.ensureProjectExists(projectName);
        if (!newProjectCreated) {
            // Project already existed, so we need to launch it
            const startNewSessionButton = this.projectNewSessionButton(projectName);
            try {
                await (0, test_1.expect)(startNewSessionButton).toBeVisible({ timeout: 3000 });
            }
            catch {
                // Clean up existing sessions if new session button is not available
                await this.quitSession(projectName);
                await (0, test_1.expect)(startNewSessionButton).toBeVisible();
            }
            await startNewSessionButton.click();
            await this.launchButton.click();
        }
    }
    /**
     * Quits the specified project session
     * @param projectName The project name to quit
     */
    async quitSession(projectName = 'qa-example-content') {
        await this.projectCheckbox(projectName).check();
        await this.quitButton.click();
    }
    // #endregion
    // #region Verifications
    async expectHeaderToBeVisible() {
        await (0, test_1.expect)(this.title).toBeVisible();
    }
}
exports.DashboardPage = DashboardPage;
//# sourceMappingURL=dashboard.page.js.map