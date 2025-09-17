/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../../infra/code.js';

export class DashboardPage {
	heading = this.code.driver.page.getByRole('heading', { name: 'Posit Workbench' });
	username = this.code.driver.page.getByRole('textbox', { name: 'Username' });
	password = this.code.driver.page.getByRole('textbox', { name: 'Password' });
	signInButton = this.code.driver.page.getByRole('button', { name: 'Sign In' });
	launchButton = this.code.driver.page.getByRole('button', { name: 'Launch' });
	quitButton = this.code.driver.page.getByRole('button', { name: 'Quit' });
	project = (projectName: string) => this.code.driver.page.getByRole('button', { name: projectName });
	projectCheckbox = (projectName: string) => this.project(projectName).locator('..').locator('..').locator('button[role="checkbox"]');

	constructor(private code: Code) { }

	async goTo(): Promise<void> {
		await this.code.driver.page.goto('http://localhost:8787');
	}

	async signIn(username = 'user1', password = process.env.POSIT_WORKBENCH_PASSWORD || ''): Promise<void> {
		await this.username.clear();
		await this.username.fill(username);
		await this.password.clear();
		await this.password.fill(password);
		await this.signInButton.click();
	}

	async openProject(projectName = 'qa-example-content'): Promise<void> {
		const workbenchProject = this.project(projectName);
		const newSession = workbenchProject.locator('..').locator('..').getByRole('button', { name: 'Create new session' });

		try {
			await expect(newSession).toBeVisible({ timeout: 3000 });
		} catch {
			// Clean up existing sessions if new session button is not available
			await workbenchProject.locator('..').locator('..').locator('button[role="checkbox"]').check();
			await this.code.driver.page.getByRole('button', { name: 'Quit' }).click();

			await expect(newSession).toBeVisible();
		}

		await newSession.click();
		await this.launchButton.click();
	}

	async quitSession(projectName = 'qa-example-content'): Promise<void> {
		await this.projectCheckbox(projectName).check();
		await this.quitButton.click();
	}

	async expectHeaderToBeVisible() {
		await expect(this.heading).toBeVisible();
	}
}
