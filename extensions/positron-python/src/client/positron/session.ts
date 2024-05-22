/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable no-else-return */
/* eslint-disable class-methods-use-this */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import PQueue from 'p-queue';
import { ProductNames } from '../common/installer/productNames';
import { InstallOptions } from '../common/installer/types';
import {
    IConfigurationService,
    IInstaller,
    IInterpreterPathService,
    InstallerResponse,
    Product,
    ProductInstallStatus,
} from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntimeSession } from '../jupyter-adapter.d';
import { traceInfo } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonLsp, LspState } from './lsp';
import { whenTimeout } from './util';
import { IPYKERNEL_VERSION } from '../common/constants';
import { IEnvironmentVariablesProvider } from '../common/variables/types';
import { PythonRuntimeExtraData } from './runtime';
import { JediLanguageServerAnalysisOptions } from '../activation/jedi/analysisOptions';
import { ILanguageServerOutputChannel } from '../activation/types';
import { IWorkspaceService } from '../common/application/types';
import { IInterpreterService } from '../interpreter/contracts';

/**
 * A Positron language runtime that wraps a Jupyter kernel and a Language Server
 * Protocol client.
 */
export class PythonRuntimeSession implements positron.LanguageRuntimeSession, vscode.Disposable {
    /** The Language Server Protocol client wrapper, if created */
    private _lsp: PythonLsp | undefined;

    /** Queue for message handlers */
    private _queue: PQueue;

    /** The Jupyter kernel-based implementation of the Language Runtime API */
    private _kernel?: JupyterLanguageRuntimeSession;

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
    private _interpreterPathService: IInterpreterPathService;

    dynState: positron.LanguageRuntimeDynState;

    private readonly interpreter: PythonEnvironment;

    constructor(
        readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
        readonly metadata: positron.RuntimeSessionMetadata,
        readonly serviceContainer: IServiceContainer,
        readonly kernelSpec?: JupyterKernelSpec | undefined,
    ) {
        const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);

        this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
        this.onDidChangeRuntimeState = this._stateEmitter.event;
        this.onDidEndSession = this._exitEmitter.event;

        // Extract the extra data from the runtime metadata; it contains the
        // environment ID that was saved when the metadata was created.
        const extraData: PythonRuntimeExtraData = runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData;
        if (!extraData || !extraData.pythonEnvironmentId) {
            throw new Error(`Runtime metadata missing Python environment ID: ${JSON.stringify(runtimeMetadata)}`);
        }

        const interpreter = interpreterService.getInterpreters().find((i) => i.id === extraData.pythonEnvironmentId);
        if (!interpreter) {
            throw new Error(`Interpreter not found: ${extraData.pythonEnvironmentId}`);
        }
        this.interpreter = interpreter;

        this._queue = new PQueue({ concurrency: 1 });

        this.dynState = {
            inputPrompt: '>>>',
            continuationPrompt: '...',
        };

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
        // Get the installer service
        const installer = this.serviceContainer.get<IInstaller>(IInstaller);

        // Offer to install the ipykernel module for the preferred interpreter, if it is missing.
        // Thow an error if it could not be installed.

        // We require ipykernel >= 6.19.1 for the Python runtime in order to ensure the comm package
        // can be imported on its own (https://github.com/ipython/ipykernel/releases/tag/v6.18.0)
        const hasCompatibleKernel = await installer.isProductVersionCompatible(
            Product.ipykernel,
            IPYKERNEL_VERSION,
            this.interpreter,
        );

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
                'To enable Python support, Positron needs to {0} the package "{1}" for the active interpreter {2} at: <code>{3}</code>.',
                installOrUpgrade,
                ProductNames.get(product)!,
                `Python ${this.runtimeMetadata.languageVersion}`,
                this.runtimeMetadata.runtimePath,
            );

            const response = await installer.promptToInstall(
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
        // Ensure the LSP client instance is created
        if (!this._lsp) {
            await this.createLsp();
        }

        // Ensure the Jupyter kernel instance is created
        if (!this._kernel) {
            this._kernel = await this.createKernel();
        }

        // Ensure that the ipykernel module is installed for the interpreter.
        await this._installIpykernel();

        // Update the active environment in the Python extension.
        this._interpreterPathService.update(undefined, vscode.ConfigurationTarget.Global, this.interpreter.path);

        // Register for console width changes, if we haven't already
        if (!this._consoleWidthDisposable) {
            this._consoleWidthDisposable = positron.window.onDidChangeConsoleWidth((newWidth) => {
                this.onConsoleWidthChange(newWidth);
            });
        }

        return this._kernel!.start();
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

    private async createLsp() {
        traceInfo(`createPythonSession: resolving LSP services`);
        const environmentService = this.serviceContainer.get<IEnvironmentVariablesProvider>(
            IEnvironmentVariablesProvider,
        );
        const outputChannel = this.serviceContainer.get<ILanguageServerOutputChannel>(ILanguageServerOutputChannel);
        const configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);

        traceInfo(`createPythonSession: creating LSP`);
        const analysisOptions = new JediLanguageServerAnalysisOptions(
            environmentService,
            outputChannel,
            configService,
            workspaceService,
        );

        const resource = workspaceService.workspaceFolders?.[0].uri;
        await analysisOptions.initialize(resource, this.interpreter);
        const languageClientOptions = await analysisOptions.getAnalysisOptions();

        this._lsp = new PythonLsp(
            this.serviceContainer,
            this.runtimeMetadata.languageVersion,
            languageClientOptions,
            this.metadata,
        );
    }

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
                }),
            ]);
            await this._lsp?.deactivate(true);

            return this._kernel.restart();
        } else {
            throw new Error('Cannot restart; kernel not started');
        }
    }

    async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
        if (this._kernel) {
            // Stop the LSP client before shutting down the kernel
            await this._lsp?.deactivate(true);
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
            await Promise.race([this._lsp?.deactivate(true), new Promise((resolve) => setTimeout(resolve, 250))]);
            return this._kernel.forceQuit();
        } else {
            throw new Error('Cannot force quit; kernel not started');
        }
    }

    async dispose() {
        // Clean up the console width listener
        this._consoleWidthDisposable?.dispose();
        this._consoleWidthDisposable = undefined;

        if (this._lsp) {
            await this._lsp.dispose();
        }
        if (this._kernel) {
            await this._kernel.dispose();
        }
    }

    private async createKernel(): Promise<JupyterLanguageRuntimeSession> {
        const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
        if (!ext) {
            throw new Error('Jupyter Adapter extension not found');
        }
        if (!ext.isActive) {
            await ext.activate();
        }
        this.adapterApi = ext?.exports as JupyterAdapterApi;
        const kernel = this.kernelSpec
            ? // We have a kernel spec, so we're creating a new session
              this.adapterApi.createSession(
                  this.runtimeMetadata,
                  this.metadata,
                  this.kernelSpec,
                  this.dynState,
                  createJupyterKernelExtra(),
              )
            : // We don't have a kernel spec, so we're restoring a session
              this.adapterApi.restoreSession(this.runtimeMetadata, this.metadata);

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
                    await this._lsp?.activate(port);
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
                            `Error setting initial console width: ${runtimeError.message} (${runtimeError.code})`,
                        );
                    }
                }
            });
        } else if (state === positron.RuntimeState.Exited) {
            if (this._lsp?.state === LspState.running) {
                this._queue.add(async () => {
                    if (this._kernel) {
                        this._kernel.emitJupyterLog(`Stopping Positron LSP server`);
                    }
                    await this._lsp?.deactivate(false);
                });
            }
        }
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
