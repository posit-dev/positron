/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
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

// Regex to match Quarto virtual document files: .vdoc.[uuid].[ext]
const VDOC_PATTERN = /^\.vdoc\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\w+$/i;

// Regex to match notebook console REPL URIs: /notebook-repl-<lang>-<uuid>
const NOTEBOOK_REPL_PATTERN = /^\/notebook-repl-/;

/**
 * Global output channel for Python LSP sessions
 *
 * Since we only have one LSP session active at any time, and since the start of
 * a new session is logged with a session ID, we use a single output channel for
 * all LSP sessions. Watch out for session start log messages to find the
 * relevant section of the log.
 */
let _lspOutputChannel: vscode.OutputChannel | undefined;
function getLspOutputChannel(): vscode.OutputChannel {
    if (!_lspOutputChannel) {
        _lspOutputChannel = positron.window.createRawLogOutputChannel('Python Language Server');
    }
    return _lspOutputChannel;
}

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
    ) {
        // Persistant output channel, used across multiple sessions of the same name + mode combination
        this._outputChannel = getLspOutputChannel();
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

        // If this client belongs to a notebook, set the document selector to only include that notebook,
        // Quarto virtual documents (vdocs), and notebook console inputs (inmemory scheme).
        // Otherwise, this is the main client for this language, so set the document selector to include
        // untitled Python files, in-memory Python files (e.g. the console), and Python files on disk.
        this._clientOptions.documentSelector = notebookUri
            ? [
                  { language: 'python', pattern: notebookUri.fsPath },
                  // Match Quarto virtual documents (vdocs). Vdocs are
                  // temporary .py files created for LSP features in
                  // embedded code blocks (e.g. completions, hover).
                  // They may be in the document's directory or in a
                  // system temp directory, so use a global pattern.
                  { language: 'python', pattern: '**/.vdoc.*.py' },
                  // Match notebook console inputs. These use the
                  // inmemory scheme with a notebook-repl path prefix
                  // to distinguish them from regular console inputs.
                  { language: 'python', scheme: 'inmemory' },
              ]
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

        // Add middleware to filter diagnostics for Quarto virtual documents:
        // https://github.com/quarto-dev/quarto/issues/855
        // Also set the priorities for completion items and hovers based on Positron LSP server extensions.
        this._clientOptions.middleware = {
            handleDiagnostics(uri, diagnostics, next) {
                // Only check file URIs because vdocs are files on disk
                if (uri.scheme === 'file') {
                    const baseName = path.basename(uri.fsPath);
                    if (VDOC_PATTERN.test(baseName)) {
                        return;
                    }
                }
                return next(uri, diagnostics);
            },
            // Apply per-completion-item priority set by the Positron LSP server.
            // Filter completions so each LSP only handles its own documents.
            // The console LSP skips vdocs and notebook console inputs;
            // the notebook LSP skips regular console inputs.
            provideCompletionItem(document, position, context, token, next) {
                if (!notebookUri) {
                    // Console LSP: skip vdoc files (notebook LSP handles them)
                    if (document.uri.scheme === 'file') {
                        const baseName = path.basename(document.uri.fsPath);
                        if (VDOC_PATTERN.test(baseName)) {
                            return undefined;
                        }
                    }
                    // Console LSP: skip notebook console inputs
                    if (document.uri.scheme === 'inmemory' &&
                        NOTEBOOK_REPL_PATTERN.test(document.uri.path)) {
                        return undefined;
                    }
                } else {
                    // Notebook LSP: skip regular (non-notebook) console inputs
                    if (document.uri.scheme === 'inmemory' &&
                        !NOTEBOOK_REPL_PATTERN.test(document.uri.path)) {
                        return undefined;
                    }
                }
                return Promise.resolve(next(document, position, context, token)).then((res) => {
                    if (res) {
                        const items = Array.isArray(res) ? res : (res as vscode.CompletionList).items;
                        for (const item of items) {
                            const priority = (item as any).data?.priority;
                            if (typeof priority === 'number') {
                                (item as any).priority = priority;
                            }
                        }
                    }
                    return res;
                });
            },
            // Apply hover priority set by the Positron LSP server.
            // Same session filtering as for completions above.
            provideHover(document, position, token, next) {
                if (!notebookUri) {
                    if (document.uri.scheme === 'file') {
                        const baseName = path.basename(document.uri.fsPath);
                        if (VDOC_PATTERN.test(baseName)) {
                            return undefined;
                        }
                    }
                    if (document.uri.scheme === 'inmemory' &&
                        NOTEBOOK_REPL_PATTERN.test(document.uri.path)) {
                        return undefined;
                    }
                } else {
                    if (document.uri.scheme === 'inmemory' &&
                        !NOTEBOOK_REPL_PATTERN.test(document.uri.path)) {
                        return undefined;
                    }
                }
                return Promise.resolve(next(document, position, token)).then((result) => {
                    if (result) {
                        const data = (result as any).data;
                        if (data && typeof data.priority === 'number') {
                            (result as any).priority = data.priority;
                        }
                    }
                    return result;
                });
            },
        };

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

        // Patch protocol converter to preserve `data` on Hover responses.
        // The Positron LSP server uses data.priority for cross-provider
        // hover deduplication. vscode-languageclient's default asHover
        // discards all fields except contents and range.
        const p2c = this._client.protocol2CodeConverter as any;
        const originalAsHover = p2c.asHover.bind(p2c);
        p2c.asHover = (hover: any) => {
            const result = originalAsHover(hover);
            if (hover?.data !== undefined && result) {
                (result as any).data = hover.data;
            }
            return result;
        };

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
        // Only register the statement range and help topic providers for
        // console (non-notebook) sessions. These providers are registered
        // globally for the language, so a notebook session's provider
        // would compete with the console session's and fail for script
        // files that aren't synced to the notebook LSP.
        const { notebookUri } = this._metadata;
        if (!notebookUri) {
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
