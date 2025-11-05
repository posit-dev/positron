/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { Layouts } from './layouts';

/*
 *  Reuseable Positron SCM functionality for tests to leverage.
 */

const VIEWLET = 'div[id="workbench.view.scm"]';
const SCM_INPUT_TEXTAREA = `${VIEWLET} .scm-editor textarea`;
const SCM_RESOURCE_CLICK = (name: string) => `${VIEWLET} .monaco-list-row .resource .monaco-icon-label[aria-label*="${name}"] .label-name`;
const SCM_RESOURCE_ACTION_CLICK = (name: string, actionName: string) => `.monaco-list-row .resource .monaco-icon-label[aria-label*="${name}"] .actions .action-label[aria-label="${actionName}"]`;
const COMMIT_COMMAND = `div[id="workbench.parts.sidebar"] .actions-container a.action-label[aria-label="Commit"]`;
const HISTORY_ITEM_CURRENT = '.scm-history-view .history-item-current .label-name';

export class SCM {

	constructor(private code: Code, private layout: Layouts) { }

	async openSCMViewlet(): Promise<any> {
		await this.code.driver.page.keyboard.press('Control+Shift+G');
		await expect(this.code.driver.page.locator(SCM_INPUT_TEXTAREA)).toBeVisible();
	}

	async waitForChange(name: string, type: 'Staged' | 'Modified'): Promise<void> {
		await this.layout.enterLayout('fullSizedSidebar');

		const tooltip = type === 'Staged' ? 'Index Modified' : 'Modified';
		const locator = this.code.driver.page
			.getByLabel('Source Control Management')
			.locator(`[data-tooltip="${tooltip}"] .file-icon`)
			.filter({ hasText: name });

		await expect(locator).toBeVisible();
		await this.layout.enterLayout('stacked');
	}

	async openChange(name: string): Promise<void> {
		await this.layout.enterLayout('fullSizedSidebar');
		await this.code.driver.page.keyboard.press('Control+Shift+G'); // need to switch to scm view as it may have reset

		await this.code.driver.page.locator(SCM_RESOURCE_CLICK(name)).last().click();

		await this.layout.enterLayout('stacked');
	}

	async stage(name: string): Promise<void> {
		await this.code.driver.page.keyboard.press('Control+Shift+G'); // need to switch to scm view as it may have reset
		await this.code.driver.page.locator(SCM_RESOURCE_ACTION_CLICK(name, 'Stage Changes')).click();
		await this.waitForChange(name, 'Staged');
	}

	async commit(message: string): Promise<void> {
		await this.code.driver.page.keyboard.press('Control+Shift+G'); // need to switch to scm view as it may have reset
		await this.code.driver.page.locator(SCM_INPUT_TEXTAREA).click({ force: true });
		await expect(this.code.driver.page.locator(SCM_INPUT_TEXTAREA)).toBeFocused();
		await this.code.driver.page.locator(SCM_INPUT_TEXTAREA).fill(message);
		await this.code.driver.page.locator(COMMIT_COMMAND).click();
	}

	async verifyCurrentHistoryItem(name: string): Promise<void> {
		await expect(this.code.driver.page.locator(HISTORY_ITEM_CURRENT)).toHaveText(name, { timeout: 20000 });
	}
}
