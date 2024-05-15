/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import * as fs from 'fs';
import { ComparisonOptions } from 'resemblejs';
import compareImages = require('resemblejs/compareImages');
import util = require('util');


export class PositronPlots {

	constructor() { }

	async compareScreenshots(plotLocator: Locator, filePath: string): Promise<boolean> {

		const options: ComparisonOptions = {
			output: {
				errorColor: {
					red: 255,
					green: 0,
					blue: 255
				},
				errorType: 'movement',
				transparency: 0.3,
				largeImageThreshold: 1200,
				useCrossOrigin: false,

			},
			scaleToSameSize: true,
			ignore: 'antialiasing'
		};

		const data = await compareImages(await plotLocator.screenshot(), await fs.promises.readFile(filePath), options);

		console.log(util.inspect(data, { showHidden: false, depth: null, colors: true }));

		return true;

	}
}
