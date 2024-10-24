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
	viewerFrame = this.code.driver.page.frameLocator('iframe').frameLocator(INNER_FRAME);

	constructor(private code: Code) { }

	getViewerLocator(locator: string, { nestedFrame }: { nestedFrame?: string } = {}): Locator {
		if (nestedFrame) {
			return this.viewerFrame.frameLocator(nestedFrame).locator(locator);
		}

		return this.viewerFrame.locator(locator);
	}

	getViewerFrame(nestedFrame?: string): FrameLocator {
		if (nestedFrame) {
			return this.viewerFrame.frameLocator(nestedFrame);
		}

		return this.viewerFrame;
	}

	async refreshViewer() {
		await this.code.waitAndClick(REFRESH_BUTTON);
	}

	async clearViewer() {
		await this.fullApp.getByLabel(/Clear the/).click();
	}
}
