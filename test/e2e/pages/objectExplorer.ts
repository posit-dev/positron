/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator, Page } from '@playwright/test';

/**
 * The Object Explorer editor.
 */
export class ObjectExplorer {
	readonly container: Locator;
	readonly statusLabel: Locator;
	readonly searchBox: Locator;
	readonly closedNotice: Locator;
	readonly stickyRows: Locator;

	constructor(private page: Page) {
		this.container = this.page.locator('.positron-object-explorer-container .positron-object-explorer');
		this.statusLabel = this.container.getByTestId('object-explorer-status-label');
		this.searchBox = this.page.getByPlaceholder('Search names and values');
		this.closedNotice = this.container.getByRole('button', { name: 'Close Object Explorer' });
		this.stickyRows = this.container.getByTestId('data-grid-sticky-rows');
	}

	/**
	 * The tree row whose name is `name`.
	 */
	row(name: string): Locator {
		return this.container.locator('.data-grid-rows .positron-tree-row').filter({
			has: this.page.getByTestId('object-explorer-name').getByText(name, { exact: true })
		});
	}

	async expectRow(name: string, { type, value }: { type?: string; value?: string } = {}): Promise<void> {
		await test.step(`Expect row "${name}"`, async () => {
			const row = this.row(name);
			await expect(row).toBeVisible();
			if (type !== undefined) {
				await expect(row.getByTestId('object-explorer-type')).toHaveText(type);
			}
			if (value !== undefined) {
				await expect(row.getByTestId('object-explorer-value')).toHaveText(value);
			}
		});
	}

	async expandRow(name: string): Promise<void> {
		await test.step(`Expand row "${name}"`, async () => {
			await this.row(name).getByRole('button', { name: 'Expand' }).click();
			await expect(this.row(name).getByRole('button', { name: 'Collapse' })).toBeVisible();
		});
	}

	async selectRow(name: string): Promise<void> {
		await test.step(`Select row "${name}"`, async () => {
			await this.row(name).getByTestId('object-explorer-name').click();
		});
	}

	async expectStatus(text: string): Promise<void> {
		await expect(this.statusLabel).toHaveText(text);
	}

	async search(text: string): Promise<void> {
		await test.step(`Search for "${text}"`, async () => {
			await this.searchBox.fill(text);
		});
	}

	async clearSearch(): Promise<void> {
		await test.step('Clear search', async () => {
			await this.searchBox.fill('');
		});
	}

	async expectMatches(texts: string[]): Promise<void> {
		await expect(this.container.getByTestId('object-explorer-match')).toHaveText(texts);
	}
}
