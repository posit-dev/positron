/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	createClientSocketTransport,
	StreamInfo,
} from 'vscode-languageclient/node';

import { trace, traceOutputChannel } from './logging';
import { Socket } from 'net';

// A global instance of the LSP language client provided by this language pack
let client: LanguageClient;

/**
 * Activate the language server; returns a promise that resolves when the LSP is
 * activated.
 *
 * @param port The port on which the language server is listening.
 * @param context The VSCode extension context.
 */
export async function activateLsp(port: number,
	context: vscode.ExtensionContext): Promise<void> {

	// Define server options for the language server; this is a callback
	// that creates and returns the reader/writer stream for TCP
	// communication. It will retry up to 20 times, with a back-off
	// interval. We do this because the language server may not be
	// ready to accept connections when we first try to connect.
	const serverOptions = async (): Promise<StreamInfo> => {

		const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

		const maxAttempts = 20;
		const baseDelay = 50;
		const multiplier = 1.5;

		const tryToConnect = async (port: number): Promise<Socket> => {
			return new Promise((resolve, reject) => {
				const socket = new Socket();
				socket.on('ready', () => {
					resolve(socket);
				});
				socket.on('error', (error) => {
					reject(error);
				});
				socket.connect(port);
			});
		};

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			// Retry up to five times then start to back-off
			const interval = attempt < 6 ? baseDelay : baseDelay * multiplier * attempt;
			if (attempt > 0) {
				await delay(interval);
			}

			try {
				// Try to connect to LSP port
				const socket: Socket = await tryToConnect(port);
				const streams: StreamInfo = {
					reader: socket,
					writer: socket
				};
				return streams;
			} catch (error: any) {
				if (error?.code === 'ECONNREFUSED') {
					trace(`Error '${error.message}' on connection attempt '${attempt}' to Ark LSP on port '${port}', will retry`);
				} else {
					throw error;
				}
			}
		}
		throw new Error(`Failed to create TCP connection to Ark LSP on port ${port} after ${maxAttempts} attempts`);
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'r' }],
		synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.R') },
		traceOutputChannel: traceOutputChannel(),
	};

	trace('Creating Positron R language client...');
	client = new LanguageClient('positron-r', 'Positron R Language Server', serverOptions, clientOptions);

	client.onDidChangeState(event => {
		trace(`ARK language client state changed ${event.oldState} => ${event.newState}`);
	});

	context.subscriptions.push(client.start());

	return new Promise<void>((resolve, reject) => {
		client.onReady().then(() => {
			trace('Positron R language client is ready');
			resolve();

			// Placeholder for custom notification.
			setTimeout(async () => {

				trace('Sending a "positron/request" request.');
				try {
					const response = await client.sendRequest('positron/request', { value: 42 });
					trace(`Got a response: ${response}`);
				} catch (error) {
					trace(`Error sending request: ${error}`);
				}

				trace('Sending a "positron/notification" notification.');
				try {
					client.sendNotification('positron/notification');
				} catch (error) {
					trace(`Error sending notification: ${error}`);
				}


			}, 5000);
		});
	});
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop();
}
