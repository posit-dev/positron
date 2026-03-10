/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

const CONNECTIONS_CONTAINER = '.connections-items-container';
const CONNECTIONS_ITEM = '.connections-item';

/*
 *  Reuseable Positron connections tab functionality for tests to leverage
 */
export class Connections {

	deleteConnectionButton: Locator;
	disconnectButton: Locator;
	connectIcon: Locator;
	connectionItems: Locator;
	resumeConnectionButton: Locator;
	currentConnectionName: Locator;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.deleteConnectionButton = code.driver.currentPage.getByLabel('Delete Connection');
		this.disconnectButton = code.driver.currentPage.getByLabel('Disconnect');
		this.connectIcon = code.driver.currentPage.locator('.codicon-arrow-circle-right');
		this.connectionItems = code.driver.currentPage.locator('.connections-list-item');
		this.resumeConnectionButton = code.driver.currentPage.locator('.positron-modal-dialog-box').getByRole('button', { name: 'Resume Connection' });
		this.currentConnectionName = code.driver.currentPage.locator('.connections-instance-details .connection-name');
	}

	async openConnectionsNodes(nodes: string[]) {
		for (const node of nodes) {
			await this.code.driver.currentPage.locator(CONNECTIONS_ITEM).filter({ hasText: node }).locator('.codicon-chevron-right').click();
			await expect(this.code.driver.currentPage.locator(CONNECTIONS_ITEM).filter({ hasText: node }).locator('.codicon-chevron-down')).toBeVisible();
		}
	}

	async assertConnectionNodes(nodes: string[]): Promise<void> {
		const waits = nodes.map(async node => {
			await expect(
				this.code.driver.currentPage.locator(CONNECTIONS_CONTAINER).getByText(node)
			).toBeVisible();
		});
		await Promise.all(waits);
	}

	async openConnectionPane() {
		await this.quickaccess.runCommand('connections.focus');
	}

	async viewConnection(name: string) {
		// Check if we're already viewing this connection (wait up to 1s for UI to settle)
		let isAlreadyViewing = false;
		try {
			await this.currentConnectionName.filter({ hasText: name }).waitFor({ state: 'visible', timeout: 5000 });
			isAlreadyViewing = true;
		} catch {
			// Not already viewing this connection
		}

		if (!isAlreadyViewing) {
			await this.connectionItems.filter({ hasText: name }).locator(this.connectIcon).click();
		}
	}

	async openTree() {
		await this.quickaccess.runCommand('positron.connections.expandAll');
	}

	async deleteConnection() {
		await expect(this.code.driver.currentPage.getByLabel('Delete Connection')).toBeVisible();
		this.deleteConnectionButton.click();
	}

	async initiateConnection(language: string, driver: string): Promise<void> {
		await test.step(`Initiating a ${language} connection to ${driver}`, async () => {
			await this.code.driver.currentPage.getByRole('button', { name: 'New Connection' }).click();
			await this.code.driver.currentPage.locator('.connections-new-connection-modal .codicon-chevron-down').click();
			await this.code.driver.currentPage.locator('.positron-modal-popup-children').getByRole('button', { name: language }).click();
			await this.code.driver.currentPage.locator('.driver-name', { hasText: driver }).click();
		});
	}

	async fillConnectionsInputs(fields: Record<string, string>) {
		await test.step('Filling connection inputs', async () => {
			for (const [labelText, value] of Object.entries(fields)) {
				const label = this.code.driver.currentPage.locator('span.label-text', { hasText: labelText });
				const input = label.locator('+ input.text-input');
				await input.fill(value);
			}
		});
	}

	async connect() {
		await test.step('Click connect button when ready', async () => {
			await this.code.driver.currentPage.locator('.button', { hasText: 'Connect' }).click();
		});
	}

	async expandConnectionDetails(name: string) {
		const item = this.code.driver.currentPage.locator('.connections-details', { hasText: name });
		await item.locator('..').locator('.expand-collapse-area .codicon-chevron-right').click();
	}
}
