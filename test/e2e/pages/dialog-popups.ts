/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test from '@playwright/test';
import { Code } from '../infra/code.js';

export class Popups {
	public popupBox = this.code.driver.page.locator('.positron-modal-popup');
	public popupItem = (label: string | RegExp) => this.popupBox.locator('.positron-welcome-menu-item').getByText(label);

	constructor(private readonly code: Code) { }

	// --- Actions ---

	async clickItem(label: string | RegExp) {
		await test.step(`Click item in popup dialog box: ${label}`, async () => {
			await this.popupItem(label).click();
		});
	}
}
