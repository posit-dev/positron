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

	// -- Actions --

	/**
	 * Action: Show the Problems view
	 */
	async showProblemsView(): Promise<any> {
		await this.quickaccess.runCommand('workbench.panel.markers.view.focus');
		await expect(this.problemsView).toBeVisible();
	}

	// -- Verifications --

	/**
	 * Verify: Expect the number of squigglies to be as specified
	 * @param severity 'warning' | 'error'
	 * @param count number of squigglies to expect
	 */
	async expectSquigglyCountToBe(severity: ProblemSeverity, count: number): Promise<void> {
		await test.step(`Expect ${severity} squiggly count: ${count}`, async () => {
			const squiggly = severity === 'warning' ? this.warningSquiggly : this.errorSquiggly;

			await expect(squiggly).toHaveCount(count);
		});
	}

	/**
	 * Verify: Expect the number of problems, errors, and warnings to be as specified
	 * @param problemCount - The expected problem count shown in the Problems tab badge
	 * @param errorCount - The expected error count shown in the Problems view
	 * @param warningCount - The expected warning count shown in the Problems view
	 */
	async expectDiagnosticsToBe({
		problemCount,
		errorCount,
		warningCount
	}: {
		problemCount?: number;
		errorCount?: number;
		warningCount?: number;
	}): Promise<void> {
		await test.step(`Expect diagnostics - Problems: ${problemCount ?? 'N/A'}, Errors: ${errorCount ?? 'N/A'}, Warnings: ${warningCount ?? 'N/A'}`, async () => {
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

	/**
	 * Verify: Expect the warning text to be present in the Problems view
	 * @param text The warning text that should be visible
	 */
	async expectWarningText(text: string): Promise<void> {
		await test.step(`Expect warning text: ${text}`, async () => {
			await this.showProblemsView();
			await expect(this.problemsRow.filter({ hasText: text })).toBeVisible();
		});
	}
}

export type ProblemSeverity = 'warning' | 'error';
