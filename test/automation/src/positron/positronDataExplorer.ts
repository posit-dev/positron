/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Code } from '../code';
import { PositronBaseElement } from './positronBaseElement';
import { Workbench } from '../workbench';

const COLUMN_HEADERS = '.data-explorer-panel .right-column .data-grid-column-headers';
const HEADER_TITLES = '.data-grid-column-header .title-description .title';
const DATA_GRID_ROWS = '.data-explorer-panel .right-column .data-grid-rows';
const DATA_GRID_ROW = '.data-grid-row';
const CLOSE_DATA_EXPLORER = '.tab .codicon-close';
const IDLE_STATUS = '.status-bar-indicator .icon.idle';
const SCROLLBAR_LOWER_RIGHT_CORNER = '.data-grid-scrollbar-corner';
const DATA_GRID_TOP_LEFT = '.data-grid-corner-top-left';
const ADD_FILTER_BUTTON = '.codicon-positron-add-filter';
const COLUMN_SELECTOR = '.positron-modal-overlay .drop-down-column-selector';
const COLUMN_INPUT = '.positron-modal-overlay .column-search-input .text-input';
const COLUMN_SELECTOR_CELL = '.column-selector-cell';
const FUNCTION_SELECTOR = '.positron-modal-overlay .drop-down-list-box';
const FILTER_SELECTOR = '.positron-modal-overlay .row-filter-parameter-input .text-input';
const APPLY_FILTER = '.positron-modal-overlay .button-apply-row-filter';
const STATUS_BAR = '.positron-data-explorer .status-bar';
const OVERLAY_BUTTON = '.positron-modal-overlay .positron-button';
const CLEAR_SORTING_BUTTON = '.codicon-positron-clear-sorting';
const MISSING_PERCENT = (rowNumber: number) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-null-percent .text-percent`;
const EXPAND_COLLAPSE_PROFILE = (rowNumber: number) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .expand-collapse-button`;
const EXPAND_COLLASPE_ICON = '.expand-collapse-icon';
const PROFILE_LABELS = (rowNumber: number) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-profile-info .label`;
const PROFILE_VALUES = (rowNumber: number) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-profile-info .value`;


export interface CellData {
	[key: string]: string;
}

export interface ColumnProfile {
	profileData: { [key: string]: string };
	profileSparklineHeights: string[];
}

/*
 *  Reuseable Positron data explorer functionality for tests to leverage.
 */
export class PositronDataExplorer {

	clearSortingButton: PositronBaseElement;

	constructor(private code: Code, private workbench: Workbench) {
		this.clearSortingButton = new PositronBaseElement(CLEAR_SORTING_BUTTON, this.code);
	}

	/*
	 * Get the currently visible data explorer table data
	 */
	async getDataExplorerTableData(): Promise<object[]> {

		// unreliable:
		//await this.code.waitForElement(IDLE_STATUS);
		await this.code.driver.getLocator(IDLE_STATUS).waitFor({ state: 'visible', timeout: 60000 });

		// we have seen intermittent failures where the data explorer is not fully loaded
		// even though the status bar is idle. This wait is to ensure the data explorer is fully loaded
		// chosing 1000ms as a safe wait time because waitForElement polls at 100ms
		await this.code.wait(1000);

		const headers = await this.code.waitForElements(`${COLUMN_HEADERS} ${HEADER_TITLES}`, false);
		const rows = await this.code.waitForElements(`${DATA_GRID_ROWS} ${DATA_GRID_ROW}`, true);
		const headerNames = headers.map((header) => header.textContent);

		const tableData: object[] = [];
		for (const row of rows) {
			const rowData: CellData = {};
			let columnIndex = 0;
			for (const cell of row.children) {
				const innerText = cell.textContent;
				const headerName = headerNames[columnIndex];
				// workaround for extra offscreen cells
				if (!headerName) {
					continue;
				}
				rowData[headerName] = innerText;
				columnIndex++;
			}
			tableData.push(rowData);
		}

		return tableData;
	}

	async closeDataExplorer() {
		await this.code.driver.page.locator(CLOSE_DATA_EXPLORER).first().click();
	}

	async clickLowerRightCorner() {
		await this.code.driver.page.locator(SCROLLBAR_LOWER_RIGHT_CORNER).click();
	}

	async clickUpperLeftCorner() {
		await this.code.driver.page.locator(DATA_GRID_TOP_LEFT).click();
	}

	/*
	 * Add a filter to the data explorer.  Only works for a single filter at the moment.
	 */
	async addFilter(columnName: string, functionText: string, filterValue: string) {

		await this.code.driver.page.locator(ADD_FILTER_BUTTON).click();

		// worakaround for column being set incorrectly
		await expect(async () => {
			try {
				await this.code.driver.page.locator(COLUMN_SELECTOR).click();
				const columnText = `${columnName}\n`;
				await this.code.waitForSetValue(COLUMN_INPUT, columnText);
				await this.code.driver.page.locator(COLUMN_SELECTOR_CELL).click();
				const checkValue = (await this.code.waitForElement(COLUMN_SELECTOR)).textContent;
				expect(checkValue).toBe(columnName);
			} catch (e) {
				await this.code.driver.getKeyboard().press('Escape');
				throw e;
			}
		}).toPass({ timeout: 30000 });


		await this.code.driver.page.locator(FUNCTION_SELECTOR).click();

		// note that base Microsoft funtionality does not work with "has text" type selection
		const equalTo = this.code.driver.getLocator(`${OVERLAY_BUTTON} div:has-text("${functionText}")`);
		await equalTo.click();

		const filterValueText = `${filterValue}\n`;
		await this.code.waitForSetValue(FILTER_SELECTOR, filterValueText);

		await this.code.driver.page.locator(APPLY_FILTER).click();
	}

	async getDataExplorerStatusBar() {
		return await this.code.waitForElement(STATUS_BAR, (e) => e!.textContent.includes('Showing'));
	}

	async selectColumnMenuItem(columnIndex: number, menuItem: string) {

		await this.code.driver.page.locator(`.data-grid-column-header:nth-child(${columnIndex}) .sort-button`).click();

		await this.code.driver.getLocator(`.positron-modal-overlay div.title:has-text("${menuItem}")`).click();

	}

	async home(): Promise<void> {
		await this.code.driver.page.keyboard.press('Home');
	}

	async cmdCtrlHome(): Promise<void> {
		if (process.platform === 'darwin') {
			await this.code.driver.page.keyboard.press('Meta+Home');
		} else {
			await this.code.driver.page.keyboard.press('Control+Home');
		}
	}

	async arrowDown(): Promise<void> {
		await this.code.driver.page.keyboard.press('ArrowDown');
	}

	async arrowRight(): Promise<void> {
		await this.code.driver.page.keyboard.press('ArrowRight');
	}

	async arrowUp(): Promise<void> {
		await this.code.driver.page.keyboard.press('ArrowUp');
	}

	async arrowLeft(): Promise<void> {
		await this.code.driver.page.keyboard.press('ArrowLeft');
	}

	async getColumnMissingPercent(rowNumber: number): Promise<string> {
		const row = this.code.driver.getLocator(MISSING_PERCENT(rowNumber));
		return await row.innerText();
	}

	async getColumnProfileInfo(rowNumber: number): Promise<ColumnProfile> {

		const expandCollapseLocator = this.code.driver.getLocator(EXPAND_COLLAPSE_PROFILE(rowNumber));

		await expandCollapseLocator.scrollIntoViewIfNeeded();
		await expandCollapseLocator.click();

		await expect(expandCollapseLocator.locator(EXPAND_COLLASPE_ICON)).toHaveClass(/codicon-chevron-down/);

		const profileData: { [key: string]: string } = {};

		const labels = await this.code.waitForElements(PROFILE_LABELS(rowNumber), false, (elements) => elements.length > 2);
		const values = await this.code.waitForElements(PROFILE_VALUES(rowNumber), false, (elements) => elements.length > 2);

		for (let i = 0; i < labels.length; i++) {
			const label = labels[i].textContent;
			const value = values[i].textContent;
			if (label && value) {
				profileData[label] = value; // Assign label as key and value as value
			}
		}

		// some rects have "count" class, some have "bin-count" class, some have "count other" class
		const rects = await this.code.driver.getLocator('.column-profile-sparkline').locator('[class*="count"]').all();
		const profileSparklineHeights: string[] = [];
		for (let i = 0; i < rects.length; i++) {
			const height = await rects[i].getAttribute('height');
			if (height !== null) {
				const rounded = parseFloat(height).toFixed(1); // Round to one decimal place
				profileSparklineHeights.push(rounded);
			}
		}

		await expandCollapseLocator.scrollIntoViewIfNeeded();
		await expandCollapseLocator.click();

		await expect(expandCollapseLocator.locator(EXPAND_COLLASPE_ICON)).toHaveClass(/codicon-chevron-right/);

		const profileInfo: ColumnProfile = {
			profileData: profileData,
			profileSparklineHeights: profileSparklineHeights
		};

		return profileInfo;

	}

	async expandColumnProfile(rowNumber = 0): Promise<void> {
		await this.code.driver.getLocator(EXPAND_COLLASPE_ICON).nth(rowNumber).click();
	}

	async maximizeDataExplorer(collapseSummary: boolean = false): Promise<void> {
		await this.workbench.positronLayouts.enterLayout('stacked');
		await this.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await this.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await this.workbench.quickaccess.runCommand('workbench.action.togglePanel');

		if (collapseSummary) {
			await this.collapseSummary();
		}
	}

	async collapseSummary(): Promise<void> {
		await this.workbench.quickaccess.runCommand('workbench.action.positronDataExplorer.collapseSummary');
	}

	async expandSummary(): Promise<void> {
		await this.workbench.quickaccess.runCommand('workbench.action.positronDataExplorer.expandSummary');
	}
}
