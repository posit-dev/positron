/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { FrameLocator } from '@playwright/test';
import { Code } from '../code';

const OUTER_FRAME = '.webview';
const MIDDLE_FRAME = '#active-frame';
const INNER_FRAME = '#help-iframe';

export class PositronHelp {

	constructor(private code: Code) { }

	async getHelpFrame(nth: number): Promise<FrameLocator> {
		const outerFrame = this.code.driver.getFrame(OUTER_FRAME).nth(nth);
		const innerFrame = outerFrame.frameLocator(MIDDLE_FRAME);
		const innerInnerFrame = innerFrame.frameLocator(INNER_FRAME);
		return innerInnerFrame;
	}
}
