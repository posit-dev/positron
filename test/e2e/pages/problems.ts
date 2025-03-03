/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

export const enum ProblemSeverity {
	WARNING = 0,
	ERROR = 1
}

export class Problems {

	problemsView: Locator;
	warningSquiggly: Locator;
	errorSquiggly: Locator;
	problemsViewWarning: Locator;
	problemsViewError: Locator;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.problemsView = this.code.driver.page.locator('.panel .markers-panel');
		this.problemsViewWarning = this.code.driver.page.locator(`div[id="workbench.panel.markers"] .monaco-tl-contents .marker-icon .codicon-warning`);
		this.problemsViewError = this.code.driver.page.locator(`div[id="workbench.panel.markers"] .monaco-tl-contents .marker-icon .codicon-error`);
		this.warningSquiggly = this.code.driver.page.locator('.view-overlays .cdr.squiggly-warning');
		this.errorSquiggly = this.code.driver.page.locator('.view-overlays .cdr.squiggly-error');
	}

	async showProblemsView(): Promise<any> {
		await this.quickaccess.runCommand('workbench.panel.markers.view.focus');
		await this.waitForProblemsView();
	}

	async waitForProblemsView(): Promise<void> {
		await expect(this.problemsView).toBeVisible();
	}
}
