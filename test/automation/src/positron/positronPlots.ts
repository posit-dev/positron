/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import * as fs from 'fs';

export class PositronPlots {

	constructor() { }

	async compareScreenshots(plotLocator: Locator, filePath: string): Promise<boolean> {

		const buffer = await plotLocator.screenshot();
		const foundBuffer = buffer.toString('base64');

		const goldenBuffer = fs.readFileSync(filePath, 'base64');

		return goldenBuffer === foundBuffer;

	}
}
