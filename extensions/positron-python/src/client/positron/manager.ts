/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable global-require */
/* eslint-disable class-methods-use-this */
import * as portfinder from 'portfinder';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as path from 'path';
import * as fs from 'fs-extra';

import { Event, EventEmitter } from 'vscode';
import { inject, injectable } from 'inversify';
import { IServiceContainer } from '../ioc/types';
import { pythonRuntimeDiscoverer } from './discoverer';
import { IInterpreterService } from '../interpreter/contracts';
import { traceError, traceInfo } from '../logging';
import { IConfigurationService, IDisposable } from '../common/types';
import { PythonRuntimeSession } from './session';
import { createPythonRuntimeMetadata, PythonRuntimeExtraData } from './runtime';
import { EXTENSION_ROOT_DIR } from '../common/constants';
import { JupyterKernelSpec } from '../jupyter-adapter.d';
import { IEnvironmentVariablesProvider } from '../common/variables/types';
import { checkAndInstallPython } from './extension';
import { showErrorMessage } from '../common/vscodeApis/windowApis';
import { CreateEnv } from '../common/utils/localize';

export const IPythonRuntimeManager = Symbol('IPythonRuntimeManager');

export interface IPythonRuntimeManager extends positron.LanguageRuntimeManager {
    registerLanguageRuntimeFromPath(pythonPath: string): Promise<void>;
    selectLanguageRuntimeFromPath(pythonPath: string): Promise<void>;
}

/**
 * Provides Python language runtime metadata and sessions to Positron;
 * implements positron.LanguageRuntimeManager.
 */
@injectable()
export class PythonRuntimeManager implements IPythonRuntimeManager {
    /**
     * A map of Python interpreter paths to their language runtime metadata.
     */
    readonly registeredPythonRuntimes: Map<string, positron.LanguageRuntimeMetadata> = new Map();

    private disposables: IDisposable[] = [];

    private readonly onDidDiscoverRuntimeEmitter = new EventEmitter<positron.LanguageRuntimeMetadata>();

    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
    ) {
        this.onDidDiscoverRuntime = this.onDidDiscoverRuntimeEmitter.event;

        positron.runtime.registerLanguageRuntimeManager(this);

        this.disposables.push(
            // When an interpreter is added, register a corresponding language runtime.
            interpreterService.onDidChangeInterpreters(async (event) => {
                if (!event.old && event.new) {
                    // An interpreter was added.
                    const interpreterPath = event.new.path;
                    await checkAndInstallPython(interpreterPath, serviceContainer);
                    if (!fs.existsSync(interpreterPath)) {
                        showErrorMessage(`${CreateEnv.pathDoesntExist} ${interpreterPath}`);
                    }
                    await this.registerLanguageRuntimeFromPath(interpreterPath);
                }
            }),

            interpreterService.onDidChangeInterpreter(async (workspaceUri) => {
                const interpreter = await interpreterService.getActiveInterpreter(workspaceUri);
                if (!interpreter) {
                    traceError(
                        `Interpreter not found; could not select language runtime. Workspace: ${workspaceUri?.fsPath}`,
                    );
                    return;
                }
                await this.selectLanguageRuntimeFromPath(interpreter.path);
            }),
        );
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    /**
     * Discovers all Python language runtimes/environments available to the
     * extension.
     *
     * @returns An async generator that yields Python language runtime metadata.
     */
    discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
        return this.discoverPythonRuntimes();
    }

    /**
     * An event that fires when a new Python language runtime is discovered.
     */
    onDidDiscoverRuntime: Event<positron.LanguageRuntimeMetadata>;

    /**
     * Registers a new language runtime with Positron.
     *
     * @param runtimeMetadata The metadata for the runtime to register.
     */
    public registerLanguageRuntime(runtime: positron.LanguageRuntimeMetadata): void {
        // Save the runtime for later use
        const extraData = runtime.extraRuntimeData as PythonRuntimeExtraData;
        this.registeredPythonRuntimes.set(extraData.pythonPath, runtime);
        this.onDidDiscoverRuntimeEmitter.fire(runtime);
    }

    /**
     * Creates a new Python language runtime session.
     *
     * @param runtimeMetadata The metadata for the runtime to create.
     * @param sessionMetadata The metadata for the session to create.
     *
     * @returns A promise that resolves to the new language runtime session.
     */
    async createSession(
        runtimeMetadata: positron.LanguageRuntimeMetadata,
        sessionMetadata: positron.RuntimeSessionMetadata,
    ): Promise<positron.LanguageRuntimeSession> {
        traceInfo('createPythonSession: getting service instances');

        const configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        const environmentVariablesProvider = this.serviceContainer.get<IEnvironmentVariablesProvider>(
            IEnvironmentVariablesProvider,
        );

        // Extract the extra data from the runtime metadata; it contains the
        // environment ID that was saved when the metadata was created.
        const extraData: PythonRuntimeExtraData = runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData;
        if (!extraData || !extraData.pythonPath) {
            throw new Error(`Runtime metadata missing Python path: ${JSON.stringify(extraData)}`);
        }

        // Check Python kernel debug and log level settings
        // NOTE: We may need to pass a resource to getSettings to support multi-root workspaces
        traceInfo('createPythonSession: getting extension runtime settings');

        const settings = configService.getSettings();
        const debug = settings.languageServerDebug;
        const logLevel = settings.languageServerLogLevel;
        const { quietMode } = settings;

        // If required, also locate an available port for the debugger
        traceInfo('createPythonSession: locating available debug port');
        let debugPort;
        if (debug) {
            if (debugPort === undefined) {
                debugPort = 5678; // Default port for debugpy
            }
            debugPort = await portfinder.getPortPromise({ port: debugPort });
        }

        const command = extraData.pythonPath;
        const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'python_files', 'positron', 'positron_language_server.py');
        const args = [
            command,
            lsScriptPath,
            '-f',
            '{connection_file}',
            '--logfile',
            '{log_file}',
            `--loglevel=${logLevel}`,
            `--session-mode=${sessionMetadata.sessionMode}`,
        ];
        if (debugPort) {
            args.push(`--debugport=${debugPort}`);
        }
        if (quietMode) {
            args.push('--quiet');
        }

        // Create a kernel spec for this Python installation. The kernel spec is
        // only provided for new sessions; existing (restored) sessions already
        // have one.
        const env = await environmentVariablesProvider.getEnvironmentVariables();
        const kernelSpec: JupyterKernelSpec = {
            argv: args,
            display_name: `${runtimeMetadata.runtimeName}`,
            language: 'Python',
            env,
        };

        traceInfo(`createPythonSession: kernelSpec argv: ${args}`);

        // Create an adapter for the kernel to fulfill the LanguageRuntime interface.
        traceInfo(`createPythonSession: creating PythonRuntime`);
        return new PythonRuntimeSession(runtimeMetadata, sessionMetadata, this.serviceContainer, kernelSpec);
    }

    /**
     * Restores (reconnects to) an existing Python session.
     *
     * @param runtimeMetadata The metadata for the runtime to restore
     * @param sessionMetadata The metadata for the session to restore
     *
     * @returns The restored session.
     */
    async restoreSession(
        runtimeMetadata: positron.LanguageRuntimeMetadata,
        sessionMetadata: positron.RuntimeSessionMetadata,
    ): Promise<positron.LanguageRuntimeSession> {
        return new PythonRuntimeSession(runtimeMetadata, sessionMetadata, this.serviceContainer);
    }

    /**
     * Validates the metadata for a Python language runtime.
     *
     * @param metadata The metadata to validate.
     * @returns The validated metadata.
     */
    async validateMetadata(metadata: positron.LanguageRuntimeMetadata): Promise<positron.LanguageRuntimeMetadata> {
        // Extract the extra data from the runtime metadata
        const extraData: PythonRuntimeExtraData = metadata.extraRuntimeData as PythonRuntimeExtraData;
        if (!extraData || !extraData.pythonPath) {
            throw new Error(`Runtime metadata missing Python path: ${JSON.stringify(extraData)}`);
        }

        // Ensure that the Python interpreter exists
        const exists = await fs.pathExists(extraData.pythonPath);
        if (!exists) {
            // Consider: Could we return metadata for an interpreter compatible
            // with the one requested rather than throwing?
            throw new Error(`Python interpreter path is missing: ${extraData.pythonPath}`);
        }

        // Replace the metadata if we can find the runtime in the registered runtimes,
        const registeredMetadata = this.registeredPythonRuntimes.get(extraData.pythonPath);

        // Metadata is valid
        return registeredMetadata ?? metadata;
    }

    /**
     * Wrapper for Python runtime discovery method that caches the metadata
     * before it's returned to Positron.
     */
    private async *discoverPythonRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
        // Get the async generator for Python runtimes
        const discoverer = pythonRuntimeDiscoverer(this.serviceContainer);

        // As each runtime metadata element is returned, cache and return it
        for await (const runtime of discoverer) {
            // Save a copy of the metadata for later use
            const extraData = runtime.extraRuntimeData as PythonRuntimeExtraData;
            this.registeredPythonRuntimes.set(extraData.pythonPath, runtime);

            // Return the runtime to Positron
            yield runtime;
        }
    }

    /**
     * Register a Python language runtime given its interpreter path.
     *
     * @param pythonPath The path to the Python interpreter.
     * @returns Promise that resolves when the runtime is registered.
     */
    async registerLanguageRuntimeFromPath(pythonPath: string): Promise<void> {
        if (this.registeredPythonRuntimes.has(pythonPath)) {
            return;
        }
        // Get the interpreter corresponding to the new runtime.
        const interpreter = await this.interpreterService.getInterpreterDetails(pythonPath);
        // Create the runtime and register it with Positron.
        if (interpreter) {
            // Set recommendedForWorkspace to false, since we change the active runtime
            // in the onDidChangeActiveEnvironmentPath listener.
            const runtime = await createPythonRuntimeMetadata(interpreter, this.serviceContainer, false);
            // Register the runtime with Positron.
            this.registerLanguageRuntime(runtime);
        } else {
            traceError(`Could not register runtime due to an invalid interpreter path: ${pythonPath}`);
        }
    }

    /**
     * Select a Python language runtime in the console by its interpreter path.
     *
     * @param pythonPath The path to the Python interpreter.
     * @returns Promise that resolves when the runtime is selected.
     */
    async selectLanguageRuntimeFromPath(pythonPath: string): Promise<void> {
        await this.registerLanguageRuntimeFromPath(pythonPath);
        const runtimeMetadata = this.registeredPythonRuntimes.get(pythonPath);
        if (runtimeMetadata) {
            await positron.runtime.selectLanguageRuntime(runtimeMetadata.runtimeId);
        } else {
            traceError(`Tried to switch to a language runtime that has not been registered: ${pythonPath}`);
        }
    }
}
