/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

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

	private async expectSquigglyVisibility(severity: ProblemSeverity, shouldBeVisible: boolean): Promise<void> {
		await test.step(`Expect ${severity} squiggly ${shouldBeVisible ? 'to' : 'not to'} be visible`, async () => {
			const squiggly = severity === 'warning' ? this.warningSquiggly : this.errorSquiggly;
			shouldBeVisible
				? await expect(squiggly).toBeVisible()
				: await expect(squiggly).not.toBeVisible();
		});
	}

	async expectSquigglyToBeVisible(severity: ProblemSeverity): Promise<void> {
		await this.expectSquigglyVisibility(severity, true);
	}

	async expectSquigglyNotToBeVisible(severity: ProblemSeverity): Promise<void> {
		await this.expectSquigglyVisibility(severity, false);
	}

	async expectProblemsCountToBe(count: number): Promise<void> {
		await test.step(`Verify Problems Count: ${count}`, async () => {
			// Waiting for debounce to complete, ensuring the error count reflects the final, stabilized state.
			await this.code.driver.page.waitForTimeout(1500);
			await expect(this.problemsViewError).toHaveCount(count);
		});
	}
}

export type ProblemSeverity = 'warning' | 'error';
