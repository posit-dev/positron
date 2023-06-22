/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PromiseHandles } from './util';

import {
	LanguageClient,
	LanguageClientOptions,
	State,
	StreamInfo,
} from 'vscode-languageclient/node';

import { trace, traceOutputChannel } from './logging';
import { Socket } from 'net';

/**
 * The state of the language server.
 */
export enum LspState {
	uninitialized = 'uninitialized',
	starting = 'starting',
	stopped = 'stopped',
	running = 'running',
}

/**
 * Wraps an instance of the client side of the ARK LSP.
 */
export class ArkLsp implements vscode.Disposable {

	/** The languge client instance, if it has been created */
	private _client?: LanguageClient;

	private _state: LspState = LspState.uninitialized;

	/** Promise that resolves after initialization is complete */
	private _initializing?: Promise<void>;

	public constructor(private readonly _version: string) {
	}

	/**
	 * Activate the language server; returns a promise that resolves when the LSP is
	 * activated.
	 *
	 * @param port The port on which the language server is listening.
	 * @param context The VSCode extension context.
	 */
	public async activate(port: number,
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
						trace(`Error '${error.message}' on connection attempt '${attempt}' to Ark LSP (R ${this._version}) on port '${port}', will retry`);
					} else {
						throw error;
					}
				}
			}
			throw new Error(`Failed to create TCP connection to Ark LSP (R ${this._version}) on port ${port} after ${maxAttempts} attempts`);
		};

		const clientOptions: LanguageClientOptions = {
			documentSelector: [
				{ language: 'r' },
			],
			synchronize: {
				fileEvents: vscode.workspace.createFileSystemWatcher('**/*.R')
			},
			traceOutputChannel: traceOutputChannel(),
		};

		trace(`Creating Positron R ${this._version} language client...`);
		this._client = new LanguageClient('positron-r', `Positron R Language Server (${this._version})`, serverOptions, clientOptions);

		const out = new PromiseHandles<void>();
		this._initializing = out.promise;

		this._client.onDidChangeState(event => {
			const oldState = this._state;
			// Convert the state to our own enum
			switch (event.newState) {
				case State.Starting:
					this._state = LspState.starting;
					break;
				case State.Running:
					if (this._initializing) {
						trace(`ARK (R ${this._version}) language client init successful`);
						this._initializing = undefined;
						out.resolve();
					}
					this._state = LspState.running;
					break;
				case State.Stopped:
					if (this._initializing) {
						trace(`ARK (R ${this._version}) language client init failed`);
						out.reject("Ark LSP client stopped before initialization");
					}
					this._state = LspState.stopped;
					break;
			}
			trace(`ARK (R ${this._version}) language client state changed ${oldState} => ${this._state}`);
		});

		this._client.start();
		await out.promise;
	}

	/**
	 * Stops the client instance.
	 *
	 * @returns A promise that resolves when the client has been stopped.
	 */
	public async deactivate() {
		if (!this._client) {
			// No client to stop, so just resolve
			return;
		}

		// First wait for initialization to complete.
		// `stop()` should not be called on a
		// partially initialized client.
		await this._initializing;

		// Stop the client if it's running
		await this._client.stop();
	}

	/**
	 * Gets the current state of the client.
	 */
	get state(): LspState {
		return this._state;
	}

	/**
	 * Dispose of the client instance.
	 */
	async dispose() {
		await this.deactivate();
	}
}
