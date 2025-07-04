/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { createWebSocket } from '../NamedPipeHttpAgent';

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
	 * @param outputChannel The output channel to write trace messages to
	 * @param headers Optional headers to include in the WebSocket connection
	 */
	constructor(
		public readonly uri: string,
		public readonly sessionId: string,
		public readonly channel: vscode.LogOutputChannel,
		headers?: { [key: string]: string }
	) {
		// Create a new WebSocket client with optional headers
		this.ws = createWebSocket(uri, undefined, { headers });

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
