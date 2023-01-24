// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
// --- Start Positron ---
import { Socket } from 'net';
import { LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo } from 'vscode-languageclient/node';
import { EXTENSION_ROOT_DIR, PYTHON_LANGUAGE } from '../../common/constants';
// --- End Positron ---
import { Resource } from '../../common/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { ILanguageClientFactory } from '../types';
// --- Start Positron ---
import { traceVerbose } from '../../logging';

const languageClientName = 'Positron Python Jedi';
// --- End Positron ---

export class JediLanguageClientFactory implements ILanguageClientFactory {
    constructor(private interpreterService: IInterpreterService) { }

    public async createLanguageClient(
        resource: Resource,
        _interpreter: PythonEnvironment | undefined,
        clientOptions: LanguageClientOptions,
    ): Promise<LanguageClient> {
        // Just run the language server using a module
        const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'run-jedi-language-server.py');
        const interpreter = await this.interpreterService.getActiveInterpreter(resource);
        const serverOptions: ServerOptions = {
            command: interpreter ? interpreter.path : 'python',
            args: [lsScriptPath],
        };

        return new LanguageClient(PYTHON_LANGUAGE, languageClientName, serverOptions, clientOptions);
    }

    // --- Start Positron ---
    /**
     * Finds an available port to spawn a new Jedi LSP in TCP mode and returns a LanguageClient
     * configured to connect to this server.
     */
    public async createLanguageClientTCP(
        port: number,
        clientOptions: LanguageClientOptions,
    ): Promise<LanguageClient> {

        // Configure language client to connect to LSP via TCP on start
        const serverOptions = async () => { return this.getServerOptions(port); };
        return new LanguageClient(PYTHON_LANGUAGE, 'Positron Python Jedi', serverOptions, clientOptions);
    }

    /**
     * An async function used by the LanguageClient to establish a connection to the LSP on start.
     * Several attempts to connect are made given recently spawned servers may not be ready immediately
     * for client connections.
     * @param port the LSP port
     */
    private async getServerOptions(port: number): Promise<StreamInfo> {

        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const max_attempts = 20;
        const base_delay = 50;
        const multiplier = 1.5;

        for (let attempt = 0; attempt < max_attempts; attempt++) {
            // Retry up to five times then start to back-off
            const interval = attempt < 6 ? base_delay : base_delay * multiplier * attempt;
            if (attempt > 0) {
                await delay(interval);
            }

            try {
                // Try to connect to LSP port
                const socket: Socket = await this.tryToConnect(port);
                return { reader: socket, writer: socket };
            } catch (error) {
                if (error?.code == 'ECONNREFUSED') {
                    traceVerbose(`Error '${error.message}' on connection attempt '${attempt}' to Jedi LSP on port '${port}', will retry`);
                } else {
                    throw error;
                }
            }
        }

        throw new Error(`Failed to create TCP connection to Jedi LSP on port ${port} after multiple attempts`);
    }

    /**
     * Attempts to establish a TCP socket connection to the given port
     * @param port the server port to connect to
     */
    private async tryToConnect(port: number): Promise<Socket> {
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
    }

    // --- End Positron ---
}
