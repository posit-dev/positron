/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, Locator } from '@playwright/test';
import { Code } from '../code';
import { QuickAccess } from '../quickaccess';

const CONNECTION_CONTAINER = '.connections-items-container';
const CONNECTION_ITEM = '.connections-list-item';
const CONNECTION_ICON = '.codicon-arrow-circle-right';

/*
 *  Reuseable Positron connections tab functionality for tests to leverage
 */
export class PositronConnections {

	deleteConnectionButton: Locator;
	disconnectButton: Locator;
	connectionIcon: Locator;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.deleteConnectionButton = code.driver.page.getByLabel('Delete Connection');
		this.disconnectButton = code.driver.page.getByLabel('Disconnect');
		this.connectionIcon = code.driver.page.locator(CONNECTION_ICON);
	}

	async openConnectionsNodes(nodes: string[]) {
		for (const node of nodes) {
			await this.code.driver.page.locator('.connections-item').filter({ hasText: node }).locator('.codicon-chevron-right').click();
			await expect(this.code.driver.page.locator('.connections-item').filter({ hasText: node }).locator('.codicon-chevron-down')).toBeVisible();
		}
	}

	async assertConnectionNodes(nodes: string[]): Promise<void> {
		const waits = nodes.map(async node => {
			await expect(
				this.code.driver.page.locator(CONNECTION_CONTAINER).getByText(node)
			).toBeVisible();
		});
		await Promise.all(waits);
	}

	async openConnectionPane() {
		await this.quickaccess.runCommand('connections.focus');
	}

	async viewConnection(name: string) {
		await this.code.driver.page.locator(CONNECTION_ITEM).filter({ hasText: name }).locator(CONNECTION_ICON).click();
	}

	async openTree() {
		await this.quickaccess.runCommand('positron.connections.expandAll');
	}
}
