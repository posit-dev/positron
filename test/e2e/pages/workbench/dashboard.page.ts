/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../../infra/code.js';
import { QuickInput } from '../quickInput.js';

export class DashboardPage {
	title = this.code.driver.page.getByRole('link', { name: 'Workbench projects' });
	launchButton = this.code.driver.page.getByRole('button', { name: 'Launch' });
	quitButton = this.code.driver.page.getByRole('button', { name: 'Quit' });
	newSessionButton = this.code.driver.page.getByRole('button', { name: 'New Session', exact: true }).first();
	positronProButton = this.code.driver.page.getByRole('tab', { name: 'Positron Pro' });
	sessionNameInput = this.code.driver.page.getByRole('textbox', { name: 'Session Name' });
	project = (projectName: string) => this.code.driver.page.getByRole('button', { name: projectName });
	projectNewSessionButton = (projectName: string) => this.project(projectName).locator('..').locator('..').getByRole('button', { name: 'Create new session' });
	projectCheckbox = (projectName: string) => this.project(projectName).locator('..').locator('..').locator('button[role="checkbox"]');

	constructor(private code: Code, private quickInput: QuickInput) { }

	async goTo(): Promise<void> {
		await this.code.driver.page.goto('http://localhost:8787');
		await this.expectHeaderToBeVisible();
	}

	/**
	 * Ensures a project exists, creating it if necessary
	 * @param folderToOpen The folder name to create/check for
	 * @returns true if a new session was created, false if project already existed
	 */
	async ensureProjectExists(folderToOpen = 'qa-example-content'): Promise<boolean> {
		const existingProject = this.project(folderToOpen);

		try {
			await expect(existingProject).toBeVisible({ timeout: 3000 });
			return false; // Project already exists
		} catch {
			// Project doesn't exist, create it
			await this.createNewProject(folderToOpen);
			return true; // New project was created
		}
	}

	/**
	 * Creates a new project/session with the specified folder
	 * @param folderToOpen The folder name for the new project
	 */
	private async createNewProject(folderToOpen: string): Promise<void> {
		await this.newSessionButton.click();
		await this.positronProButton.click();
		await this.sessionNameInput.fill(folderToOpen);
		await this.launchButton.click();
		await this.code.driver.page.getByRole('button', { name: 'Open Folder', exact: true }).click();
		await this.quickInput.selectQuickInputElementContaining(folderToOpen);
		await this.quickInput.clickOkButton();
	}

	async openSession(projectName = 'qa-example-content'): Promise<void> {
		// Ensure the project exists before trying to open it
		const wasNewProjectCreated = await this.ensureProjectExists(projectName);

		if (!wasNewProjectCreated) {
			// Project existed, so we need to start a new session for it
			const startNewSessionButton = this.projectNewSessionButton(projectName);

			try {
				await expect(startNewSessionButton).toBeVisible({ timeout: 3000 });
			} catch {
				// Clean up existing sessions if new session button is not available
				await this.quitSession(projectName);
				await expect(startNewSessionButton).toBeVisible();
			}

			await startNewSessionButton.click();
			await this.launchButton.click();
		}
	}

	async quitSession(projectName = 'qa-example-content'): Promise<void> {
		await this.projectCheckbox(projectName).check();
		await this.quitButton.click();
	}

	async expectHeaderToBeVisible() {
		await expect(this.title).toBeVisible();
	}
}
