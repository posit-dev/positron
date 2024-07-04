/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { PositronBaseElement } from './positronBaseElement';

const CURRENT_PLOT = '.plot-instance .image-wrapper img';
const CURRENT_STATIC_PLOT = '.plot-instance.static-plot-instance img';
const CLEAR_PLOTS = '.positron-plots-container .positron-action-bar .codicon-clear-all';
const NEXT_PLOT = '.positron-plots-container .positron-action-bar .codicon-positron-right-arrow';
const PREVIOUS_PLOT = '.positron-plots-container .positron-action-bar .codicon-positron-left-arrow';


/*
 *  Reuseable Positron plots functionality for tests to leverage.
 */
export class PositronPlots {

	nextPlotButton: PositronBaseElement;
	previousPlotButton: PositronBaseElement;
	clearPlotsButton: PositronBaseElement;

	constructor(private code: Code) {
		this.nextPlotButton = new PositronBaseElement('.positron-plots-container .positron-action-bar .positron-button[aria-label="Show next plot"]', this.code);
		this.previousPlotButton = new PositronBaseElement('.positron-plots-container .positron-action-bar .positron-button[aria-label="Show previous plot"]', this.code);
		this.clearPlotsButton = new PositronBaseElement('.positron-plots-container .positron-action-bar .positron-button[aria-label="Clear all plots"]', this.code);
	}

	async waitForCurrentPlot() {
		await this.code.waitForElement(CURRENT_PLOT);
	}

	async waitForCurrentStaticPlot() {
		await this.code.waitForElement(CURRENT_STATIC_PLOT);
	}

	async clearPlots() {
		await this.code.waitAndClick(CLEAR_PLOTS);
	}

	async nextPlot() {
		await this.code.waitAndClick(NEXT_PLOT);
	}

	async previousPlot() {
		await this.code.waitAndClick(PREVIOUS_PLOT);
	}

	async waitForNoPlots() {
		await this.code.waitForElement(CURRENT_PLOT, (result) => !result);
	}
}
