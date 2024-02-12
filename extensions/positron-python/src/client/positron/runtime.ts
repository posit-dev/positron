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
import { PythonExtension } from '../api/types';
import { ProductNames } from '../common/installer/productNames';
import { InstallOptions } from '../common/installer/types';
import { IInstaller, IInterpreterPathService, InstallerResponse, Product, ProductInstallStatus } from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntime, JupyterKernelExtra } from '../jupyter-adapter.d';
import { traceInfo } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonLsp, LspState } from './lsp';
import { whenTimeout } from './util';

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

    /** The registration for console width changes */
    private _consoleWidthDisposable?: vscode.Disposable;

    /** The current state of the runtime */
    private _state: positron.RuntimeState = positron.RuntimeState.Uninitialized;

    /** The service for getting the Python extension interpreter path */
    private _interpreterPathService: IInterpreterPathService

    constructor(
        private readonly serviceContainer: IServiceContainer,
        readonly kernelSpec: JupyterKernelSpec,
        readonly metadata: positron.LanguageRuntimeMetadata,
        readonly dynState: positron.LanguageRuntimeDynState,
        readonly languageClientOptions: LanguageClientOptions,
        private readonly interpreter: PythonEnvironment,
        private readonly installer: IInstaller,
        private readonly pythonApi: PythonExtension,
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

        this._interpreterPathService = serviceContainer.get<IInterpreterPathService>(IInterpreterPathService);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callMethod(method: string, ...args: any[]): Thenable<any> {
        if (this._kernel) {
            return this._kernel.callMethod(method, ...args);
        } else {
            throw new Error(`Cannot call method '${method}'; kernel not started`);
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

        // We require ipykernel >= 6.19.1 for the Python runtime in order to ensure the comm package
        // can be imported on its own (https://github.com/ipython/ipykernel/releases/tag/v6.18.0)
        const hasCompatibleKernel = await this.installer.isProductVersionCompatible(Product.ipykernel, '>=6.19.1', this.interpreter);


        if (hasCompatibleKernel !== ProductInstallStatus.Installed) {
            // Pass a cancellation token to enable VSCode's progress indicator and let the user
            // cancel the install.
            const tokenSource = new vscode.CancellationTokenSource();
            const installerToken = tokenSource.token;

            // Using a process to install modules avoids using the terminal service,
            // which has issues waiting for the outcome of the install.
            const installOptions: InstallOptions = { installAsProcess: true };
            const installOrUpgrade = hasCompatibleKernel === ProductInstallStatus.NeedsUpgrade ? 'upgrade' : 'install';

            const product = Product.ipykernel;
            const message = vscode.l10n.t(
                'To enable Python support, Positron needs to {0} the package "{1}" for the active interpreter {2} at: {3}.',
                installOrUpgrade,
                ProductNames.get(product)!,
                `Python ${this.metadata.languageVersion}`,
                this.metadata.runtimePath,
            );

            const response = await this.installer.promptToInstall(
                product,
                this.interpreter,
                installerToken,
                undefined,
                installOptions,
                message,
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

        // Ensure that the ipykernel module is installed for the interpreter.
        await this._installIpykernel();

        // Update the active environment in the Python extension.
        this._interpreterPathService.update(undefined, vscode.ConfigurationTarget.Global, this.interpreter.path)

        this.pythonApi.environments.updateActiveEnvironmentPath(this.interpreter.path);

        // Register for console width changes, if we haven't already
        if (!this._consoleWidthDisposable) {
            this._consoleWidthDisposable = positron.window.onDidChangeConsoleWidth((newWidth) => {
                this.onConsoleWidthChange(newWidth);
            });
        }

        return this._kernel.start();
    }

    private async onConsoleWidthChange(newWidth: number): Promise<void> {
        // Ignore if no kernel
        if (!this._kernel) {
            return;
        }

        // Ignore if kernel exited
        if (this._state === positron.RuntimeState.Exited) {
            return;
        }

        try {
            // Send the new width to Python
            await this.callMethod('setConsoleWidth', newWidth);
        } catch (err) {
            // Log the error if we can't set the console width; this is not
            // fatal, so we don't rethrow the error
            const runtimeError = err as positron.RuntimeMethodError;
            this._kernel.emitJupyterLog(`Error setting console width: ${runtimeError.message} (${runtimeError.code})`);
        }
    }

    async interrupt(): Promise<void> {
        if (this._kernel) {
            return this._kernel.interrupt();
        } else {
            throw new Error('Cannot interrupt; kernel not started');
        }
    }

	// Keep track of LSP init to avoid stopping in the middle of startup
	private _lspStarting: Thenable<void> = Promise.resolve();

    async restart(): Promise<void> {
        if (this._kernel) {
			// Stop the LSP client before restarting the kernel. Don't stop it
			// until fully started to avoid an inconsistent state where the
			// deactivation request comes in between the creation of the LSP
			// comm and the LSP client.
			//
			// A cleaner way to set this up might be to put `this._lsp` in
			// charge of creating the LSP comm, then `deactivate()` could
			// keep track of this state itself.
			await Promise.race([
				this._lspStarting,
				whenTimeout(400, () => {
					this._kernel!.emitJupyterLog('LSP startup timed out during interpreter restart');
				})
			]);
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
        // Clean up the console width listener
        this._consoleWidthDisposable?.dispose();
        this._consoleWidthDisposable = undefined;

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
        this._state = state;
        if (state === positron.RuntimeState.Ready) {
            this._queue.add(async () => {
                // The adapter API is guranteed to exist at this point since the
                // runtime cannot become Ready without it
                const port = await this.adapterApi!.findAvailablePort([], 25);
                if (this._kernel) {
                    this._kernel.emitJupyterLog(`Starting Positron LSP server on port ${port}`);

                    // Create the LSP comm before creating the LSP
                    // client. We keep track of this initialisation in
                    // case we need to restart, to avoid restarting in
                    // the middle of init.
                    this._lspStarting = this._kernel.startPositronLsp(`127.0.0.1:${port}`);

                    await this._lspStarting;
                    await this._lsp.activate(port);
                }
            });

            this._queue.add(async () => {
                try {
                    // Set the initial console width
                    const width = await positron.window.getConsoleWidth();
                    this.callMethod('setConsoleWidth', width);
                    this._kernel!.emitJupyterLog(`Set initial console width to ${width}`);
                } catch (err) {
                    // Recoverable (we'll just use the default width); but log
                    // the error.
                    if (this._kernel) {
                        const runtimeError = err as positron.RuntimeMethodError;
                        this._kernel.emitJupyterLog(
                            `Error setting initial console width: ${runtimeError.message} ` +
                            `(${runtimeError.code})`);
                    }
                }
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
            this.pythonApi,
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
