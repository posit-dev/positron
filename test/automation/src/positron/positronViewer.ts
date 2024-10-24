/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from '@playwright/test';
import { Code } from '../code';

const INNER_FRAME = '#active-frame';
const REFRESH_BUTTON = '.codicon-positron-refresh';

const FULL_APP = 'body';

export class PositronViewer {

	fullApp = this.code.driver.getLocator(FULL_APP);

	constructor(private code: Code) { }

	getViewerFrame(): FrameLocator {
		return this.code.driver.page.frameLocator('iframe').frameLocator(INNER_FRAME);
	}

	async refreshViewer() {
		await this.code.waitAndClick(REFRESH_BUTTON);
	}

	async clearViewer() {
		await this.fullApp.getByLabel(/Clear the/).click();
	}
}
