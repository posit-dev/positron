/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	createClientSocketTransport,
} from 'vscode-languageclient/node';

import { trace, traceOutputChannel } from './logging';

// A global instance of the LSP language client provided by this language pack
let client: LanguageClient;

/**
 * Activate the language server; returns a promise that resolves to the port on
 * which the client is listening.
 *
 * @param context The VSCode extension context.
 */
export async function activateLsp(context: vscode.ExtensionContext): Promise<number> {

	return new Promise((resolve, reject) => {

		// Define server options for the language server; this is a callback
		// that creates and returns the reader/writer stream for TCP
		// communication.
		const serverOptions = async () => {

			// Find an open port for the language server to listen on.
			trace('Finding open port for R language server...');
			const portfinder = require('portfinder');
			const port = await portfinder.getPortPromise();
			const address = `127.0.0.1:${port}`;

			// Create our own socket transport
			const transport = await createClientSocketTransport(port);

			// Allow kernel startup to proceed
			resolve(port);

			// Wait for the language server to connect to us
			trace(`Waiting to connect to language server at ${address}...`);
			const protocol = await transport.onConnected();
			trace(`Connected to language server at ${address}, returning protocol transports`);

			return {
				reader: protocol[0],
				writer: protocol[1],
			};

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

		client.onReady().then(() => {
			trace('Positron R language client is ready');

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
