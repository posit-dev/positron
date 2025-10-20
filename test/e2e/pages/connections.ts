/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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

	constructor(private code: Code, private quickaccess: QuickAccess) {
		this.deleteConnectionButton = code.driver.page.getByLabel('Delete Connection');
		this.disconnectButton = code.driver.page.getByLabel('Disconnect');
		this.connectIcon = code.driver.page.locator('.codicon-arrow-circle-right');
		this.connectionItems = code.driver.page.locator('.connections-list-item');
		this.resumeConnectionButton = code.driver.page.locator('.positron-modal-dialog-box').getByRole('button', { name: 'Resume Connection' });
	}

	async openConnectionsNodes(nodes: string[]) {
		for (const node of nodes) {
			await this.code.driver.page.locator(CONNECTIONS_ITEM).filter({ hasText: node }).locator('.codicon-chevron-right').click();
			await expect(this.code.driver.page.locator(CONNECTIONS_ITEM).filter({ hasText: node }).locator('.codicon-chevron-down')).toBeVisible();
		}
	}

	async assertConnectionNodes(nodes: string[]): Promise<void> {
		const waits = nodes.map(async node => {
			await expect(
				this.code.driver.page.locator(CONNECTIONS_CONTAINER).getByText(node)
			).toBeVisible();
		});
		await Promise.all(waits);
	}

	async openConnectionPane() {
		await this.quickaccess.runCommand('connections.focus');
	}

	async viewConnection(name: string) {
		await this.connectionItems.filter({ hasText: name }).locator(this.connectIcon).click();
	}

	async openTree() {
		await this.quickaccess.runCommand('positron.connections.expandAll');
	}

	async deleteConnection() {
		await expect(this.code.driver.page.getByLabel('Delete Connection')).toBeVisible();
		this.deleteConnectionButton.click();
	}

	async initiateConnection(language: string, driver: string): Promise<void> {
		await test.step(`Initiating a ${language} connection to ${driver}`, async () => {
			await this.code.driver.page.getByRole('button', { name: 'New Connection' }).click();
			await this.code.driver.page.locator('.connections-new-connection-modal .codicon-chevron-down').click();
			await this.code.driver.page.locator('.positron-modal-popup-children').getByRole('button', { name: language }).click();
			await this.code.driver.page.locator('.driver-name', { hasText: driver }).click();
		});
	}

	async fillConnectionsInputs(fields: Record<string, string>) {
		await test.step('Filling connection inputs', async () => {
			for (const [labelText, value] of Object.entries(fields)) {
				const label = this.code.driver.page.locator('span.label-text', { hasText: labelText });
				const input = label.locator('+ input.text-input');
				await input.fill(value);
			}
		});
	}

	async connect() {
		await test.step('Click connect button when ready', async () => {
			await this.code.driver.page.locator('.button', { hasText: 'Connect' }).click();
		});
	}

	async expandConnectionDetails(name: string) {
		const item = this.code.driver.page.locator('.connections-details', { hasText: name });
		await item.locator('..').locator('.expand-collapse-area .codicon-chevron-right').click();
	}
}
