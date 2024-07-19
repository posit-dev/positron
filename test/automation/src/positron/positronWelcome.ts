/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';

export class PositronWelcome {

	startSection: Locator;

	constructor(private code: Code) {
		this.startSection = this.code.driver.getLocator('.positron-welcome-page-open');
	}

	async clickNewNotebook() {
		await this.startSection.locator('button').filter({
			has: this.code.driver.getLocator('.codicon-positron-new-notebook')
		}).click();
	}

	async clickNewFile() {
		await this.startSection.locator('button').filter({
			has: this.code.driver.getLocator('.codicon-positron-new-file')
		}).click();
	}

	async clickNewConsole() {
		await this.startSection.locator('button').filter({
			has: this.code.driver.getLocator('.codicon-positron-new-console')
		}).click();
	}

	async clickNewProject() {
		await this.startSection.locator('button').filter({
			has: this.code.driver.getLocator('.codicon-positron-new-project')
		}).click();
	}
}
