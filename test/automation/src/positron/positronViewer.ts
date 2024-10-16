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

	fullApp = this.code.driver.getLocator(FULL_APP);

	constructor(private code: Code) { }

	getViewerLocator(sublocator: string, additionalNesting = false): Locator {
		const outerFrame = this.code.driver.getFrame(OUTER_FRAME);
		const innerFrame = outerFrame.frameLocator(INNER_FRAME);
		if (!additionalNesting) {
			const element = innerFrame.locator(sublocator);
			return element;
		} else {
			const innerInnerFrame = innerFrame.frameLocator('//iframe');
			const element = innerInnerFrame.locator(sublocator);
			return element;
		}
	}

	getViewerFrame(frameLocator: string): FrameLocator {
		const outerFrame = this.code.driver.getFrame(OUTER_FRAME);
		const innerFrame = outerFrame.frameLocator(INNER_FRAME);
		const frame = innerFrame.frameLocator(frameLocator);
		return frame;
	}

	async refreshViewer() {
		await this.code.waitAndClick(REFRESH_BUTTON);
	}

	async clearViewer() {
		await this.fullApp.getByLabel(/Clear the/).click();
	}
}
