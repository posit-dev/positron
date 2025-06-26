/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as net from 'net';
import * as request from 'request';

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
	createConnection(options: any, callback?: (err: Error | null, socket?: net.Socket) => void): net.Socket {
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

/**
 * Request interceptor that configures custom agents for named pipe connections
 * @param requestOptions The request options to modify
 */
export function namedPipeInterceptor(requestOptions: request.Options): Promise<void> {
	return new Promise((resolve) => {
		// Check if this is a named pipe request
		const uri = (requestOptions as any).uri;
		if (uri && typeof uri === 'string' && uri.includes('npipe:')) {
			// Extract pipe name from URI like http://npipe:pipename:/path
			const match = uri.match(/npipe:([^:]+):/);
			if (match) {
				const pipeName = match[1];
				
				// Create custom agent for named pipes
				const agent = new NamedPipeHttpAgent(pipeName);
				
				// Replace the URI to use localhost (since the agent handles the actual connection)
				// but keep the path part
				const pathMatch = uri.match(/npipe:[^:]+:(\/.*)/);
				const path = pathMatch ? pathMatch[1] : '/';
				(requestOptions as any).uri = `http://localhost${path}`;
				
				// Set the custom agent
				(requestOptions as any).agent = agent;
			}
		}
		resolve();
	});
}
