/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Locator } from '@playwright/test';
import { Code } from '../code';

const CURRENT_PLOT = '.plot-instance img';
const CURRENT_STATIC_PLOT = '.plot-instance.static-plot-instance img';
const CLEAR_PLOTS = '.positron-plots-container .positron-action-bar .codicon-clear-all';
const NEXT_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Show next plot"]';
const PREVIOUS_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Show previous plot"]';
const CLEAR_PLOTS_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Clear all plots"]';
const PLOT_SIZE_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Auto"]';
const SAVE_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Save plot"]';
const COPY_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Copy plot to clipboard"]';
const ZOOM_PLOT_BUTTON = '.positron-plots-container .positron-action-bar .positron-button[aria-label="Fill"]';


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
	currentPlot: Locator;

	constructor(private code: Code) {
		this.nextPlotButton = this.code.driver.getLocator(NEXT_PLOT_BUTTON);
		this.previousPlotButton = this.code.driver.getLocator(PREVIOUS_PLOT_BUTTON);
		this.clearPlotsButton = this.code.driver.getLocator(CLEAR_PLOTS_BUTTON);
		this.plotSizeButton = this.code.driver.getLocator(PLOT_SIZE_BUTTON);
		this.savePlotButton = this.code.driver.getLocator(SAVE_PLOT_BUTTON);
		this.copyPlotButton = this.code.driver.getLocator(COPY_PLOT_BUTTON);
		this.zoomPlotButton = this.code.driver.getLocator(ZOOM_PLOT_BUTTON);
		this.currentPlot = this.code.driver.getLocator(CURRENT_PLOT);
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

	async getCurrentPlotAsBuffer(): Promise<Buffer> {
		return this.currentPlot.screenshot();
	}

	async getCurrentStaticPlotAsBuffer(): Promise<Buffer> {
		return this.code.driver.getLocator(CURRENT_STATIC_PLOT).screenshot();
	}
}
