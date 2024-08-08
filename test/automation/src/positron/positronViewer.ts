/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from '@playwright/test';
import { Code } from '../code';

const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const REFRESH_BUTTON = '.codicon-positron-refresh';

export class PositronViewer {

	constructor(private code: Code) { }

	getViewerLocator(sublocator: string): Locator {
		const outerFrame = this.code.driver.getFrame(OUTER_FRAME);
		const innerFrame = outerFrame.frameLocator(INNER_FRAME);
		const element = innerFrame.locator(sublocator);
		return element;
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
}
