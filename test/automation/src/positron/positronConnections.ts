/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, Locator } from '@playwright/test';
import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { PositronBaseElement } from './positronBaseElement';

const REMOVE_CONNECTION_BUTTON = 'a[aria-label="Remove connection from history"]';

const PYTHON_CONNECTION_OPEN_STATE = 'div[aria-label="SQLite Connection"]';
const R_CONNECTION_OPEN_STATE = 'div[aria-label="SQLiteConnection"]:first-child';
const RECONNECT_BUTTON = 'a[aria-label="Execute connection code in the console"]';

const CONNECTIONS_TAB_LINK = 'a[aria-label="Connections"]';
const CONNECTION_ITEM = '.connections-items-container';

/*
 *  Reuseable Positron connections tab functionality for tests to leverage
 */
export class PositronConnections {

	deleteConnectionButton: Locator;
	disconnectButton: Locator;
	rConnectionOpenState: PositronBaseElement;
	pythonConnectionOpenState: PositronBaseElement;
	reconnectButton: PositronBaseElement;
	connectionsTabLink: PositronBaseElement;

	constructor(private code: Code, private quickaccess: QuickAccess) {

		this.deleteConnectionButton = code.driver.page.getByLabel('Delete Connection');
		this.disconnectButton = code.driver.page.getByLabel('Disconnect');
		this.rConnectionOpenState = new PositronBaseElement(R_CONNECTION_OPEN_STATE, this.code);
		this.pythonConnectionOpenState = new PositronBaseElement(PYTHON_CONNECTION_OPEN_STATE, this.code);
		this.reconnectButton = new PositronBaseElement(RECONNECT_BUTTON, this.code);
		this.connectionsTabLink = new PositronBaseElement(CONNECTIONS_TAB_LINK, this.code);
	}

	async openConnectionsNodes(nodes: string[]) {
		for (const node of nodes) {
			await this.code.driver.page.locator('.connections-item').filter({ hasText: node }).locator('.codicon-chevron-right').click();
			await expect(this.code.driver.page.locator('.connections-item').filter({ hasText: node }).locator('.codicon-chevron-down')).toBeVisible();
		}
	}

	async assertConnectionNodes(nodes: string[]): Promise<void> {
		const waits = nodes.map(async node => {
			this.assertConnectionNode(node);
		});
		await Promise.all(waits);
	}

	async assertConnectionNode(node: string) {
		await expect(
			this.code.driver.page.locator(CONNECTION_ITEM).getByText(node)
		).toBeVisible();
	}

	async openConnectionPane() {
		await this.quickaccess.runCommand('connections.focus');
		// await this.connectionPaneIsOpen(); // waiting for the pane to open
	}

	// async connectionPaneIsOpen() {
	// 	await this.code.wait(500);
	// }

	async openTree() {
		await this.quickaccess.runCommand('positron.connections.expandAll');
	}
}
