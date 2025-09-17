/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../../infra/code.js';

export class DashboardPage {
	title = this.code.driver.page.getByRole('link', { name: 'Workbench projects' });
	launchButton = this.code.driver.page.getByRole('button', { name: 'Launch' });
	quitButton = this.code.driver.page.getByRole('button', { name: 'Quit' });
	newSessionButton = this.code.driver.page.getByRole('button', { name: 'New Session', exact: true });
	positronProButton = this.code.driver.page.getByRole('tab', { name: 'Positron Pro' });
	sessionNameInput = this.code.driver.page.getByRole('textbox', { name: 'Session Name' });
	project = (projectName: string) => this.code.driver.page.getByRole('button', { name: projectName });
	projectNewSessionButton = (projectName: string) => this.project(projectName).locator('..').locator('..').getByRole('button', { name: 'Create new session' });
	projectCheckbox = (projectName: string) => this.project(projectName).locator('..').locator('..').locator('button[role="checkbox"]');

	constructor(private code: Code) { }

	async goTo(): Promise<void> {
		await this.code.driver.page.goto('http://localhost:8787');
		await this.expectHeaderToBeVisible();
	}

	async newSession(projectName = 'qa-example-content'): Promise<void> {
		const newSession = this.project(projectName);

		try {
			await expect(newSession).toBeVisible({ timeout: 3000 });
		} catch {
			// if this project doesn't already exist, let's create it
			await this.newSessionButton.click();
			await this.positronProButton.click();
			await this.sessionNameInput.fill(projectName);
			await this.launchButton.click();
		}
	}

	async openSession(projectName = 'qa-example-content'): Promise<void> {
		// Ensure session exists before trying to open it
		await this.newSession(projectName);

		const projNewSession = this.projectNewSessionButton(projectName);

		try {
			await expect(projNewSession).toBeVisible({ timeout: 3000 });
		} catch {
			// Clean up existing sessions if new session button is not available
			await this.quitSession(projectName);
			await expect(projNewSession).toBeVisible();
		}

		await projNewSession.click();
		await this.launchButton.click();
	}

	async quitSession(projectName = 'qa-example-content'): Promise<void> {
		await this.projectCheckbox(projectName).check();
		await this.quitButton.click();
	}

	async expectHeaderToBeVisible() {
		await expect(this.title).toBeVisible();
	}
}
