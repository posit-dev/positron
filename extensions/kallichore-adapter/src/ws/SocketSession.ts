/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import WebSocket from 'ws';

/**
 * Represents a session with a WebSocket client.
 */
export class SocketSession implements vscode.Disposable {
	public readonly userId: string;
	public readonly ws: WebSocket;

	/**
	 * Create a new session with a WebSocket client.
	 *
	 * @param uri The WebSocket URI to connect to
	 * @param sessionId The session ID to use
	 */
	constructor(
		public readonly uri: string,
		public readonly sessionId: string
	) {
		// Create a new WebSocket client
		this.ws = new WebSocket(uri);

		// Record the current user ID; this is attached to every message sent
		// from the client
		this.userId = os.userInfo().username;
	}

	/**
	 * Close the WebSocket connection.
	 */
	close() {
		this.ws.close();
	}

	dispose() {
		this.close();
	}
}
