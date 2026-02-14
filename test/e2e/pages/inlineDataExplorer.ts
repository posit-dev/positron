/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator, Page } from '@playwright/test';

const DEFAULT_TIMEOUT = 10000;

export class InlineDataExplorer {
	// Main container
	readonly container: Locator;

	// Header elements
	readonly header: Locator;
	readonly shape: Locator;
	readonly openButton: Locator;

	// Content area
	readonly content: Locator;
	readonly dataGrid: Locator;

	// State indicators
	readonly disconnectedState: Locator;
	readonly errorState: Locator;

	// Data grid elements
	readonly columnHeaders: Locator;
	readonly cells: Locator;

	constructor(
		private page: Page,
	) {
		this.container = this.page.locator('.inline-data-explorer-container');
		this.header = this.container.locator('.inline-data-explorer-header');
		this.shape = this.container.locator('.inline-data-explorer-shape');
		this.openButton = this.container.locator('.inline-data-explorer-open-button');
		this.content = this.container.locator('.inline-data-explorer-content');
		this.dataGrid = this.container.locator('.data-grid');
		this.disconnectedState = this.container.locator('.inline-data-explorer-disconnected');
		this.errorState = this.container.locator('.inline-data-explorer-error');
		this.columnHeaders = this.container.locator('.data-grid-column-header');
		this.cells = this.container.locator('.data-grid-row-cell');
	}

	// --- Actions ---

	async openFullDataExplorer(): Promise<void> {
		await test.step('Open full Data Explorer from inline view', async () => {
			await this.openButton.click();
		});
	}

	async sortColumn(columnName: string, direction: 'ascending' | 'descending'): Promise<void> {
		await test.step(`Sort column "${columnName}" ${direction}`, async () => {
			const columnHeader = this.columnHeaders.filter({ hasText: columnName });
			const menuLabel = direction === 'ascending' ? 'Sort Ascending' : 'Sort Descending';

			// Click the dropdown button inside the column header to open the
			// positron modal popup menu (not a native OS context menu).
			await columnHeader.locator('.positron-button').click();
			await this.page.getByRole('button', { name: menuLabel }).click();
		});
	}

	async scrollWithinGrid(deltaY: number): Promise<void> {
		const box = await this.content.boundingBox();
		if (box) {
			await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await this.page.mouse.wheel(0, deltaY);
		}
	}

	// --- Verifications ---

	async expectToBeVisible(timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step('Verify inline data explorer is visible', async () => {
			await expect(this.container).toBeVisible({ timeout });
		});
	}

	async expectGridToBeReady(timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step('Verify data grid is ready with content', async () => {
			await expect(this.dataGrid).toBeVisible({ timeout });
			await expect(this.columnHeaders.first()).toBeVisible({ timeout });
		});
	}

	async expectShapeToContain(rows: number | string, columns?: number | string): Promise<void> {
		await test.step(`Verify shape contains: ${rows} rows${columns ? `, ${columns} columns` : ''}`, async () => {
			await expect(this.shape).toContainText(String(rows));
			await expect(this.shape).toContainText('rows');
			if (columns !== undefined) {
				await expect(this.shape).toContainText(String(columns));
				await expect(this.shape).toContainText('columns');
			}
		});
	}

	async expectColumnHeaderToBeVisible(headerText: string): Promise<void> {
		await test.step(`Verify column header "${headerText}" is visible`, async () => {
			const headerTitle = this.columnHeaders.locator('.title').filter({ hasText: headerText });
			await expect(headerTitle.first()).toBeVisible();
		});
	}

	async expectCellToBeVisible(text: string): Promise<void> {
		await test.step(`Verify cell with text "${text}" is visible`, async () => {
			await expect(this.container.getByText(text)).toBeVisible();
		});
	}

	async expectOpenButtonToBeVisible(): Promise<void> {
		await test.step('Verify Open button is visible', async () => {
			await expect(this.openButton).toBeVisible();
		});
	}

	async expectNoError(): Promise<void> {
		await test.step('Verify no error state', async () => {
			await expect(this.errorState).not.toBeVisible();
		});
	}

	async expectColumnToBeSorted(
		columnName: string,
		expectedFirstValues: (string | number)[],
		timeout = DEFAULT_TIMEOUT
	): Promise<void> {
		await test.step(`Verify column "${columnName}" is sorted`, async () => {
			await expect(async () => {
				const headers = await this.columnHeaders.locator('.title').allInnerTexts();
				const columnIndex = headers.indexOf(columnName);
				expect(columnIndex).toBeGreaterThanOrEqual(0);

				for (let i = 0; i < expectedFirstValues.length; i++) {
					const cell = this.container.locator(
						`#data-grid-row-cell-content-${columnIndex}-${i}`
					);
					await expect(cell).toContainText(String(expectedFirstValues[i]));
				}
			}).toPass({ timeout });
		});
	}
}
