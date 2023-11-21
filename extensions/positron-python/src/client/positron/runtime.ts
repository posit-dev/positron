/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable no-else-return */
/* eslint-disable class-methods-use-this */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { cloneDeep } from 'lodash';
import PQueue from 'p-queue';
import { LanguageClientOptions } from 'vscode-languageclient/node';
import { InstallOptions } from '../common/installer/types';
import { IInstaller, InstallerResponse, Product } from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntime, JupyterKernelExtra } from '../jupyter-adapter.d';
import { traceInfo } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonLsp, LspState } from './lsp';

/**
 * A Positron language runtime that wraps a Jupyter kernel and a Language Server
 * Protocol client.
 */
export class PythonRuntime implements positron.LanguageRuntime, vscode.Disposable {
    /** The Language Server Protocol client wrapper */
    private _lsp: PythonLsp;

    /** Queue for message handlers */
    private _queue: PQueue;

    /** The Jupyter kernel-based implementation of the Language Runtime API */
    private _kernel?: JupyterLanguageRuntime;

    /** The emitter for language runtime messages */
    private _messageEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

    /** The emitter for language runtime state changes */
    private _stateEmitter = new vscode.EventEmitter<positron.RuntimeState>();

    /** The emitter for language runtime exits */
    private _exitEmitter = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

    /** The Jupyter Adapter extension API */
    private adapterApi?: JupyterAdapterApi;

    constructor(
        private readonly serviceContainer: IServiceContainer,
        readonly kernelSpec: JupyterKernelSpec,
        readonly metadata: positron.LanguageRuntimeMetadata,
        readonly dynState: positron.LanguageRuntimeDynState,
        readonly languageClientOptions: LanguageClientOptions,
        private readonly interpreter: PythonEnvironment,
        private readonly installer: IInstaller,
        readonly extra?: JupyterKernelExtra,
        readonly notebook?: vscode.NotebookDocument,
    ) {
        this._lsp = new PythonLsp(serviceContainer, metadata.languageVersion, languageClientOptions, notebook);
        this._queue = new PQueue({ concurrency: 1 });
        this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
        this.onDidChangeRuntimeState = this._stateEmitter.event;
        this.onDidEndSession = this._exitEmitter.event;

        this.onDidChangeRuntimeState((state) => {
            this.onStateChange(state);
        });
    }

    onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

    onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

    onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;

    execute(
        code: string,
        id: string,
        mode: positron.RuntimeCodeExecutionMode,
        errorBehavior: positron.RuntimeErrorBehavior,
    ): void {
        if (this._kernel) {
            this._kernel.execute(code, id, mode, errorBehavior);
        } else {
            throw new Error(`Cannot execute '${code}'; kernel not started`);
        }
    }

    isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
        if (this._kernel) {
            return this._kernel.isCodeFragmentComplete(code);
        } else {
            throw new Error(`Cannot check code fragment '${code}'; kernel not started`);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createClient(id: string, type: positron.RuntimeClientType, params: any): Thenable<void> {
        if (this._kernel) {
            return this._kernel.createClient(id, type, params);
        } else {
            throw new Error(`Cannot create client of type '${type}'; kernel not started`);
        }
    }

    listClients(type?: positron.RuntimeClientType | undefined): Thenable<Record<string, string>> {
        if (this._kernel) {
            return this._kernel.listClients(type);
        } else {
            throw new Error(`Cannot list clients; kernel not started`);
        }
    }

    removeClient(id: string): void {
        if (this._kernel) {
            this._kernel.removeClient(id);
        } else {
            throw new Error(`Cannot remove client ${id}; kernel not started`);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendClientMessage(clientId: string, messageId: string, message: any): void {
        if (this._kernel) {
            this._kernel.sendClientMessage(clientId, messageId, message);
        } else {
            throw new Error(`Cannot send message to client ${clientId}; kernel not started`);
        }
    }

    replyToPrompt(id: string, reply: string): void {
        if (this._kernel) {
            this._kernel.replyToPrompt(id, reply);
        } else {
            throw new Error(`Cannot reply to prompt ${id}; kernel not started`);
        }
    }

    private async _installIpykernel(): Promise<void> {
        // Offer to install the ipykernel module for the preferred interpreter, if it is missing.
        // Thow an error if it could not be installed.
        const hasKernel = await this.installer.isInstalled(Product.ipykernel, this.interpreter);
        if (!hasKernel) {
            // Pass a cancellation token to enable VSCode's progress indicator and let the user
            // cancel the install.
            const tokenSource = new vscode.CancellationTokenSource();
            const installerToken = tokenSource.token;

            // Using a process to install modules avoids using the terminal service,
            // which has issues waiting for the outcome of the install.
            const installOptions: InstallOptions = { installAsProcess: true };
            const messageOptions: vscode.MessageOptions = { modal: true };

            const response = await this.installer.promptToInstall(
                Product.ipykernel,
                this.interpreter,
                installerToken,
                undefined,
                installOptions,
                messageOptions,
            );

            switch (response) {
                case InstallerResponse.Installed:
                    traceInfo(`Successfully installed ipykernel for ${this.interpreter?.displayName}`);
                    break;
                case InstallerResponse.Ignore:
                case InstallerResponse.Disabled:
                    throw new Error(
                        `Could not start runtime: failed to install ipykernel for ${this.interpreter?.displayName}.`,
                    );
                default:
                    throw new Error(`Unknown installer response type: ${response}`);
            }
        }
    }

    async start(): Promise<positron.LanguageRuntimeInfo> {
        if (!this._kernel) {
            this._kernel = await this.createKernel();
        }
        await this._installIpykernel();
        return this._kernel.start();
    }

    async interrupt(): Promise<void> {
        if (this._kernel) {
            return this._kernel.interrupt();
        } else {
            throw new Error('Cannot interrupt; kernel not started');
        }
    }

    async restart(): Promise<void> {
        if (this._kernel) {
            // Stop the LSP client before restarting the kernel
            await this._lsp.deactivate(true);
            return this._kernel.restart();
        } else {
            throw new Error('Cannot restart; kernel not started');
        }
    }

    async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
        if (this._kernel) {
            // Stop the LSP client before shutting down the kernel
            await this._lsp.deactivate(true);
            return this._kernel.shutdown(exitReason);
        } else {
            throw new Error('Cannot shutdown; kernel not started');
        }
    }

    showOutput(): void {
        this._kernel?.showOutput();
    }

    async forceQuit(): Promise<void> {
        if (this._kernel) {
            // Stop the LSP client before shutting down the kernel. We only give
            // the LSP a quarter of a second to shut down before we force the
            // kernel to quit; we need to balance the need to respond to the
            // force-quit quickly with the fact that the LSP will show error
            // messages if we yank the kernel out from beneath it without
            // warning.
            await Promise.race([this._lsp.deactivate(true), new Promise((resolve) => setTimeout(resolve, 250))]);
            return this._kernel.forceQuit();
        } else {
            throw new Error('Cannot force quit; kernel not started');
        }
    }

    async dispose() {
        await this._lsp.dispose();
        if (this._kernel) {
            await this._kernel.dispose();
        }
    }

    private async createKernel(): Promise<JupyterLanguageRuntime> {
        const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
        if (!ext) {
            throw new Error('Jupyter Adapter extension not found');
        }
        if (!ext.isActive) {
            await ext.activate();
        }
        this.adapterApi = ext?.exports as JupyterAdapterApi;
        const kernel = this.adapterApi.adaptKernel(this.kernelSpec, this.metadata, this.dynState, this.extra);

        kernel.onDidChangeRuntimeState((state) => {
            this._stateEmitter.fire(state);
        });
        kernel.onDidReceiveRuntimeMessage((message) => {
            this._messageEmitter.fire(message);
        });
        kernel.onDidEndSession((exit) => {
            this._exitEmitter.fire(exit);
        });
        return kernel;
    }

    private onStateChange(state: positron.RuntimeState): void {
        if (state === positron.RuntimeState.Ready) {
            this._queue.add(async () => {
                // The adapter API is guranteed to exist at this point since the
                // runtime cannot become Ready without it
                const port = await this.adapterApi!.findAvailablePort([], 25);
                if (this._kernel) {
                    this._kernel.emitJupyterLog(`Starting Positron LSP server on port ${port}`);
                    await this._kernel.startPositronLsp(`127.0.0.1:${port}`);
                }
                await this._lsp.activate(port);
            });
        } else if (state === positron.RuntimeState.Exited) {
            if (this._lsp.state === LspState.running) {
                this._queue.add(async () => {
                    if (this._kernel) {
                        this._kernel.emitJupyterLog(`Stopping Positron LSP server`);
                    }
                    await this._lsp.deactivate(false);
                });
            }
        }
    }

    clone(metadata: positron.LanguageRuntimeMetadata, notebook: vscode.NotebookDocument): positron.LanguageRuntime {
        const kernelSpec: JupyterKernelSpec = { ...this.kernelSpec, display_name: metadata.runtimeName };
        return new PythonRuntime(
            this.serviceContainer,
            kernelSpec,
            metadata,
            { ...this.dynState },
            cloneDeep(this.languageClientOptions),
            cloneDeep(this.interpreter),
            this.installer,
            createJupyterKernelExtra(),
            notebook,
        );
    }
}

export function createJupyterKernelExtra(): undefined {
    // TODO: Implement and include startup hooks for the Python runtime.
    // return {
    //     attachOnStartup: new ArkAttachOnStartup(),
    //     sleepOnStartup: new ArkDelayStartup(),
    // };
    return undefined;
}
