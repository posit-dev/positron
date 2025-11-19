/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as net from 'net';
import WebSocket from 'ws';

/**
 * Custom HTTP Agent that can handle Windows named pipes using the net module.
 * This allows HTTP requests to be sent over named pipes instead of TCP sockets.
 */
export class NamedPipeHttpAgent extends http.Agent {
	private pipeName: string;

	constructor(pipeName: string, options?: http.AgentOptions) {
		super(options);
		this.pipeName = pipeName;
	}

	/**
	 * Override the createConnection method to use named pipes instead of TCP sockets
	 */
	createConnection(_options: any, callback?: (err: Error | null, socket?: net.Socket) => void): net.Socket {
		// Create a connection to the named pipe
		const socket = net.connect(this.pipeName);

		if (callback) {
			socket.on('connect', () => callback(null, socket));
			socket.on('error', (err) => callback(err));
		}

		return socket;
	}
}

/**
 * Custom WebSocket class that can connect over Windows named pipes. Handles the
 * `ws+npipe://` protocol. This allows WebSocket connections to be made over
 * named pipes instead of TCP sockets.
 */
export class NamedPipeWebSocket extends WebSocket {
	constructor(address: string, protocols?: string | string[], options?: any) {
		// Parse the ws+npipe:// URL to extract pipe name and path
		// Format: ws+npipe://\\.\pipe\name:/path
		const match = address.match(/^ws\+npipe:\/\/([^:]+):(.*)$/);
		if (!match) {
			throw new Error(`Invalid ws+npipe URL: ${address}`);
		}

		const pipeName = match[1];
		const path = match[2] || '/';

		// Convert to a regular ws:// URL for the WebSocket protocol
		const wsUrl = `ws://localhost${path}`;

		// Create WebSocket options with custom agent for named pipes
		const wsOptions = {
			...options,
			agent: new NamedPipeHttpAgent(pipeName)
		};

		super(wsUrl, protocols, wsOptions);
	}
}

/**
 * Creates a WebSocket instance appropriate for the given URL
 *
 * @param url The WebSocket URL
 * @param protocols WebSocket protocols
 * @param options WebSocket options
 * @returns A WebSocket instance
 */
export function createWebSocket(url: string, protocols?: string | string[], options?: any): WebSocket {
	if (url.startsWith('ws+npipe://')) {
		return new NamedPipeWebSocket(url, protocols, options);
	}

	// Return regular WebSocket for other protocols
	return new WebSocket(url, protocols, options);
}

/**
 * Creates an HTTP agent appropriate for the given base path
 * @param basePath The API base path
 * @returns An HTTP agent or undefined for default behavior
 */
export function createHttpAgent(basePath: string): http.Agent | undefined {
	if (basePath.includes('npipe:')) {
		// Extract pipe name from base path like http://npipe:pipename:
		const match = basePath.match(/npipe:([^:]+):/);
		if (match) {
			const pipeName = match[1];
			return new NamedPipeHttpAgent(pipeName);
		}
	}

	// Return undefined for TCP and Unix socket connections to use default behavior
	return undefined;
}
