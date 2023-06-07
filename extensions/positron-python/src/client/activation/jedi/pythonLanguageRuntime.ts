/* eslint-disable class-methods-use-this */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Socket } from 'net';

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Disposable, LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo } from 'vscode-languageclient/node';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { InstallOptions } from '../../common/installer/types';
import { IInstaller, Product, InstallerResponse } from '../../common/types';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntime } from '../../jupyter-adapter.d';
import { traceVerbose } from '../../logging';
import { ProgressReporting } from '../progress';
import { PythonEnvironment } from '../../pythonEnvironments/info';

/**
 * A Positron Python language runtime that wraps a Jupyter kernel runtime.
 * Fulfills most Language Runtime API calls by delegating to the wrapped kernel.
 */
export class PythonLanguageRuntime implements JupyterLanguageRuntime, Disposable {

    /** The Jupyter kernel-based implementation of the Language Runtime API */
    private _kernel: JupyterLanguageRuntime;

    private _lsp: LanguageClient | undefined;

    private readonly disposables: Disposable[] = [];

    // Using a process to install modules avoids using the terminal service,
    // which has issues waiting for the outcome of the install.
    private readonly installOptions: InstallOptions = { installAsProcess: true };

    /**
     * Create a new PythonLanguageRuntime object to wrap a Jupyter kernel.
     *
     * @param kernelSpec The specification of the Jupyter kernel to wrap.
     * @param metadata The metadata of the language runtime to create.
     * @param adapterApi The API of the Jupyter Adapter extension.
     */
    constructor(
        readonly kernelSpec: JupyterKernelSpec,
        readonly metadata: positron.LanguageRuntimeMetadata,
        readonly adapterApi: JupyterAdapterApi,
        readonly languageClientOptions: LanguageClientOptions,
        private readonly interpreter: PythonEnvironment | undefined,
        private readonly installer: IInstaller,
    ) {

        this._kernel = adapterApi.adaptKernel(kernelSpec, metadata);

        this.onDidChangeRuntimeState = this._kernel.onDidChangeRuntimeState;
        this.onDidReceiveRuntimeMessage = this._kernel.onDidReceiveRuntimeMessage;

        this.onDidChangeRuntimeState((state) => {
            this.onStateChange(state);
        });
    }

    startPositronLsp(clientAddress: string): void {
        this._kernel.startPositronLsp(clientAddress);
    }

    emitJupyterLog(message: string): void {
        this._kernel.emitJupyterLog(message);
    }

    onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

    onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

    execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
        this._kernel.execute(code, id, mode, errorBehavior);
    }

    isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
        return this._kernel.isCodeFragmentComplete(code);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
    createClient(id: string, type: positron.RuntimeClientType, params: any): Thenable<void> {
        return this._kernel.createClient(id, type, params);
    }

    listClients(type?: positron.RuntimeClientType | undefined): Thenable<Record<string, string>> {
        return this._kernel.listClients(type);
    }

    removeClient(id: string): void {
        this._kernel.removeClient(id);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
    sendClientMessage(clientId: string, messageId: string, message: any): void {
        this._kernel.sendClientMessage(clientId, messageId, message);
    }

    replyToPrompt(id: string, reply: string): void {
        this._kernel.replyToPrompt(id, reply);
    }

    async start(): Promise<positron.LanguageRuntimeInfo> {
        await this._installIpykernel();
        return this._kernel.start();
    }

    private async _installIpykernel(): Promise<void> {
        // Offer to install the ipykernel module for the preferred interpreter, if it is missing.
        // Thow an error if it could not be installed.
        const hasKernel = await this.installer.isInstalled(Product.ipykernel, this.interpreter);
        if (!hasKernel) {
            const response = await this.installer.promptToInstall(Product.ipykernel,
                this.interpreter, undefined, undefined, this.installOptions);
            switch (response) {
                case InstallerResponse.Installed:
                    traceVerbose(`Successfully installed ipykernel for ${this.interpreter?.displayName}`);
                    break;
                case InstallerResponse.Ignore:
                case InstallerResponse.Disabled:
                    throw new Error(`Could not start runtime: failed to install ipykernel for ${this.interpreter?.displayName}.`);
                default:
                    throw new Error(`Unknown installer response type: ${response}`);
            }
        }
    }

    async interrupt(): Promise<void> {
        return this._kernel.interrupt();
    }

    async restart(): Promise<void> {

        // Stop the LSP (it will restart after the kernel restarts)
        if (this._lsp) {
            await this._lsp.stop();
        }

        // Restart the kernel
        return this._kernel.restart();
    }

    async shutdown(): Promise<void> {

        // Stop the LSP
        if (this._lsp) {
            await this._lsp.stop();
        }

        // Shutdown the kernel
        return this._kernel.shutdown();
    }

    dispose(): void {
        while (this.disposables.length > 0) {
            const d = this.disposables.shift()!;
            d.dispose();
        }
    }

    private onStateChange(state: positron.RuntimeState): void {
        if (state === positron.RuntimeState.Ready) {
            this.adapterApi.findAvailablePort([], 25).then((port: number) => {
                this.emitJupyterLog(`Starting Positron LSP server on port ${port}`);
                this.startPositronLsp(`127.0.0.1:${port}`);
                this.startLSPClient(port).ignoreErrors();
            });
        } else if (state === positron.RuntimeState.Exiting ||
            state === positron.RuntimeState.Exited) {
            if (this._lsp) {
                this._lsp.stop().ignoreErrors();
            }
        }
    }

    // LSP Client Helpers

    private async startLSPClient(port: number): Promise<void> {

        const serverOptions: ServerOptions = async () => this.getLSPServerOptions(port);
        const client = new LanguageClient(PYTHON_LANGUAGE, 'Positron Python Jedi', serverOptions, this.languageClientOptions);
        this.disposables.push(client);

        const progressReporting = new ProgressReporting(client);
        this.disposables.push(progressReporting);

        await client.start();
        this._lsp = client;
    }

    /**
     * An async function used by the LanguageClient to establish a connection to the LSP on start.
     * Several attempts to connect are made given recently spawned servers may not be ready immediately
     * for client connections.
     * @param port the LSP port
     */
    private async getLSPServerOptions(port: number): Promise<StreamInfo> {

        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const maxAttempts = 20;
        const baseDelay = 50;
        const multiplier = 1.5;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            // Retry up to five times then start to back-off
            const interval = attempt < 6 ? baseDelay : baseDelay * multiplier * attempt;
            if (attempt > 0) {
                await delay(interval);
            }

            try {
                // Try to connect to LSP port
                const socket: Socket = await this.tryToConnect(port);
                return { reader: socket, writer: socket };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (error: any) {
                if (error?.code === 'ECONNREFUSED') {
                    this.emitJupyterLog(`Error '${error.message}' on connection attempt '${attempt}' to Jedi LSP on port '${port}', will retry`);
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
}
