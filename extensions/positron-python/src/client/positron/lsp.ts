/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { LanguageClient, LanguageClientOptions, State, StreamInfo } from 'vscode-languageclient/node';
import { Socket } from 'net';

import { PYTHON_LANGUAGE } from '../common/constants';
import { traceError, traceInfo } from '../logging';
import { ProgressReporting } from '../activation/progress';
import { PromiseHandles } from './util';
import { PythonHelpTopicProvider } from './help';
import { PythonStatementRangeProvider } from './statementRange';

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

    /** Disposable for per-activation items */
    private activationDisposables: vscode.Disposable[] = [];

    public constructor(
        private readonly _version: string,
        private readonly _clientOptions: LanguageClientOptions,
        private readonly _notebook: vscode.NotebookDocument | undefined,
    ) { }

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

        // If this client belongs to a notebook, set the document selector to only include that notebook.
        // Otherwise, this is the main client for this language, so set the document selector to include
        // untitled Python files, in-memory Python files (e.g. the console), and Python files on disk.
        this._clientOptions.documentSelector = this._notebook
            ? [{ language: 'python', pattern: this._notebook.uri.path }]
            : [
                { language: 'python', scheme: 'untitled' },
                { language: 'python', scheme: 'inmemory' }, // Console
                { language: 'python', pattern: '**/*.py' },
            ];

        traceInfo(`Creating Positron Python ${this._version} language client (port ${port})...`);
        this._client = new LanguageClient(
            PYTHON_LANGUAGE,
            `Positron Python Language Server (${this._version})`,
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
     * @param awaitStop If true, waits for the client to stop before returning.
     *   This should be set to `true` if the server process is still running, and
     *   `false` if the server process has already exited.
     * @returns A promise that resolves when the client has been stopped.
     */
    public async deactivate(awaitStop: boolean): Promise<void> {
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

        const promise = awaitStop
            ? // If the kernel hasn't exited, we can just await the promise directly
            this._client!.stop()
            : // The promise returned by `stop()` never resolves if the server
            // side is disconnected, so rather than awaiting it when the runtime
            // has exited, we wait for the client to change state to `stopped`,
            // which does happen reliably.
            new Promise<void>((resolve) => {
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
                reject(Error(`Timed out after 2 seconds waiting for client to stop.`));
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
     * Registers additional Positron-specific LSP methods. These programmatic
     * language features are not part of the LSP specification, and are
     * consequently not covered by vscode-languageserver, but are used by
     * Positron to provide additional functionality.
     *
     * @param client The language client instance
     */
    private registerPositronLspExtensions(client: LanguageClient) {
        // Register a statement range provider to detect Python statements
        const rangeDisposable = positron.languages.registerStatementRangeProvider('python',
            new PythonStatementRangeProvider());
        this.activationDisposables.push(rangeDisposable);

        // Register a help topic provider to provide help topics for Python
        const helpDisposable = positron.languages.registerHelpTopicProvider('python',
            new PythonHelpTopicProvider(client));
        this.activationDisposables.push(helpDisposable);
    }


    /**
     * Dispose of the client instance.
     */
    async dispose(): Promise<void> {
        this.activationDisposables.forEach((d) => d.dispose());
        await this.deactivate(false);
    }
}
