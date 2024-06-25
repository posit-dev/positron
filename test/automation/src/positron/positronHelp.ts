/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { FrameLocator, Locator } from '@playwright/test';
import { Code } from '../code';

const OUTER_FRAME = '.webview';
const MIDDLE_FRAME = '#active-frame';
const INNER_FRAME = '#help-iframe';
const HELP_CONTAINER = '.positron-help-container';
const RESIZE_SASH = '.monaco-sash.mac.horizontal:not(.disabled)';

export class PositronHelp {

	constructor(private code: Code) { }

	async getHelpFrame(nth: number): Promise<FrameLocator> {
		const outerFrame = this.code.driver.getFrame(OUTER_FRAME).nth(nth);
		const innerFrame = outerFrame.frameLocator(MIDDLE_FRAME);
		const innerInnerFrame = innerFrame.frameLocator(INNER_FRAME);
		return innerInnerFrame;
	}

	getHelpContainer(): Locator {
		return this.code.driver.getAuxilaryBar().locator(HELP_CONTAINER);
	}

	getHelpHeader(): Locator {
		return this.code.driver.getAuxilaryBar().getByRole('button', { name: 'Help Section' });
	}

	async resizeHelpPanel(delta: { x?: number; y?: number }): Promise<void> {
		const sashLocator = this.code.driver.getAuxilaryBar().locator(RESIZE_SASH);
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
