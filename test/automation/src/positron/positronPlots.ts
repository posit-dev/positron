/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';

const CURRENT_PLOT = '.plot-instance .image-wrapper img';
const CURRENT_STATIC_PLOT = '.plot-instance.static-plot-instance img';
const CLEAR_PLOTS = '.positron-plots-container .positron-action-bar .codicon-clear-all';


/*
 *  Reuseable Positron plots functionality for tests to leverage.
 */
export class PositronPlots {

	nextPlotButton: Locator;
	previousPlotButton: Locator;
	clearPlotsButton: Locator;
	plotSizeButton: Locator;
	savePlotButton: Locator;
	copyPlotButton: Locator;
	zoomPlotButton: Locator;



	constructor(private code: Code) {
		this.nextPlotButton = this.code.driver.getLocator('.positron-plots-container .positron-action-bar .positron-button[aria-label="Show next plot"]');
		this.previousPlotButton = this.code.driver.getLocator('.positron-plots-container .positron-action-bar .positron-button[aria-label="Show previous plot"]');
		this.clearPlotsButton = this.code.driver.getLocator('.positron-plots-container .positron-action-bar .positron-button[aria-label="Clear all plots"]');
		this.plotSizeButton = this.code.driver.getLocator('.positron-plots-container .positron-action-bar .positron-button[aria-label="Auto"]');
		this.savePlotButton = this.code.driver.getLocator('.positron-plots-container .positron-action-bar .positron-button[aria-label="Save plot"]');
		this.copyPlotButton = this.code.driver.getLocator('.positron-plots-container .positron-action-bar .positron-button[aria-label="Copy plot to clipboard"]');
		this.zoomPlotButton = this.code.driver.getLocator('.positron-plots-container .positron-action-bar .positron-button[aria-label="Fill"]');
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

	async waitForNoPlots() {
		await this.code.waitForElement(CURRENT_PLOT, (result) => !result);
	}
}
