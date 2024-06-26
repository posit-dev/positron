/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const CURRENT_PLOT = '.plot-instance .image-wrapper img';
const CLEAR_PLOTS = '.positron-plots-container .positron-action-bar .codicon-clear-all';

export class PositronPlots {

	constructor(private code: Code) { }

	async waitForCurrentPlot() {
		await this.code.waitForElement(CURRENT_PLOT);
	}

	async clearPlots() {
		await this.code.waitAndClick(CLEAR_PLOTS);
	}

	async waitForNoPlots() {
		await this.code.waitForElement(CURRENT_PLOT, (result) => !result);
	}
}
