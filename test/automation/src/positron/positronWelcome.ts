/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';

export class PositronWelcome {

	startSection: Locator;
	startTitle: Locator;
	startButtons: Locator;
	helpSection: Locator;
	helpTitle: Locator;
	helpLinks: Locator;
	openSection: Locator;
	openTitle: Locator;
	openButtons: Locator;
	recentSection: Locator;
	recentTitle: Locator;

	constructor(private code: Code) {
		this.startSection = this.code.driver.getLocator('.positron-welcome-page-open');
		this.startTitle = this.startSection.getByRole('heading');
		this.startButtons = this.startSection.getByRole('button');

		this.helpSection = this.code.driver.getLocator('.positron-welcome-page-help');
		this.helpTitle = this.helpSection.getByRole('heading');
		this.helpLinks = this.helpSection.getByRole('link');

		this.openSection = this.code.driver.getLocator('.categories-column.categories-column-right .index-list.start-container');
		this.openTitle = this.openSection.getByRole('heading');
		this.openButtons = this.openSection.getByRole('button');

		this.recentSection = this.code.driver.getLocator('.categories-column.categories-column-right .index-list.recently-opened');
		this.recentTitle = this.recentSection.getByRole('heading');
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
