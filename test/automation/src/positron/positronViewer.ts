/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from '@playwright/test';
import { Code } from '../code';

const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const REFRESH_BUTTON = '.codicon-positron-refresh';

const FULL_APP = 'body';

export class PositronViewer {

	fullApp = this.code.driver.page.locator(FULL_APP);
	viewerFrame = this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);

	constructor(private code: Code) { }

	getViewerLocator(locator: string,): Locator {
		return this.viewerFrame.locator(locator);
	}

	getViewerFrame(): FrameLocator {
		return this.viewerFrame;
	}

	async refreshViewer() {
		await this.code.driver.page.locator(REFRESH_BUTTON).click({ timeout: 15000 });
	}

	async clearViewer() {
		await this.code.driver.page.getByRole('tab', { name: 'Viewer' }).locator('a').click();
		await this.fullApp.getByLabel(/Clear the/).click();
	}
}
