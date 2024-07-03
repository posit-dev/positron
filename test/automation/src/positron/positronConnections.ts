/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';
import { PositronBaseElement } from './positronBaseElement';

const REMOVE_CONNECTION_BUTTON = 'a[aria-label="Remove connection from history"]';
const DISCONNECT_BUTON = '.codicon-debug-disconnect';
const PYTHON_SQLITE_CONNECTION = 'div[aria-label="SQLite Connection"]';
const PYTHON_ROOT_NODE = 'div[aria-label="main"]';

const R_SQLITE_CONNECTION = 'a:has-text("SQLiteConnection")';
const R_ROOT_NODE_1 = 'div[aria-label="SQLiteConnection"]:last-child';
const R_ROOT_NODE_2 = 'div[aria-label="Default"]';

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

	constructor(private code: Code) {

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

	async hasConnectionNode(node: string) {
		const x = await this.code.getElement(`div[aria-label="${node}"]`);
		return x !== undefined;
	}

	async openPythonTree() {
		await this.code.waitAndClick(PYTHON_SQLITE_CONNECTION);
		await this.code.waitAndClick(PYTHON_ROOT_NODE);
	}

	async openRTree() {

		// not working due to timing:
		// await app.code.waitAndClick('div[aria-label="SQLiteConnection"]');
		// workaround for above:
		await this.code.driver.getLocator(R_SQLITE_CONNECTION).click();

		await this.code.waitAndClick(R_ROOT_NODE_1);
		await this.code.waitAndClick(R_ROOT_NODE_2);
	}
}
