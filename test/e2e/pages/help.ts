/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { FrameLocator, Locator } from '@playwright/test';
import { Code } from '../infra/code';

const OUTER_FRAME = '.webview';
const MIDDLE_FRAME = '#active-frame';
const INNER_FRAME = '#help-iframe';
const HELP_CONTAINER = '.positron-help-container';
const RESIZE_SASH = '.monaco-sash.horizontal:not(.disabled)';
const AUX_BAR = '.part.auxiliarybar';

/*
 *  Reuseable Positron Help functionality for tests to leverage.
 */
export class Help {

	private get auxilaryBar(): Locator { return this.code.driver.page.locator(AUX_BAR); }

	constructor(private code: Code) { }

	async openHelpPanel(): Promise<void> {
		await this.code.driver.page.locator('.action-label[aria-label="Help"]').click();
	}

	async getHelpWelcomePageFrame() {
		const outerFrame = this.code.driver.page.locator(OUTER_FRAME).first().contentFrame();
		const innerInnerFrame = outerFrame.frameLocator(MIDDLE_FRAME);
		return innerInnerFrame;
	}

	async getHelpFrame(nth: number): Promise<FrameLocator> {
		const outerFrame = this.code.driver.page.locator(OUTER_FRAME).nth(nth).contentFrame();
		const innerFrame = outerFrame.frameLocator(MIDDLE_FRAME);
		const innerInnerFrame = innerFrame.frameLocator(INNER_FRAME);
		return innerInnerFrame;
	}

	getHelpContainer(): Locator {
		return this.auxilaryBar.locator(HELP_CONTAINER);
	}

	getHelpHeader(): Locator {
		return this.auxilaryBar.getByRole('button', { name: 'Help Section' });
	}

	async resizeHelpPanel(delta: { x?: number; y?: number }): Promise<void> {
		const sashLocator = this.auxilaryBar.locator(RESIZE_SASH);
		const sashLocation = await sashLocator.boundingBox();
		if (!sashLocation) {
			throw new Error('Could not find sash');
		}

		const middleOfSash = { x: sashLocation.x + sashLocation.width / 2, y: sashLocation.y + sashLocation.height / 2 };

		// Select the sash to resize
		await this.code.driver.clickAndDrag({
			from: middleOfSash,
			delta
		});
	}
}
