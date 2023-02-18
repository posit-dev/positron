/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as net from 'net';

import {
	LanguageClient,
	LanguageClientOptions,
	createClientSocketTransport,
	StreamInfo,
} from 'vscode-languageclient/node';

import { trace, traceOutputChannel } from './logging';

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
	// communication.
	const serverOptions = async () => {
		const socket = net.connect({
			port: port,
			host: 'localhost',
		});
		socket.on('error', (error) => {
			trace(`Error connecting to language server on port ${port}: ${error}`);
		});
		socket.on('ready', () => {
			trace(`Connection to language server is ready on port ${port}`);
		});
		socket.on('connect', () => {
			trace(`Connected to R language server on port ${port}`);
		});
		const streams: StreamInfo = {
			reader: socket,
			writer: socket
		};
		return streams;
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
