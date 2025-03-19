/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

export class Problems {

	problemsTab = this.code.driver.page.getByRole('tab', { name: 'Problems' });
	problemsView = this.code.driver.page.locator('.panel .markers-panel');
	problemsViewWarning = this.problemsView.locator('.marker-icon .codicon-warning');
	problemsViewError = this.problemsView.locator('.marker-icon .codicon-error');
	problemsCount = this.problemsTab.locator('.badge-content');
	problemsRow = this.problemsView.locator('.monaco-tl-row');
	warningSquiggly = this.code.driver.page.locator('.view-overlays .cdr.squiggly-warning');
	errorSquiggly = this.code.driver.page.locator('.view-overlays .cdr.squiggly-error');

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	async showProblemsView(): Promise<any> {
		await this.quickaccess.runCommand('workbench.panel.markers.view.focus');
		await this.waitForProblemsView();
	}

	async waitForProblemsView(): Promise<void> {
		await expect(this.problemsView).toBeVisible();
	}

	async expectSquigglyCountToBe(severity: ProblemSeverity, count: number): Promise<void> {
		await test.step(`Expect ${severity} squiggly count: ${count}`, async () => {
			const squiggly = severity === 'warning' ? this.warningSquiggly : this.errorSquiggly;

			await expect(squiggly).toHaveCount(count);
		});
	}

	async expectDiagnosticsToBe({
		problemCount,
		errorCount,
		warningCount
	}: {
		problemCount?: number;
		errorCount?: number;
		warningCount?: number;
	}): Promise<void> {
		await test.step(`Verify diagnostics - Problems: ${problemCount ?? 'N/A'}, Errors: ${errorCount ?? 'N/A'}, Warnings: ${warningCount ?? 'N/A'}`, async () => {
			// Waiting for debounce to complete, ensuring counts reflect the final state
			await this.code.driver.page.waitForTimeout(1500);
			await this.showProblemsView();

			if (problemCount !== undefined) {
				problemCount === 0
					? await expect(this.problemsCount).not.toBeVisible()
					: await expect(this.problemsCount).toHaveText(problemCount.toString());
			}

			if (errorCount !== undefined) {
				await expect(this.problemsViewError).toHaveCount(errorCount);
			}

			if (warningCount !== undefined) {
				await expect(this.problemsViewWarning).toHaveCount(warningCount);
			}
		});
	}

	async expectWarningText(text: string): Promise<void> {
		await test.step(`Expect warning text: ${text}`, async () => {
			await this.showProblemsView();
			await expect(this.problemsRow.filter({ hasText: text })).toBeVisible();
		});
	}
}

export type ProblemSeverity = 'warning' | 'error';
