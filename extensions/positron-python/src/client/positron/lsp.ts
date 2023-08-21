/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    State,
    StreamInfo,
} from 'vscode-languageclient/node';
import { Socket } from 'net';

import { PYTHON_LANGUAGE } from '../common/constants';
import { traceError, traceInfo } from '../logging';
import { ProgressReporting } from '../activation/progress';
import { delay, PromiseHandles } from './util';

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
        private readonly _clientOptions: LanguageClientOptions) {
    }

    /**
     * Activate the language server; returns a promise that resolves when the LSP is
     * activated.
     *
     * @param port The port on which the language server is listening.
     */
    public async activate(port: number): Promise<void> {

        // Clean up disposables from any previous activation
        this.activationDisposables.forEach(d => d.dispose());
        this.activationDisposables = [];

        // Define server options for the language server; this is a callback
        // that creates and returns the reader/writer stream for TCP
        // communication. It will retry up to 20 times, with a back-off
        // interval. We do this because the language server may not be
        // ready to accept connections when we first try to connect.
        const serverOptions = async (): Promise<StreamInfo> => {

            const maxAttempts = 20;
            const baseDelay = 50;
            const multiplier = 1.5;

            const tryToConnect = async (_port: number): Promise<Socket> => new Promise((resolve, reject) => {
                const socket = new Socket();
                socket.on('ready', () => {
                    resolve(socket);
                });
                socket.on('error', (error) => {
                    reject(error);
                });
                socket.connect(_port);
            });

            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } catch (error: any) {
                    if (error?.code === 'ECONNREFUSED') {
                        traceInfo(`Error '${error.message}' on connection attempt '${attempt}' to Python LSP (${this._version}) on port '${port}', will retry`);
                    } else {
                        throw error;
                    }
                }
            }
            throw new Error(`Failed to create TCP connection to Python LSP (${this._version}) on port ${port} after ${maxAttempts} attempts`);
        };

        traceInfo(`Creating Positron Python ${this._version} language client...`);
        this._client = new LanguageClient(PYTHON_LANGUAGE, `Positron Python Language Server (${this._version})`, serverOptions, this._clientOptions);

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
                        traceInfo(`Python (${this._version}) language client init successful`);
                        this._initializing = undefined;
                        out.resolve();
                    }
                    this._state = LspState.running;
                    break;
                case State.Stopped:
                    if (this._initializing) {
                        traceInfo(`Python (${this._version}) language client init failed`);
                        out.reject("Python LSP client stopped before initialization");
                    }
                    this._state = LspState.stopped;
                    break;
                default:
                    traceError(`Unexpected language client state: ${event.newState}`);
                    out.reject('Unexpected language client state');
            }
            traceInfo(`Python (${this._version}) language client state changed ${oldState} => ${this._state}`);
        }));

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
     * Dispose of the client instance.
     */
    async dispose(): Promise<void> {
        this.activationDisposables.forEach(d => d.dispose());
        await this.deactivate();
    }
}
