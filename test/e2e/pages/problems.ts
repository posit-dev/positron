/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

export const enum ProblemSeverity {
	WARNING = 0,
	ERROR = 1
}

export class Problems {

	static PROBLEMS_VIEW_SELECTOR = '.panel .markers-panel';

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	async showProblemsView(): Promise<any> {
		await this.quickaccess.runCommand('workbench.panel.markers.view.focus');
		await this.waitForProblemsView();
	}

	async waitForProblemsView(): Promise<void> {
		await expect(this.code.driver.page.locator(Problems.PROBLEMS_VIEW_SELECTOR)).toBeVisible();
	}


	static getSelectorInProblemsView(problemType: ProblemSeverity): string {
		const selector = problemType === ProblemSeverity.WARNING ? 'codicon-warning' : 'codicon-error';
		return `div[id="workbench.panel.markers"] .monaco-tl-contents .marker-icon .${selector}`;
	}

	static getSelectorInEditor(problemType: ProblemSeverity): string {
		const selector = problemType === ProblemSeverity.WARNING ? 'squiggly-warning' : 'squiggly-error';
		return `.view-overlays .cdr.${selector}`;
	}
}
