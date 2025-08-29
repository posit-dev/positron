/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable global-require */
/* eslint-disable class-methods-use-this */
import * as portfinder from 'portfinder';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

import { Event, EventEmitter, Disposable } from 'vscode';
import { inject, injectable } from 'inversify';
import * as fs from '../common/platform/fs-paths';
import { IServiceContainer } from '../ioc/types';
import { pythonRuntimeDiscoverer } from './discoverer';
import { IInterpreterService } from '../interpreter/contracts';
import { traceError, traceInfo, traceLog } from '../logging';
import {
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    IInstaller,
    InstallerResponse,
    Product,
} from '../common/types';
import { PythonRuntimeSession } from './session';
import { createPythonRuntimeMetadata, PythonRuntimeExtraData } from './runtime';
import { Commands, EXTENSION_ROOT_DIR } from '../common/constants';
import { JupyterKernelSpec } from '../positron-supervisor.d';
import { IEnvironmentVariablesProvider } from '../common/variables/types';
import { shouldIncludeInterpreter, getUserDefaultInterpreter } from './interpreterSettings';
import { hasFiles } from './util';
import { isProblematicCondaEnvironment } from '../interpreter/configuration/environmentTypeComparer';
import { EnvironmentType } from '../pythonEnvironments/info';
import { IApplicationShell } from '../common/application/types';
import { Interpreters } from '../common/utils/localize';
import { untildify } from '../common/helpers';

export const IPythonRuntimeManager = Symbol('IPythonRuntimeManager');

export interface IPythonRuntimeManager extends positron.LanguageRuntimeManager {
    /**
     * An event that fires when a new Python language runtime session is created or restored.
     */
    onDidCreateSession: Event<PythonRuntimeSession>;

    registerLanguageRuntimeFromPath(
        pythonPath: string,
        recreateRuntime?: boolean,
    ): Promise<positron.LanguageRuntimeMetadata | undefined>;
    selectLanguageRuntimeFromPath(pythonPath: string, recreateRuntime?: boolean): Promise<void>;
}

/**
 * Provides Python language runtime metadata and sessions to Positron;
 * implements positron.LanguageRuntimeManager.
 */
@injectable()
export class PythonRuntimeManager implements IPythonRuntimeManager, Disposable {
    /**
     * A map of Python interpreter paths to their language runtime metadata.
     */
    readonly registeredPythonRuntimes: Map<string, positron.LanguageRuntimeMetadata> = new Map();

    private disposables: IDisposable[] = [];

    private readonly _onDidDiscoverRuntime = new EventEmitter<positron.LanguageRuntimeMetadata>();

    private readonly _onDidCreateSession = new EventEmitter<PythonRuntimeSession>();

    /**
     * An event that fires when a new Python language runtime is discovered.
     */
    public readonly onDidDiscoverRuntime = this._onDidDiscoverRuntime.event;

    public readonly onDidCreateSession = this._onDidCreateSession.event;

    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
    ) {
        const disposables = this.serviceContainer.get<Disposable[]>(IDisposableRegistry);
        disposables.push(this);

        this.disposables.push(
            positron.runtime.registerLanguageRuntimeManager('python', this),
            // When an interpreter is added, register a corresponding language runtime.
            interpreterService.onDidChangeInterpreters(async (event) => {
                if (!event.old && event.new) {
                    // An interpreter was added.
                    const interpreterPath = event.new.path;
                    await checkAndInstallPython(interpreterPath, serviceContainer);
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
    discoverAllRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
        return this.discoverPythonRuntimes();
    }

    /**
     * Get the recommended Python interpreter path for the workspace.
     * Returns an object with the path and whether it should be immediately selected.
     */
    private async recommendedWorkspaceInterpreterPath(
        workspaceUri: vscode.Uri | undefined,
    ): Promise<{ path: string | undefined; isImmediate: boolean }> {
        const userInterpreterSettings = getUserDefaultInterpreter(workspaceUri);
        let interpreterPath: string | undefined;
        let isImmediate = false;

        if (!workspaceUri) {
            if (userInterpreterSettings.globalValue) {
                interpreterPath = userInterpreterSettings.globalValue;
                isImmediate = true;
            } else {
                return { path: undefined, isImmediate };
            }
        } else if (await hasFiles(['.venv/**/*'])) {
            interpreterPath = path.join(workspaceUri.fsPath, '.venv', 'bin', 'python');
            isImmediate = true;
        } else if (await hasFiles(['.conda/**/*'])) {
            interpreterPath = path.join(workspaceUri.fsPath, '.conda', 'bin', 'python');
            isImmediate = true;
        } else if (await hasFiles(['*/bin/python'])) {
            // if we found */bin/python but not .venv or .conda, use the first one we find
            const files = await vscode.workspace.findFiles('*/bin/python', '**/node_modules/**');
            if (files.length > 0) {
                interpreterPath = files[0].fsPath;
                isImmediate = true;
            }
        } else {
            interpreterPath =
                userInterpreterSettings.workspaceValue ||
                userInterpreterSettings.workspaceFolderValue ||
                userInterpreterSettings.globalValue;
        }

        return { path: interpreterPath, isImmediate };
    }

    /**
     * Recommend a Python language runtime based on the workspace.
     */
    async recommendedWorkspaceRuntime(): Promise<positron.LanguageRuntimeMetadata | undefined> {
        // TODO: may need other handling for multiroot workspaces
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        let { path: interpreterPath, isImmediate } = await this.recommendedWorkspaceInterpreterPath(workspaceUri);

        if (interpreterPath) {
            interpreterPath = untildify(interpreterPath);
            const interpreter = await this.interpreterService.getInterpreterDetails(interpreterPath, workspaceUri);
            if (interpreter) {
                const metadata = await createPythonRuntimeMetadata(interpreter, this.serviceContainer, isImmediate);
                traceInfo(`Recommended runtime for workspace: ${interpreter.path}`);
                return metadata;
            }
        }
        traceInfo('No recommended workspace runtime found.');
        return undefined;
    }

    /**
     * Registers a new language runtime with Positron.
     *
     * @param runtimeMetadata The metadata for the runtime to register.
     */
    public registerLanguageRuntime(runtime: positron.LanguageRuntimeMetadata): void {
        const extraData = runtime.extraRuntimeData as PythonRuntimeExtraData;

        if (shouldIncludeInterpreter(extraData.pythonPath)) {
            // Save the runtime for later use
            this.registeredPythonRuntimes.set(extraData.pythonPath, runtime);
            this._onDidDiscoverRuntime.fire(runtime);
        } else {
            traceInfo(`Not registering runtime ${extraData.pythonPath} as it is excluded via user settings.`);
        }
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
        const lsScriptPath = path.join(EXTENSION_ROOT_DIR, 'python_files', 'posit', 'positron_language_server.py');
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
        if (sessionMetadata.sessionMode === positron.LanguageRuntimeSessionMode.Console) {
            // Workaround to use Plotly's browser renderer. Ensures the plot is
            // displayed to fill the webview.
            env.PLOTLY_RENDERER = 'browser';
        }
        // For debugging notebook cells: https://github.com/microsoft/debugpy/issues/869
        env.PYDEVD_IPYTHON_COMPATIBLE_DEBUGGING = '1';
        const kernelSpec: JupyterKernelSpec = {
            argv: args,
            display_name: `${runtimeMetadata.runtimeName}`,
            language: 'Python',
            // On Windows, we need to use the 'signal' interrupt mode since 'message' is
            // not supported.
            interrupt_mode: os.platform() === 'win32' ? 'signal' : 'message',
            // In the future this may need to be updated to reflect the exact version of
            // the protocol supported by ipykernel. For now, use 5.3 as a lowest
            // common denominator.
            kernel_protocol_version: '5.3',
            env,
        };

        traceInfo(`createPythonSession: kernelSpec argv: ${args}`);

        // Create an adapter for the kernel to fulfill the LanguageRuntime interface.
        traceInfo(`createPythonSession: creating PythonRuntime`);
        return this.createPythonSession(runtimeMetadata, sessionMetadata, kernelSpec);
    }

    /**
     * Restores (reconnects to) an existing Python session.
     *
     * @param runtimeMetadata The metadata for the runtime to restore
     * @param sessionMetadata The metadata for the session to restore
     * @param sessionName The name of the session to restore
     *
     * @returns The restored session.
     */
    async restoreSession(
        runtimeMetadata: positron.LanguageRuntimeMetadata,
        sessionMetadata: positron.RuntimeSessionMetadata,
        sessionName: string,
    ): Promise<positron.LanguageRuntimeSession> {
        return this.createPythonSession(runtimeMetadata, sessionMetadata, undefined, sessionName);
    }

    private createPythonSession(
        runtimeMetadata: positron.LanguageRuntimeMetadata,
        sessionMetadata: positron.RuntimeSessionMetadata,
        kernelSpec?: JupyterKernelSpec,
        sessionName?: string,
    ): positron.LanguageRuntimeSession {
        const session = new PythonRuntimeSession(
            runtimeMetadata,
            sessionMetadata,
            this.serviceContainer,
            kernelSpec,
            sessionName,
        );
        this._onDidCreateSession.fire(session);
        return session;
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

        // Replace the metadata if we can find the runtime in the registered runtimes
        let registeredMetadata = this.registeredPythonRuntimes.get(extraData.pythonPath);

        if (!registeredMetadata) {
            // It's possible that the interpreter is located at pythonPath/bin/python.
            // Conda environments may have the .conda directory set as the pythonPath, however the
            // registered runtimes are stored with the pythonPath set to the python executable.
            const binPythonPath = path.join(extraData.pythonPath, 'bin', 'python');
            const binPythonExists = await fs.pathExists(binPythonPath);
            if (binPythonExists) {
                registeredMetadata = this.registeredPythonRuntimes.get(binPythonPath);
            }
        }

        // Metadata is valid
        return registeredMetadata ?? metadata;
    }

    /**
     * Validate an existing session for a Jupyter-compatible kernel.
     *
     * @param sessionId The session ID to validate
     * @returns True if the session is valid, false otherwise
     */
    async validateSession(sessionId: string): Promise<boolean> {
        const ext = vscode.extensions.getExtension('positron.positron-supervisor');
        if (!ext) {
            throw new Error('Positron Supervisor extension not found');
        }
        if (!ext.isActive) {
            await ext.activate();
        }
        return ext.exports.validateSession(sessionId);
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
    async registerLanguageRuntimeFromPath(
        pythonPath: string,
        recreateRuntime?: boolean,
    ): Promise<positron.LanguageRuntimeMetadata | undefined> {
        const alreadyRegisteredRuntime = this.registeredPythonRuntimes.get(pythonPath);
        if (alreadyRegisteredRuntime) {
            if (!recreateRuntime) {
                return alreadyRegisteredRuntime;
            }

            const sessions = await positron.runtime.getActiveSessions();
            // Find any active sessions using this runtime
            const sessionsToShutdown = sessions.filter((session) => {
                const sessionRuntime = session.runtimeMetadata.extraRuntimeData;
                return sessionRuntime.pythonPath === pythonPath;
            });

            // Shut down all sessions for this runtime before recreating it
            if (sessionsToShutdown.length > 0) {
                traceInfo(`Shutting down ${sessionsToShutdown.length} sessions using Python runtime at ${pythonPath}`);
                await Promise.all(
                    sessionsToShutdown.map(async (session) => {
                        session.shutdown(positron.RuntimeExitReason.Shutdown);
                    }),
                );
                // Remove the runtime from our registry so we can recreate it
                this.registeredPythonRuntimes.delete(pythonPath);
            }
        }

        // Get the interpreter corresponding to the new runtime.
        const interpreter = await this.interpreterService.getInterpreterDetails(pythonPath);
        // Create the runtime and register it with Positron.
        if (interpreter) {
            // Set recommendedForWorkspace to false, since we change the active runtime
            // in the onDidChangeActiveEnvironmentPath listener.
            const newRuntime = await createPythonRuntimeMetadata(interpreter, this.serviceContainer, false);
            // Register the runtime with Positron.
            this.registerLanguageRuntime(newRuntime);
            return newRuntime;
        }

        traceError(`Could not register runtime due to an invalid interpreter path: ${pythonPath}`);
        return undefined;
    }

    /**
     * Select a Python language runtime in the console by its interpreter path.
     *
     * @param pythonPath The path to the Python interpreter.
     * @returns Promise that resolves when the runtime is selected.
     */
    async selectLanguageRuntimeFromPath(pythonPath: string, recreateRuntime?: boolean): Promise<void> {
        await this.registerLanguageRuntimeFromPath(pythonPath, recreateRuntime);
        const runtimeMetadata = this.registeredPythonRuntimes.get(pythonPath);
        if (runtimeMetadata) {
            await positron.runtime.selectLanguageRuntime(runtimeMetadata.runtimeId);
        } else {
            traceError(`Tried to switch to a language runtime that has not been registered: ${pythonPath}`);
        }
    }
}

export async function checkAndInstallPython(
    pythonPath: string,
    serviceContainer: IServiceContainer,
): Promise<InstallerResponse> {
    const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
    const interpreter = await interpreterService.getInterpreterDetails(pythonPath);
    if (!interpreter) {
        return InstallerResponse.Ignore;
    }
    if (
        isProblematicCondaEnvironment(interpreter) ||
        (interpreter.id && !fs.existsSync(interpreter.id) && interpreter.envType === EnvironmentType.Conda)
    ) {
        if (interpreter) {
            const installer = serviceContainer.get<IInstaller>(IInstaller);
            const shell = serviceContainer.get<IApplicationShell>(IApplicationShell);
            const progressOptions: vscode.ProgressOptions = {
                location: vscode.ProgressLocation.Window,
                title: `[${Interpreters.installingPython}](command:${Commands.ViewOutput})`,
            };
            traceLog('Conda envs without Python are known to not work well; fixing conda environment...');
            const promise = installer.install(
                Product.python,
                await interpreterService.getInterpreterDetails(pythonPath),
            );
            shell.withProgress(progressOptions, () => promise);

            // If Python is not installed into the environment, install it.
            if (!(await installer.isInstalled(Product.python))) {
                traceInfo(`Python not able to be installed.`);
                return InstallerResponse.Ignore;
            }
        }
    }
    return InstallerResponse.Installed;
}
