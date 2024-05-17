/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const CURRENT_PLOT = '.plot-instance .image-wrapper img';
const CLEAR_PLOTS = '.positron-plots-container .action-bar-tool-tip-container .codicon-clear-all';

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
