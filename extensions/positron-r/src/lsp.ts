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
export enum ArkLspState {
	Uninitialized = 'uninitialized',
	Starting = 'starting',
	Stopped = 'stopped',
	Running = 'running',
}

export interface ArkLspStateChangeEvent {
	oldState: ArkLspState;
	newState: ArkLspState;
}

/**
 * Wraps an instance of the client side of the ARK LSP.
 */
export class ArkLsp implements vscode.Disposable {
	/** The language client instance, if it has been created */
	private client?: LanguageClient;

	private _state: ArkLspState = ArkLspState.Uninitialized;
	private _stateEmitter = new vscode.EventEmitter<ArkLspStateChangeEvent>();
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
		this.languageClientName = `Ark (R ${this._version} language client) for session ${_dynState.sessionName} - '${_metadata.sessionId}'`;
	}

	private setState(state: ArkLspState) {
		const old = this._state;
		this._state = state;
		this._stateEmitter.fire({ oldState: old, newState: state });
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

		const message = `Creating language client ${this._dynState.sessionName} for session ${this._metadata.sessionId} on port ${port}`;

		LOGGER.info(message);
		outputChannel.appendLine(message);

		this.client = new LanguageClient(id, this.languageClientName, serverOptions, clientOptions);

		const out = new PromiseHandles<void>();
		this._initializing = out.promise;

		this.activationDisposables.push(this.client.onDidChangeState(event => {
			const oldState = this._state;
			// Convert the state to our own enum
			switch (event.newState) {
				case State.Starting:
					this.setState(ArkLspState.Starting);
					break;
				case State.Running:
					if (this._initializing) {
						LOGGER.info(`${this.languageClientName} init successful`);
						this._initializing = undefined;
						if (this.client) {
							// Register Positron-specific LSP extension methods
							this.registerPositronLspExtensions(this.client);
						}
						out.resolve();
					}
					this.setState(ArkLspState.Running);
					break;
				case State.Stopped:
					if (this._initializing) {
						LOGGER.info(`${this.languageClientName} init failed`);
						out.reject('Ark LSP client stopped before initialization');
					}
					this.setState(ArkLspState.Stopped);
					break;
			}
			LOGGER.info(`${this.languageClientName} state changed ${oldState} => ${this._state}`);
		}));

		this.client.start();
		await out.promise;
	}

	/**
	 * Stops the client instance.
	 *
	 * @returns A promise that resolves when the client has been stopped.
	 */
	public async deactivate() {
		if (!this.client) {
			// No client to stop, so just resolve
			return;
		}

		// If we don't need to stop the client, just resolve
		if (!this.client.needsStop()) {
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
			const disposable = this.client!.onDidChangeState((event) => {
				if (event.newState === State.Stopped) {
					LOGGER.info(`${this.languageClientName} is stopped`);
					resolve();
					disposable.dispose();
				}
			});
		});

		this.client!.stop();

		// Don't wait more than a couple of seconds for the client to stop
		await Promise.race([stopped, timeout(2000, 'waiting for client to stop')]);
	}

	/**
	 * Gets the current state of the client.
	 */
	get state(): ArkLspState {
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
			case ArkLspState.Running: return true;
			case ArkLspState.Stopped: return false;

			case ArkLspState.Starting: {
				// Inherit init promise. This can reject if init fails.
				await this._initializing;
				return true;
			}

			case ArkLspState.Uninitialized: {
				const handles = new PromiseHandles<boolean>();

				const cleanup = this.onDidChangeState(_state => {
					let out: boolean;
					switch (this.state) {
						case ArkLspState.Running: out = true; break;
						case ArkLspState.Stopped: out = false; break;
						case ArkLspState.Uninitialized: return;
						case ArkLspState.Starting: {
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
