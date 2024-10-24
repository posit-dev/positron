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

	getViewerLocator(locator: string, additionalNesting = false): Locator {
		if (!additionalNesting) {
			return this.getViewerFrame().locator(locator);
		} else {
			const innerInnerFrame = this.getViewerFrame().frameLocator('//iframe');
			return innerInnerFrame.locator(locator);
		}
	}

	getViewerFrame(frameLocator?: string): FrameLocator {
		const outerFrame = this.code.driver.page.frameLocator('iframe').frameLocator(INNER_FRAME);

		// if frameLocator is provided, use it; otherwise, return the default outerFrame
		if (frameLocator) {
			return outerFrame.frameLocator(frameLocator);
		}

		return outerFrame;
	}

	async refreshViewer() {
		await this.code.waitAndClick(REFRESH_BUTTON);
	}

	async clearViewer() {
		await this.fullApp.getByLabel(/Clear the/).click();
	}
}
