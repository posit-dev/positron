/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../automation/code';

const POSITRON_TOP_ACTION_BAR = 'div[id="workbench.parts.positron-top-action-bar"]';
const POSITRON_TOP_ACTION_SAVE_BUTTON = 'div[id="workbench.parts.positron-top-action-bar"] .action-bar-region-left .action-bar-button[aria-label="Save"]';
const POSITRON_TOP_ACTION_SAVE_ALL_BUTTON = 'div[id="workbench.parts.positron-top-action-bar"] .action-bar-region-left .action-bar-button[aria-label="Save All"]';

/*
 *  Reuseable Positron top action bar functionality for tests to leverage.
 */
export class TopActionBar {
	topActionBar: Locator;
	saveButton: Locator;
	saveAllButton: Locator;

	constructor(private code: Code) {
		this.topActionBar = this.code.driver.page.locator(POSITRON_TOP_ACTION_BAR);
		this.saveButton = this.code.driver.page.locator(POSITRON_TOP_ACTION_SAVE_BUTTON);
		this.saveAllButton = this.code.driver.page.locator(POSITRON_TOP_ACTION_SAVE_ALL_BUTTON);
	}
}
