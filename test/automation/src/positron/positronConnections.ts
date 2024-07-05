/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { QuickAccess } from '../quickaccess';
import { PositronBaseElement } from './positronBaseElement';

const REMOVE_CONNECTION_BUTTON = 'a[aria-label="Remove connection from history"]';
const DISCONNECT_BUTON = '.codicon-debug-disconnect';

const PYTHON_CONNECTION_OPEN_STATE = 'div[aria-label="SQLite Connection"]';
const R_CONNECTION_OPEN_STATE = 'div[aria-label="SQLiteConnection"]:first-child';
const RECONNECT_BUTTON = 'a[aria-label="Execute connection code in the console"]';

const CONNECTIONS_TAB_LINK = 'a[aria-label="Connections"]';

/*
 *  Reuseable Positron connections tab functionality for tests to leverage
 */
export class PositronConnections {

	removeConnectionButton: PositronBaseElement;
	disconnectButton: PositronBaseElement;
	rConnectionOpenState: PositronBaseElement;
	pythonConnectionOpenState: PositronBaseElement;
	reconnectButton: PositronBaseElement;
	connectionsTabLink: PositronBaseElement;

	constructor(private code: Code, private quickaccess: QuickAccess) {

		this.removeConnectionButton = new PositronBaseElement(REMOVE_CONNECTION_BUTTON, this.code);
		this.disconnectButton = new PositronBaseElement(DISCONNECT_BUTON, this.code);
		this.rConnectionOpenState = new PositronBaseElement(R_CONNECTION_OPEN_STATE, this.code);
		this.pythonConnectionOpenState = new PositronBaseElement(PYTHON_CONNECTION_OPEN_STATE, this.code);
		this.reconnectButton = new PositronBaseElement(RECONNECT_BUTTON, this.code);
		this.connectionsTabLink = new PositronBaseElement(CONNECTIONS_TAB_LINK, this.code);
	}

	async openConnectionsNodes(nodes: string[]) {
		for (const node of nodes) {
			await this.code.waitAndClick(`div[aria-label="${node}"]`);
		}
	}

	async hasConnectionNodes(nodes: string[]) {
		const waits = nodes.map(async node => {
			return await this.code.waitForElement(`div[aria-label="${node}"]`);
		});
		await Promise.all(waits);
	}

	async hasConnectionNode(node: string) {
		const x = await this.code.getElement(`div[aria-label="${node}"]`);
		return x !== undefined;
	}

	async openConnectionPane() {
		await this.quickaccess.runCommand('connections.focus');
		await this.connectionPaneIsOpen(); // waiting for the pane to open
	}

	async connectionPaneIsOpen() {
		await this.code.wait(500);
	}

	async openTree() {
		await this.quickaccess.runCommand('positron.connections.expandAll');
	}
}
