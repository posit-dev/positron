/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { LanguageClient, LanguageClientOptions, State, StreamInfo } from 'vscode-languageclient/node';
import { Socket } from 'net';

import { PYTHON_LANGUAGE } from '../common/constants';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { ProgressReporting } from '../activation/progress';
import { PromiseHandles } from './util';
import { PythonErrorHandler } from './errorHandler';
import { PythonHelpTopicProvider } from './help';
import { PythonStatementRangeProvider } from './statementRange';
import { PythonLspOutputChannelManager } from './lspOutputChannelManager';

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
 * Wraps an instance of the client side of the Python LSP.
 */
export class PythonLsp implements vscode.Disposable {
    /** The languge client instance, if it has been created */
    private _client?: LanguageClient;

    private _state: LspState = LspState.uninitialized;

    /** Promise that resolves after initialization is complete */
    private _initializing?: Promise<void>;

    private _outputChannel: vscode.OutputChannel;

    /** Disposable for per-activation items */
    private activationDisposables: vscode.Disposable[] = [];

    public constructor(
        private readonly serviceContainer: IServiceContainer,
        private readonly _version: string,
        private readonly _clientOptions: LanguageClientOptions,
        private readonly _metadata: positron.RuntimeSessionMetadata,
        private readonly _dynState: positron.LanguageRuntimeDynState,
    ) {
        // Persistant output channel, used across multiple sessions of the same name + mode combination
        this._outputChannel = PythonLspOutputChannelManager.instance.getOutputChannel(
            this._dynState.sessionName,
            this._metadata.sessionMode,
        );
    }

    /**
     * Activate the language server; returns a promise that resolves when the LSP is
     * activated.
     *
     * @param port The port on which the language server is listening.
     */
    public async activate(port: number): Promise<void> {
        // Clean up disposables from any previous activation
        this.activationDisposables.forEach((d) => d.dispose());
        this.activationDisposables = [];

        // Define server options for the language server. Connects to `port`.
        const serverOptions = async (): Promise<StreamInfo> => {
            const out = new PromiseHandles<StreamInfo>();
            const socket = new Socket();

            socket.on('ready', () => {
                const streams: StreamInfo = {
                    reader: socket,
                    writer: socket,
                };
                out.resolve(streams);
            });
            socket.on('error', (error) => {
                out.reject(error);
            });
            socket.connect(port);

            return out.promise;
        };

        const { notebookUri, workingDirectory } = this._metadata;

        // If this client belongs to a notebook, set the document selector to only include that notebook.
        // Otherwise, this is the main client for this language, so set the document selector to include
        // untitled Python files, in-memory Python files (e.g. the console), and Python files on disk.
        this._clientOptions.documentSelector = notebookUri
            ? [{ language: 'python', pattern: notebookUri.fsPath }]
            : [
                  { language: 'python', scheme: 'untitled' },
                  { language: 'python', scheme: 'inmemory' }, // Console
                  // Assistant code confirmation widget: https://github.com/posit-dev/positron/issues/7750
                  { language: 'python', scheme: 'assistant-code-confirmation-widget' },
                  { language: 'python', pattern: '**/*.py' },
              ];

        // This is needed in addition to the document selector, otherwise every client seems to
        // produce diagnostics for each notebook.
        this._clientOptions.notebookDocumentOptions = notebookUri
            ? // If this client belongs to a notebook, only include cells belonging to the notebook.
              {
                  filterCells: (notebookDocument, cells) =>
                      notebookUri.toString() === notebookDocument.uri.toString() ? cells : [],
              }
            : // For console clients, exclude all notebook cells.
              { filterCells: () => [] };

        // Override default error handler with one that doesn't automatically restart the client,
        // and that logs to the appropriate place.
        this._clientOptions.errorHandler = new PythonErrorHandler(this._version, port);

        // Override default output channel with our persistant one that is reused across sessions.
        this._clientOptions.outputChannel = this._outputChannel;

        // Set Positron-specific server initialization options.
        // If this server is for a notebook, set the notebook path option.
        if (notebookUri) {
            this._clientOptions.initializationOptions.positron = {
                working_directory: workingDirectory,
            };
        }

        const message = `Creating Python ${this._version} language client (port ${port})`;
        traceInfo(message);
        this._outputChannel.appendLine(message);

        this._client = new LanguageClient(
            PYTHON_LANGUAGE,
            `Python Language Server (${this._version})`,
            serverOptions,
            this._clientOptions,
        );

        const out = new PromiseHandles<void>();
        this._initializing = out.promise;

        this.activationDisposables.push(
            this._client.onDidChangeState((event) => {
                const oldState = this._state;
                // Convert the state to our own enum
                switch (event.newState) {
                    case State.Starting:
                        this._state = LspState.starting;
                        break;
                    case State.Running:
                        if (this._initializing) {
                            traceInfo(`Python (${this._version}) language client init successful`);
                            this._initializing = undefined;
                            out.resolve();
                        }
                        if (this._client) {
                            // Register Positron-specific LSP extension methods
                            this.registerPositronLspExtensions(this._client);
                        }
                        this._state = LspState.running;
                        break;
                    case State.Stopped:
                        if (this._initializing) {
                            traceInfo(`Python (${this._version}) language client init failed`);
                            out.reject('Python LSP client stopped before initialization');
                        }
                        this._state = LspState.stopped;
                        break;
                    default:
                        traceError(`Unexpected language client state: ${event.newState}`);
                        out.reject('Unexpected language client state');
                }
                traceInfo(`Python (${this._version}) language client state changed ${oldState} => ${this._state}`);
            }),
        );

        this.activationDisposables.push(new ProgressReporting(this._client));

        this._client.start();
        await out.promise;
    }

    /**
     * Stops the client instance.
     *
     * @returns A promise that resolves when the client has been stopped.
     */
    public async deactivate(): Promise<void> {
        if (!this._client) {
            // No client to stop, so just resolve
            this._outputChannel.appendLine('No client to stop');
            return;
        }

        // If we don't need to stop the client, just resolve
        if (!this._client.needsStop()) {
            this._outputChannel.appendLine('Client does not need to stop');
            return;
        }

        // First wait for initialization to complete.
        // `stop()` should not be called on a
        // partially initialized client.
        this._outputChannel.appendLine('Waiting for client to initialize before stopping');
        await this._initializing;

        // Ideally we'd just wait for `this._client!.stop()`. In practice, the
        // promise returned by `stop()` never resolves if the server side is
        // disconnected, so rather than awaiting it when the runtime has exited,
        // we wait for the client to change state to `stopped`, which does
        // happen reliably.
        this._outputChannel.appendLine('Client initialized, stopping');
        const stopped = new Promise<void>((resolve) => {
            const disposable = this._client!.onDidChangeState((event) => {
                this._outputChannel.appendLine(`Client stopped state change: ${event.newState}`);
                if (event.newState === State.Stopped) {
                    this._outputChannel.appendLine('Client stopped');
                    resolve();
                    disposable.dispose();
                }
            });
            this._client!.stop();
        });

        const timeout = new Promise<void>((_, reject) => {
            setTimeout(() => {
                this._outputChannel.appendLine(`Timed out after 2 seconds waiting for client to stop.`);
                reject(Error(`Timed out after 2 seconds waiting for client to stop.`));
            }, 2000);
        });

        // Don't wait more than a couple of seconds for the client to stop
        await Promise.race([stopped, timeout]);
    }

    /**
     * Gets the current state of the client.
     */
    get state(): LspState {
        return this._state;
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
        // Register a statement range provider to detect Python statements
        const rangeDisposable = positron.languages.registerStatementRangeProvider(
            'python',
            new PythonStatementRangeProvider(this.serviceContainer),
        );
        this.activationDisposables.push(rangeDisposable);

        // Register a help topic provider to provide help topics for Python
        const helpDisposable = positron.languages.registerHelpTopicProvider(
            'python',
            new PythonHelpTopicProvider(client),
        );
        this.activationDisposables.push(helpDisposable);
    }

    /**
     * Dispose of the client instance.
     */
    async dispose(): Promise<void> {
        this.activationDisposables.forEach((d) => d.dispose());
        await this.deactivate();
    }

    /**
     * Displays the output channel associated with the current Python LSP session.
     *
     * This method retrieves the output channel using the session name and session mode
     * from the metadata, and then shows the output channel to the user.
     */
    public showOutput(): void {
        this._outputChannel.show();
    }
}
