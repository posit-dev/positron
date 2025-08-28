/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable no-else-return */
/* eslint-disable class-methods-use-this */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import PQueue from 'p-queue';
import * as fs from '../common/platform/fs-paths';
import { ProductNames } from '../common/installer/productNames';
import { InstallOptions, ModuleInstallFlags } from '../common/installer/types';

import {
    IConfigurationService,
    IInstaller,
    IInterpreterPathService,
    InstallerResponse,
    Product,
    ProductInstallStatus,
} from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { PositronSupervisorApi, JupyterKernelSpec, JupyterLanguageRuntimeSession } from '../positron-supervisor.d';
import { traceInfo, traceWarn } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonLsp, LspState } from './lsp';
import { IPYKERNEL_VERSION } from '../common/constants';
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../common/variables/types';
import { PythonRuntimeExtraData } from './runtime';
import { JediLanguageServerAnalysisOptions } from '../activation/jedi/analysisOptions';
import { ILanguageServerOutputChannel } from '../activation/types';
import { IWorkspaceService } from '../common/application/types';
import { IInterpreterService } from '../interpreter/contracts';
import { showErrorMessage } from '../common/vscodeApis/windowApis';
import { Console } from '../common/utils/localize';
import { IpykernelBundle } from './ipykernel';
import { whenTimeout } from './util';

/** Regex for commands to uninstall packages using supported Python package managers. */
const _uninstallCommandRegex = /(pip|pipenv|conda).*uninstall|poetry.*remove/;

/**
 * A Positron language runtime that wraps a Jupyter kernel and a Language Server
 * Protocol client.
 */
export class PythonRuntimeSession implements positron.LanguageRuntimeSession, vscode.Disposable {
    /** The Language Server Protocol client wrapper, if created */
    private _lsp: PythonLsp | undefined;

    /** Queue for language server activation/deactivation */
    private _lspQueue: PQueue;

    /**
     * Promise that resolves after LSP server activation is finished.
     * Tracked to avoid stopping in the middle of startup.
     * Resolves to the port number the client should connect on.
     */
    private _lspStartingPromise: Promise<number> = Promise.resolve(0);

    /** Client ID for the LSP, used to close the Jupyter comm during deactivation */
    private _lspClientId?: string;

    /** The Jupyter kernel-based implementation of the Language Runtime API */
    private _kernel?: JupyterLanguageRuntimeSession;

    /** The emitter for language runtime messages */
    private _messageEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

    /** The emitter for language runtime state changes */
    private _stateEmitter = new vscode.EventEmitter<positron.RuntimeState>();

    /** The emitter for language runtime exits */
    private _exitEmitter = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

    /** The Positron Supervisor extension API */
    private adapterApi?: PositronSupervisorApi;

    /** The registration for console width changes */
    private _consoleWidthDisposable?: vscode.Disposable;

    /** The current state of the runtime */
    private _state: positron.RuntimeState = positron.RuntimeState.Uninitialized;

    /** The service for installing Python packages */
    private _installer: IInstaller;

    /** The service for managing Python environments */
    private _interpreterService: IInterpreterService;

    /** The service for managing the active Python interpreter path */
    private _interpreterPathService: IInterpreterPathService;

    /** The service for managing environment variables */
    private _envVarsService: IEnvironmentVariablesService;

    /**
     * Map of parent message IDs currently handled by IPyWidgets output widget comms,
     * keyed by comm ID.
     *
     * Output widgets may intercept replies to an execution and instead render them inside the
     * output widget. See https://ipywidgets.readthedocs.io/en/latest/examples/Output%20Widget.html
     * for more.
     */
    private _parentIdsByOutputCommId = new Map<string, string>();

    /** The Python interpreter executable path */
    private _pythonPath: string;

    /** The IPykernel bundle paths */
    private _ipykernelBundle: IpykernelBundle;

    /** The Runtime is externally managed. eg. a reticulate runtime */
    private _isExternallyManaged: boolean;

    /** Information about the runtime that is only available after starting */
    private _runtimeInfo?: positron.LanguageRuntimeInfo;

    private dynState: positron.LanguageRuntimeDynState;

    onDidReceiveRuntimeMessage = this._messageEmitter.event;

    onDidChangeRuntimeState = this._stateEmitter.event;

    onDidEndSession = this._exitEmitter.event;

    constructor(
        readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
        readonly metadata: positron.RuntimeSessionMetadata,
        readonly serviceContainer: IServiceContainer,
        readonly kernelSpec?: JupyterKernelSpec | undefined,
        sessionName?: string,
    ) {
        // Extract the extra data from the runtime metadata; it contains the
        // Python path that was saved when the metadata was created.
        const extraData: PythonRuntimeExtraData = runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData;
        if (!extraData || !extraData.pythonPath) {
            throw new Error(`Runtime metadata missing Python path: ${JSON.stringify(runtimeMetadata)}`);
        }
        if (!extraData.ipykernelBundle) {
            throw new Error(`Runtime metadata missing ipykernel bundle data: ${JSON.stringify(runtimeMetadata)}`);
        }
        this._pythonPath = extraData.pythonPath;
        this._ipykernelBundle = extraData.ipykernelBundle;
        this._isExternallyManaged = extraData.externallyManaged ?? false;

        this._lspQueue = new PQueue({ concurrency: 1 });

        this.dynState = {
            sessionName: sessionName || runtimeMetadata.runtimeName,
            inputPrompt: '>>>',
            continuationPrompt: '...',
        };

        this.onDidChangeRuntimeState(async (state) => {
            await this.onStateChange(state);
        });

        this._installer = this.serviceContainer.get<IInstaller>(IInstaller);
        this._interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
        this._interpreterPathService = serviceContainer.get<IInterpreterPathService>(IInterpreterPathService);
        this._envVarsService = serviceContainer.get<IEnvironmentVariablesService>(IEnvironmentVariablesService);
    }

    get runtimeInfo(): positron.LanguageRuntimeInfo | undefined {
        return this._runtimeInfo;
    }

    getDynState(): Thenable<positron.LanguageRuntimeDynState> {
        return Promise.resolve(this.dynState);
    }

    async debug(request: positron.DebugProtocolRequest): Promise<positron.DebugProtocolResponse> {
        if (this._kernel) {
            return await this._kernel.debug(request);
        } else {
            throw new Error(`Cannot debug; kernel not started`);
        }
    }

    execute(
        code: string,
        id: string,
        mode: positron.RuntimeCodeExecutionMode,
        errorBehavior: positron.RuntimeErrorBehavior,
    ): void {
        if (this._kernel) {
            if (this._isUninstallBundledPackageCommand(code, id)) {
                // It's an attempt to uninstall a bundled package, don't execute.
                return;
            }

            this._kernel.execute(code, id, mode, errorBehavior);
        } else {
            throw new Error(`Cannot execute '${code}'; kernel not started`);
        }
    }

    /**
     * Check if the code is an attempt to uninstall a bundled package, and if so, show a warning.
     */
    private _isUninstallBundledPackageCommand(code: string, id: string): boolean {
        if (!_uninstallCommandRegex.test(code)) {
            // Not an uninstall command.
            return false;
        }

        // It's an uninstall command.
        // Check if any bundled packages are being uninstalled.
        const protectedPackages = (this._ipykernelBundle.paths ?? [])
            .flatMap((path) => fs.readdirSync(path).map((name) => ({ parent: path, name })))
            .filter(({ name }) => code.includes(name));
        if (protectedPackages.length === 0) {
            return false;
        }

        // A bundled package is being uninstalled.
        // Emit a messaging explaining why the uninstall is not allowed.
        const protectedPackagesStr = protectedPackages
            .map(({ parent, name }) => vscode.l10n.t('- {0} (from {1})', name, parent))
            .join('\n');
        this._messageEmitter.fire({
            id: `${id}-0`,
            parent_id: id,
            when: new Date().toISOString(),
            type: positron.LanguageRuntimeMessageType.Stream,
            name: positron.LanguageRuntimeStreamName.Stdout,
            text: vscode.l10n.t(
                'Cannot uninstall the following packages:\n\n{0}\n\n' +
                'These packages are bundled with Positron, ' +
                "and removing them would break Positron's Python functionality.\n\n" +
                'If you would like to uninstall these packages from the active environment, ' +
                'please rerun `{1}` in a terminal.',
                protectedPackagesStr,
                code,
            ),
        } as positron.LanguageRuntimeStream);
        this._messageEmitter.fire({
            id: `${id}-1`,
            parent_id: id,
            when: new Date().toISOString(),
            type: positron.LanguageRuntimeMessageType.State,
            state: positron.RuntimeOnlineState.Idle,
        } as positron.LanguageRuntimeState);
        return true;
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
    createClient(id: string, type: positron.RuntimeClientType, params: any, metadata?: any): Thenable<void> {
        if (this._kernel) {
            return this._kernel.createClient(id, type, params, metadata);
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

    async setWorkingDirectory(dir: string): Promise<void> {
        if (this._kernel) {
            // Check to see if the 'os' module is available in the kernel
            const loaded = await this._kernel.callMethod('isModuleLoaded', 'os');
            let code = '';
            if (!loaded) {
                code = 'import os; ';
            }
            // Escape backslashes in the directory path
            dir = dir.replace(/\\/g, '\\\\');

            // Escape single quotes in the directory path
            dir = dir.replace(/'/g, "\\'");

            // Set the working directory
            code += `os.chdir('${dir}')`;

            this._kernel.execute(
                code,
                createUniqueId(),
                positron.RuntimeCodeExecutionMode.Interactive,
                positron.RuntimeErrorBehavior.Continue,
            );
        } else {
            throw new Error(`Cannot set working directory to ${dir}; kernel not started`);
        }
    }

    private async _setupIpykernel(interpreter: PythonEnvironment, kernelSpec: JupyterKernelSpec): Promise<void> {
        // Use the bundled ipykernel if requested.
        const didUseBundledIpykernel = await this._addBundledIpykernelToPythonPath(interpreter, kernelSpec);

        // If the bundled ipykernel was not used, proceed to install ipykernel for the interpreter.
        if (!didUseBundledIpykernel) {
            await this._installIpykernel(interpreter);
        }
    }

    private async _addBundledIpykernelToPythonPath(
        interpreter: PythonEnvironment,
        kernelSpec: JupyterKernelSpec,
    ): Promise<boolean> {
        if (this._ipykernelBundle.disabledReason || !this._ipykernelBundle.paths) {
            traceInfo(`Not using bundled ipykernel. Reason: ${this._ipykernelBundle.disabledReason}`);
            return false;
        }

        traceInfo(`Using bundled ipykernel for interpreter: ${interpreter.path}`);
        if (!kernelSpec?.env) {
            kernelSpec.env = {};
        }
        for (const path of this._ipykernelBundle.paths) {
            this._envVarsService.appendPythonPath(kernelSpec.env, path);
        }

        return true;
    }

    private async _installIpykernel(interpreter: PythonEnvironment): Promise<void> {
        // Offer to install the ipykernel module for the preferred interpreter, if it is missing.
        // Thow an error if it could not be installed.

        // We require ipykernel >= 6.19.1 for the Python runtime in order to ensure the comm package
        // can be imported on its own (https://github.com/ipython/ipykernel/releases/tag/v6.18.0)
        const hasCompatibleKernel = await this._installer.isProductVersionCompatible(
            Product.ipykernel,
            IPYKERNEL_VERSION,
            interpreter,
        );

        if (hasCompatibleKernel !== ProductInstallStatus.Installed) {
            // Check if sqlite3 if installed before attempting to install ipykernel
            // https://github.com/posit-dev/positron/issues/4698
            const hasSqlite3 = await this._installer.isInstalled(Product.sqlite3, interpreter);
            if (!hasSqlite3) {
                throw new Error(
                    `The Python sqlite3 extension is required but not installed for interpreter: ${interpreter?.displayName}. Missing the system library for SQLite?`,
                );
            }

            // Check if we have Pip installed, already
            const hasPip = await this._installer.isInstalled(Product.pip, interpreter);

            // Pass a cancellation token to enable VSCode's progress indicator and let the user
            // cancel the install.
            const tokenSource = new vscode.CancellationTokenSource();
            const installerToken = tokenSource.token;

            // Using a process to install modules avoids using the terminal service,
            // which has issues waiting for the outcome of the install.
            const installOptions: InstallOptions = { installAsProcess: true };
            const installOrUpgrade = hasCompatibleKernel === ProductInstallStatus.NeedsUpgrade ? 'upgrade' : 'install';

            const product = Product.ipykernel;

            let message;
            if (!hasPip) {
                message = vscode.l10n.t(
                    'To enable Python support, Positron needs to {0} the packages <code>{1}</code> and <code>{2}</code> for the active interpreter {3} at: <code>{4}</code>.',
                    installOrUpgrade,
                    ProductNames.get(Product.pip)!,
                    ProductNames.get(product)!,
                    `Python ${this.runtimeMetadata.languageVersion}`,
                    this.runtimeMetadata.runtimePath,
                );
            } else {
                message = vscode.l10n.t(
                    'To enable Python support, Positron needs to {0} the package <code>{1}</code> for the active interpreter {2} at: <code>{3}</code>.',
                    installOrUpgrade,
                    ProductNames.get(product)!,
                    `Python ${this.runtimeMetadata.languageVersion}`,
                    this.runtimeMetadata.runtimePath,
                );
            }

            const response = await this._installer.promptToInstall(
                product,
                interpreter,
                installerToken,
                ModuleInstallFlags.installPipIfRequired,
                installOptions,
                message,
            );

            switch (response) {
                case InstallerResponse.Installed:
                    traceInfo(`Successfully installed ipykernel for ${interpreter?.displayName}`);
                    break;
                case InstallerResponse.Ignore:
                case InstallerResponse.Disabled:
                    throw new Error(
                        `Could not start runtime: failed to install ipykernel for ${interpreter?.displayName}.`,
                    );
                default:
                    throw new Error(`Unknown installer response type: ${response}`);
            }
        }
    }

    async start(): Promise<positron.LanguageRuntimeInfo> {
        const interpreter = await this._interpreterService.getInterpreterDetails(this._pythonPath);
        if (!interpreter) {
            throw new Error(`Could not start runtime: failed to resolve interpreter ${this._pythonPath}`);
        }

        // If we're starting a new session (we have a kernel spec), ensure that ipykernel is available.
        if (this.kernelSpec) {
            await this._setupIpykernel(interpreter, this.kernelSpec);
        }

        // Ensure the LSP client instance is created
        if (!this._lsp) {
            await this.createLsp(interpreter);
        }

        // Ensure the Jupyter kernel instance is created
        if (!this._kernel) {
            this._kernel = await this.createKernel();
        }

        if (this.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console && !this._isExternallyManaged) {
            // Update the active environment in the Python extension.
            this._interpreterPathService.update(
                undefined,
                vscode.ConfigurationTarget.WorkspaceFolder,
                interpreter.path,
            );
        }

        // Register for console width changes, if we haven't already
        if (!this._consoleWidthDisposable) {
            this._consoleWidthDisposable = positron.window.onDidChangeConsoleWidth((newWidth) => {
                this.onConsoleWidthChange(newWidth);
            });
        }

        this._runtimeInfo = await this._kernel.start();
        if (this.kernelSpec) {
            this.enableAutoReloadIfEnabled(this._runtimeInfo);
        }
        return this._runtimeInfo;
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
            this._kernel.emitJupyterLog(
                `Error setting console width: ${runtimeError.message} (${runtimeError.code})`,
                vscode.LogLevel.Error,
            );
        }
    }

    async interrupt(): Promise<void> {
        if (this._kernel) {
            return this._kernel.interrupt();
        } else {
            throw new Error('Cannot interrupt; kernel not started');
        }
    }

    private async createLsp(interpreter: PythonEnvironment): Promise<void> {
        const environmentService = this.serviceContainer.get<IEnvironmentVariablesProvider>(
            IEnvironmentVariablesProvider,
        );
        const outputChannel = this.serviceContainer.get<ILanguageServerOutputChannel>(ILanguageServerOutputChannel);
        const configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);

        const analysisOptions = new JediLanguageServerAnalysisOptions(
            environmentService,
            outputChannel,
            configService,
            workspaceService,
        );

        const resource = workspaceService.workspaceFolders?.[0].uri;
        await analysisOptions.initialize(resource, interpreter);
        const languageClientOptions = await analysisOptions.getAnalysisOptions();

        this._lsp = new PythonLsp(
            this.serviceContainer,
            this.runtimeMetadata.languageVersion,
            languageClientOptions,
            this.metadata,
            this.dynState,
        );
    }

    /*
     * Start the LSP
     *
     * Returns a promise that resolves when the LSP has been activated.
     *
     * Should never be called within `PythonSession`, only the language server manager
     * should call this.
     */
    async activateLsp(reason: string): Promise<void> {
        this._kernel?.emitJupyterLog(
            `Queuing LSP activation. Reason: ${reason}. ` +
            `Queue size: ${this._lspQueue.size}, ` +
            `pending: ${this._lspQueue.pending}`,
            vscode.LogLevel.Debug,
        );
        return this._lspQueue.add(async () => {
            if (!this._kernel) {
                traceWarn('Cannot activate LSP; kernel not started');
                return;
            }

            this._kernel.emitJupyterLog(
                `LSP activation started. Reason: ${reason}. ` +
                `Queue size: ${this._lspQueue.size}, ` +
                `pending: ${this._lspQueue.pending}`,
                vscode.LogLevel.Debug,
            );

            if (!this._lsp) {
                this._kernel.emitJupyterLog(
                    'Tried to activate LSP but no LSP instance is available',
                    vscode.LogLevel.Warning,
                );
                return;
            }

            if (this._lsp.state !== LspState.stopped && this._lsp.state !== LspState.uninitialized) {
                this._kernel.emitJupyterLog('LSP already active', vscode.LogLevel.Debug);
                return;
            }

            this._kernel.emitJupyterLog('Starting Positron LSP server');

            // Create the LSP comm, which also starts the LSP server.
            // We await the server selected port (the server selects the
            // port since it is in charge of binding to it, which avoids
            // race conditions). We also use this promise to avoid restarting
            // in the middle of initialization.
            this._lspClientId = this._kernel.createPositronLspClientId();
            this._lspStartingPromise = this._kernel.startPositronLsp(this._lspClientId, '127.0.0.1');
            let port: number;
            try {
                port = await this._lspStartingPromise;
            } catch (err) {
                this._kernel.emitJupyterLog(`Error starting Positron LSP: ${err}`, vscode.LogLevel.Error);
                return;
            }

            this._kernel.emitJupyterLog(`Starting Positron LSP client on port ${port}`);

            await this._lsp.activate(port);
        });
    }

    /**
     * Stops the LSP if it is running
     *
     * Returns a promise that resolves when the LSP has been deactivated.
     *
     * The language server manager is in charge of starting up the LSP, so
     * `activateLsp()` should never be called from `PythonSession`, but the session
     * itself may need to call `deactivateLsp()`. This is okay for now, the
     * important thing is that an LSP should only ever be started up by the
     * manager to ensure that other LSPs are deactivated first.
     *
     * Avoid calling `this._lsp.deactivate()` directly, use this instead
     * to enforce usage of the `_lspQueue`.
     */
    async deactivateLsp(reason: string): Promise<void> {
        this._kernel?.emitJupyterLog(
            `Queuing LSP deactivation. Reason: ${reason}. ` +
            `Queue size: ${this._lspQueue.size}, ` +
            `pending: ${this._lspQueue.pending}`,
            vscode.LogLevel.Debug,
        );
        return this._lspQueue.add(async () => {
            this._kernel?.emitJupyterLog(
                `LSP deactivation started. Reason: ${reason}. ` +
                `Queue size: ${this._lspQueue.size}, ` +
                `pending: ${this._lspQueue.pending}`,
                vscode.LogLevel.Debug,
            );
            if (!this._lsp || this._lsp.state !== LspState.running) {
                this._kernel?.emitJupyterLog('LSP already deactivated', vscode.LogLevel.Debug);
                return;
            }

            this._kernel?.emitJupyterLog(`Stopping Positron LSP server, reason: ${reason}`);
            await this._lsp.deactivate();
            if (this._lspClientId) {
                this._kernel?.removeClient(this._lspClientId);
                this._lspClientId = undefined;
            }
            this._kernel?.emitJupyterLog(`Positron LSP server stopped`, vscode.LogLevel.Debug);
        });
    }

    async restart(workingDirectory?: string): Promise<void> {
        if (this._kernel) {
            this._kernel.emitJupyterLog('Restarting');
            // Stop the LSP client before restarting the kernel. Don't stop it
            // until fully started to avoid an inconsistent state where the
            // deactivation request comes in between the creation of the LSP
            // comm and the LSP client.
            //
            // A cleaner way to set this up might be to put `this._lsp` in
            // charge of creating the LSP comm, then `deactivate()` could
            // keep track of this state itself.
            const timedOut = await Promise.race([
                // No need to log LSP start failures here; they're logged on activation.
                this._lspStartingPromise.ignoreErrors(),
                whenTimeout(400, () => true),
            ]);
            if (timedOut) {
                this._kernel.emitJupyterLog(
                    'LSP startup timed out during interpreter restart',
                    vscode.LogLevel.Warning,
                );
            }
            await this.deactivateLsp('restarting session');
            return this._kernel.restart(workingDirectory);
        } else {
            throw new Error('Cannot restart; kernel not started');
        }
    }

    async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
        if (this._kernel) {
            this._kernel.emitJupyterLog('Shutting down');
            // Stop the LSP client before shutting down the kernel
            await this.deactivateLsp('shutting down session');
            return this._kernel.shutdown(exitReason);
        } else {
            throw new Error('Cannot shutdown; kernel not started');
        }
    }

    showOutput(channel?: positron.LanguageRuntimeSessionChannel): void {
        // Show the output for the LSP channel, if requested
        if (channel === positron.LanguageRuntimeSessionChannel.LSP) {
            this._lsp?.showOutput();
        } else {
            this._kernel?.showOutput(channel);
        }
    }

    listOutputChannels(): positron.LanguageRuntimeSessionChannel[] {
        const channels = this._kernel?.listOutputChannels?.() ?? [];
        // Add the LSP channel in addition to the kernel channels
        return [...channels, positron.LanguageRuntimeSessionChannel.LSP];
    }

    async forceQuit(): Promise<void> {
        if (this._kernel) {
            this._kernel.emitJupyterLog('Force quitting');
            // Stop the LSP client before shutting down the kernel. We only give
            // the LSP a quarter of a second to shut down before we force the
            // kernel to quit; we need to balance the need to respond to the
            // force-quit quickly with the fact that the LSP will show error
            // messages if we yank the kernel out from beneath it without
            // warning.
            await Promise.race([
                this.deactivateLsp('force quitting session'),
                new Promise((resolve) => setTimeout(resolve, 250)),
            ]);
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

    updateSessionName(sessionName: string): void {
        this.dynState.sessionName = sessionName;
        this._kernel?.updateSessionName(sessionName);
    }

    private async createKernel(): Promise<JupyterLanguageRuntimeSession> {
        const ext = vscode.extensions.getExtension('positron.positron-supervisor');
        if (!ext) {
            throw new Error('Positron Supervisor extension not found');
        }
        if (!ext.isActive) {
            await ext.activate();
        }
        this.adapterApi = ext?.exports as PositronSupervisorApi;
        const kernel = this.kernelSpec
            ? // We have a kernel spec, so we're creating a new session
            await this.adapterApi.createSession(
                this.runtimeMetadata,
                this.metadata,
                this.kernelSpec,
                this.dynState,
                createJupyterKernelExtra(),
            )
            : // We don't have a kernel spec, so we're restoring a session
            await this.adapterApi.restoreSession(this.runtimeMetadata, this.metadata, this.dynState);

        kernel.onDidChangeRuntimeState((state) => {
            this._stateEmitter.fire(state);
        });
        kernel.onDidReceiveRuntimeMessage((message) => {
            // Check if an IPyWidgets Output widget is starting to listen to a parent message ID.
            //
            // Output widgets may intercept replies to an execution and instead render them inside the
            // output widget. See https://ipywidgets.readthedocs.io/en/latest/examples/Output%20Widget.html
            // for more.
            if (message.type === positron.LanguageRuntimeMessageType.CommData) {
                const commMessage = message as positron.LanguageRuntimeCommMessage;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const data = commMessage.data as any;
                if (
                    'method' in data &&
                    data.method === 'update' &&
                    'state' in data &&
                    typeof data.state === 'object' &&
                    data.state !== null &&
                    'msg_id' in data.state &&
                    typeof data.state.msg_id === 'string'
                ) {
                    if (data.state.msg_id.length > 0) {
                        // Start intercepting messages for this parent ID.
                        this._parentIdsByOutputCommId.set(commMessage.comm_id, data.state.msg_id);
                    } else {
                        // Stop intercepting messages for the comm ID.
                        this._parentIdsByOutputCommId.delete(commMessage.comm_id);
                    }
                }
                // If the message should be handled by an IPyWidgets output widget,
                // emit a new IPyWidget message wrapping the original message.
                // See the note and link above for more.
            } else if (
                message.type !== positron.LanguageRuntimeMessageType.CommClosed &&
                message.type !== positron.LanguageRuntimeMessageType.CommOpen &&
                message.type !== positron.LanguageRuntimeMessageType.State &&
                Array.from(this._parentIdsByOutputCommId.values()).some((parentId) => parentId === message.parent_id)
            ) {
                message = {
                    ...message,
                    type: positron.LanguageRuntimeMessageType.IPyWidget,
                    original_message: message,
                } as positron.LanguageRuntimeMessageIPyWidget;
            }

            this._messageEmitter.fire(message);
        });
        kernel.onDidEndSession(async (exit) => {
            this._exitEmitter.fire(exit);
            if (exit.exit_code !== 0) {
                await this.showExitMessageWithLogs(kernel);
            }
        });
        return kernel;
    }

    private async onStateChange(state: positron.RuntimeState): Promise<void> {
        this._state = state;
        if (state === positron.RuntimeState.Ready) {
            await this.setConsoleWidth();
        } else if (state === positron.RuntimeState.Exited) {
            await this.deactivateLsp('session exited');
        }
    }

    private async setConsoleWidth(): Promise<void> {
        try {
            // Set the initial console width
            const width = await positron.window.getConsoleWidth();
            this.callMethod('setConsoleWidth', width);
            this._kernel?.emitJupyterLog(`Set initial console width to ${width}`);
        } catch (err) {
            // Recoverable (we'll just use the default width); but log
            // the error.
            const runtimeError = err as positron.RuntimeMethodError;
            this._kernel?.emitJupyterLog(
                `Error setting initial console width: ${runtimeError.message} (${runtimeError.code})`,
                vscode.LogLevel.Error,
            );
        }
    }

    private enableAutoReloadIfEnabled(info: positron.LanguageRuntimeInfo): void {
        // Enable auto-reload if the setting is enabled.
        const configurationService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        const settings = configurationService.getSettings();
        if (settings.enableAutoReload) {
            // Execute the autoreload magic command.
            this._kernel?.execute(
                '%load_ext autoreload\n%autoreload 2',
                createUniqueId(),
                positron.RuntimeCodeExecutionMode.Silent,
                positron.RuntimeErrorBehavior.Continue,
            );

            // Enable module hot-reloading for the kernel.
            const settingUri = `positron://settings/python.enableAutoReload`;
            const banner = vscode.l10n.t(
                'Automatic import reloading for Python is enabled. It can be disabled with the \x1b]8;;{0}\x1b\\python.enableAutoReload setting\x1b]8;;\x1b\\.',
                settingUri,
            );
            info.banner += banner;
        }
    }

    private async showExitMessageWithLogs(kernel: JupyterLanguageRuntimeSession): Promise<void> {
        const logFilePath = kernel.getKernelLogFile();

        if (fs.existsSync(logFilePath)) {
            const lines = fs.readFileSync(logFilePath, 'utf8').split('\n');
            // last line of logs before generated log tail
            const lastLine = lines.length - 3;
            const logFileContent = lines.slice(lastLine - 1, lastLine).join('\n');

            // see if obvious error, otherwise use generic text to logs
            const regex = /^(\w*Error|Exception)\b/m;
            const errortext = regex.test(logFileContent)
                ? vscode.l10n.t(
                    '{0} exited unexpectedly with error: {1}',
                    kernel.runtimeMetadata.runtimeName,
                    logFileContent,
                )
                : Console.consoleExitGeneric;

            const res = await showErrorMessage(errortext, vscode.l10n.t('Open Logs'));
            if (res) {
                kernel.showOutput();
            }
        }
    }
}

export function createUniqueId(): string {
    return Math.floor(Math.random() * 0x100000000).toString(16);
}

export function createJupyterKernelExtra(): undefined {
    // TODO: Implement and include startup hooks for the Python runtime.
    // return {
    //     attachOnStartup: new ArkAttachOnStartup(),
    //     sleepOnStartup: new ArkDelayStartup(),
    // };
    return undefined;
}

/** Get the active Python language runtime sessions. */
export async function getActivePythonSessions(): Promise<PythonRuntimeSession[]> {
    const sessions = await positron.runtime.getActiveSessions();
    return sessions.filter((session) => session instanceof PythonRuntimeSession) as PythonRuntimeSession[];
}
