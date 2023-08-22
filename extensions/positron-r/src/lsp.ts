/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
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

	/** Disposable for per-activation items */
	private activationDisposables: vscode.Disposable[] = [];

	public constructor(private readonly _version: string) {
	}

	/**
	 * Activate the language server; returns a promise that resolves when the LSP is
	 * activated.
	 *
	 * @param port The port on which the language server is listening.
	 * @param context The VSCode extension context.
	 */
	public async activate(
		port: number,
		_context: vscode.ExtensionContext
	): Promise<void> {

		// Clean up disposables from any previous activation
		this.activationDisposables.forEach(d => d.dispose());
		this.activationDisposables = [];

		// Define server options for the language server. Connects to `port`.
		const serverOptions = async (): Promise<StreamInfo> => {
			const out = new PromiseHandles<StreamInfo>();
			const socket = new Socket();

			socket.on('ready', () => {
				const streams: StreamInfo = {
					reader: socket,
					writer: socket
				};
				out.resolve(streams);
			});
			socket.on('error', (error) => {
				out.reject(error);
			});
			socket.connect(port);

			return out.promise;
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

		trace(`Creating Positron R ${this._version} language client (port ${port})...`);
		this._client = new LanguageClient('positron-r', `Positron R Language Server (${this._version})`, serverOptions, clientOptions);

		const out = new PromiseHandles<void>();
		this._initializing = out.promise;

		this.activationDisposables.push(this._client.onDidChangeState(event => {
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
						out.reject('Ark LSP client stopped before initialization');
					}
					this._state = LspState.stopped;
					break;
			}
			trace(`ARK (R ${this._version}) language client state changed ${oldState} => ${this._state}`);
		}));

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

		// If we don't need to stop the client, just resolve
		if (!this._client.needsStop()) {
			return;
		}

		// First wait for initialization to complete.
		// `stop()` should not be called on a
		// partially initialized client.
		await this._initializing;

		// The promise returned by `stop()` never resolves if the server side is
		// disconnected, so rather than awaiting it, we wait for the client to
		// change state to `stopped`, which does happen reliably.
		const promise = new Promise<void>((resolve) => {
			const disposable = this._client!.onDidChangeState((event) => {
				if (event.newState === State.Stopped) {
					resolve();
					disposable.dispose();
				}
			});
			this._client!.stop();
		});

		// Don't wait more than a couple of seconds for the client to stop.
		const timeout = new Promise<void>((_, reject) => {
			setTimeout(() => {
				reject(`Timed out after 2 seconds waiting for client to stop.`);
			}, 2000);
		});

		// Wait for the client to enter the stopped state, or for the timeout
		await Promise.race([promise, timeout]);
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
		this.activationDisposables.forEach(d => d.dispose());
		await this.deactivate();
	}
}
