/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PromiseHandles, timeout } from './util';
import { RStatementRangeProvider } from './statement-range';
import { LOGGER } from './extension';
import { RErrorHandler } from './error-handler';

import {
	LanguageClient,
	LanguageClientOptions,
	State,
	StreamInfo,
	RevealOutputChannelOn
} from 'vscode-languageclient/node';

import { Socket } from 'net';
import { RHelpTopicProvider } from './help';
import { RLspOutputChannelManager } from './lsp-output-channel-manager';
import { R_DOCUMENT_SELECTORS } from './provider';
import { VirtualDocumentProvider } from './virtual-documents';

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
	private _stateEmitter = new vscode.EventEmitter<LspState>();
	onDidChangeState = this._stateEmitter.event;

	/** Promise that resolves after initialization is complete */
	private _initializing?: Promise<void>;

	/** Disposable for per-activation items */
	private activationDisposables: vscode.Disposable[] = [];

	private languageClientName: string;

	public constructor(
		private readonly _version: string,
		private readonly _metadata: positron.RuntimeSessionMetadata,
		private readonly _dynState: positron.LanguageRuntimeDynState,
	) {
		this.languageClientName = `Positron R Language Client (${this._version}) for session '${this._metadata.sessionId}'`;
	}

	private setState(state: LspState) {
		this._state = state;
		this._stateEmitter.fire(state);
	}

	/**
	 * Activate the language server; returns a promise that resolves when the LSP is
	 * activated.
	 *
	 * @param port The port on which the language server is listening.
	 * @param context The VSCode extension context.
	 */
	public async activate(port: number): Promise<void> {

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

		const { notebookUri } = this._metadata;

		// Persistant output channel, used across multiple sessions of the same name + mode combination
		const outputChannel = RLspOutputChannelManager.instance.getOutputChannel(
			this._dynState.sessionName,
			this._metadata.sessionMode
		);

		const clientOptions: LanguageClientOptions = {
			// If this client belongs to a notebook, set the document selector to only include that notebook.
			// Otherwise, this is the main client for this language, so set the document selector to include
			// untitled R files, in-memory R files (e.g. the console), and R / Quarto / R Markdown files on disk.
			documentSelector: notebookUri ?
				[{ language: 'r', pattern: notebookUri.fsPath }] :
				R_DOCUMENT_SELECTORS,
			synchronize: notebookUri ?
				undefined :
				{
					fileEvents: vscode.workspace.createFileSystemWatcher('**/*.R')
				},
			errorHandler: new RErrorHandler(this._version, port),
			outputChannel: outputChannel,
			revealOutputChannelOn: RevealOutputChannelOn.Never,
			middleware: {
				handleDiagnostics(uri, diagnostics, next) {
					// Disable diagnostics for Assistant code confirmation widgets:
					// https://github.com/posit-dev/positron/issues/7750
					if (uri.scheme === 'assistant-code-confirmation-widget') {
						return undefined;
					}
					return next(uri, diagnostics);
				},
			}
		};

		// With a `.` rather than a `-` so vscode-languageserver can look up related options correctly
		const id = 'positron.r';

		const message = `Creating Positron R ${this._version} language client (port ${port})`;
		LOGGER.info(message);
		outputChannel.appendLine(message);

		this._client = new LanguageClient(id, this.languageClientName, serverOptions, clientOptions);

		const out = new PromiseHandles<void>();
		this._initializing = out.promise;

		this.activationDisposables.push(this._client.onDidChangeState(event => {
			const oldState = this._state;
			// Convert the state to our own enum
			switch (event.newState) {
				case State.Starting:
					this.setState(LspState.starting);
					break;
				case State.Running:
					if (this._initializing) {
						LOGGER.info(`${this.languageClientName} init successful`);
						this._initializing = undefined;
						if (this._client) {
							// Register Positron-specific LSP extension methods
							this.registerPositronLspExtensions(this._client);
						}
						out.resolve();
					}
					this.setState(LspState.running);
					break;
				case State.Stopped:
					if (this._initializing) {
						LOGGER.info(`${this.languageClientName} init failed`);
						out.reject('Ark LSP client stopped before initialization');
					}
					this.setState(LspState.stopped);
					break;
			}
			LOGGER.info(`${this.languageClientName} state changed ${oldState} => ${this._state}`);
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

		LOGGER.info(`${this.languageClientName} is stopping`);

		// First wait for initialization to complete.
		// `stop()` should not be called on a
		// partially initialized client.
		await this._initializing;

		// Ideally we'd just wait for `this._client!.stop()`. In practice, the
		// promise returned by `stop()` never resolves if the server side is
		// disconnected, so rather than awaiting it when the runtime has exited,
		// we wait for the client to change state to `stopped`, which does
		// happen reliably.
		const stopped = new Promise<void>((resolve) => {
			const disposable = this._client!.onDidChangeState((event) => {
				if (event.newState === State.Stopped) {
					LOGGER.info(`${this.languageClientName} is stopped`);
					resolve();
					disposable.dispose();
				}
			});
		});

		this._client!.stop();

		// Don't wait more than a couple of seconds for the client to stop
		await Promise.race([stopped, timeout(2000, 'waiting for client to stop')]);
	}

	/**
	 * Gets the current state of the client.
	 */
	get state(): LspState {
		return this._state;
	}

	/**
	 * Wait for the LSP to be connected.
	 *
	 * Resolves to `true` once the LSP is connected. Resolves to `false` if the
	 * LSP has been stopped. Rejects if the LSP fails to start.
	 */
	async wait(): Promise<boolean> {
		switch (this.state) {
			case LspState.running: return true;
			case LspState.stopped: return false;

			case LspState.starting: {
				// Inherit init promise. This can reject if init fails.
				await this._initializing;
				return true;
			}

			case LspState.uninitialized: {
				const handles = new PromiseHandles<boolean>();

				const cleanup = this.onDidChangeState(state => {
					let out: boolean;
					switch (this.state) {
						case LspState.running: out = true; break;
						case LspState.stopped: out = false; break;
						case LspState.uninitialized: return;
						case LspState.starting: {
							// Inherit init promise
							if (this._initializing) {
								cleanup.dispose();
								this._initializing.
									then(() => handles.resolve(true)).
									catch((err) => handles.reject(err));
							}
							return;
						}
					}

					cleanup.dispose();
					handles.resolve(out);
				});

				return await handles.promise;
			}
		}
	}

	/**
	 * Registers additional Positron-specific LSP methods. These programmatic
	 * language features are not part of the LSP specification, and are
	 * consequently not covered by vscode-languageserver, but are used by
	 * Positron to provide additional functionality.
	 *
	 * @param client The language client instance
	 */
	private registerPositronLspExtensions(client: LanguageClient) {
		// Provide virtual documents.
		const vdocDisposable = vscode.workspace.registerTextDocumentContentProvider('ark',
			new VirtualDocumentProvider(client));
		this.activationDisposables.push(vdocDisposable);

		// Register a statement range provider to detect R statements
		const rangeDisposable = positron.languages.registerStatementRangeProvider('r',
			new RStatementRangeProvider(client));
		this.activationDisposables.push(rangeDisposable);

		// Register a help topic provider to provide help topics for R
		const helpDisposable = positron.languages.registerHelpTopicProvider('r',
			new RHelpTopicProvider(client));
		this.activationDisposables.push(helpDisposable);
	}

	/**
	 * Dispose of the client instance.
	 */
	async dispose() {
		this.activationDisposables.forEach(d => d.dispose());
		await this.deactivate();
	}

	public showOutput() {
		const outputChannel = RLspOutputChannelManager.instance.getOutputChannel(
			this._dynState.sessionName,
			this._metadata.sessionMode
		);
		outputChannel.show();
	}
}
