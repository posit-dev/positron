/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { IInterpreterService, PythonEnvironmentsChangedEvent } from '../interpreter/contracts';
import { traceError, traceInfo } from '../logging';
import { IConfigurationService, IDisposable, IDisposableRegistry } from '../common/types';
import { getActivePythonSessions, PythonRuntimeSession } from './session';
import { createPythonRuntimeMetadata, PythonRuntimeExtraData } from './runtime';
import { getPythonDiscoveryRootSignature } from './discoveryRootSignature';
import { EXTENSION_ROOT_DIR } from '../common/constants';
import { JupyterKernelSpec } from '../positron-supervisor.d';
import { IEnvironmentVariablesProvider } from '../common/variables/types';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';
import { shouldIncludeInterpreter, getUserDefaultInterpreter } from './interpreterSettings';
import { hasFiles } from './util';
import { isCondaEnvironment } from '../pythonEnvironments/common/environmentManagers/conda';
import { untildify } from '../common/helpers';
import {
    pendingModuleRuntimeRegistrations,
    getEnvironmentModulesApi,
} from '../pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';
import { CondaPythonPickerContribution } from './condaPickerContribution';

export const IPythonRuntimeManager = Symbol('IPythonRuntimeManager');

export interface IPythonRuntimeManager extends positron.LanguageRuntimeManager {
    /**
     * An event that fires when a new Python language runtime session is created or restored.
     */
    onDidCreateSession: Event<PythonRuntimeSession>;

    /**
     * Register a Python language runtime for the given interpreter path.
     *
     * @param pythonPath The interpreter path.
     * @param recreateRuntime Shut down any sessions on an existing runtime for
     *        this path and re-register it.
     * @param forceRefresh Re-resolve the interpreter even if a runtime is
     *        already registered for this path, and supersede it if the resolved
     *        metadata differs (e.g. a version that a cached discovery pass got
     *        wrong). Without this, an already-registered path returns early
     *        without re-resolving.
     */
    registerLanguageRuntimeFromPath(
        pythonPath: string,
        recreateRuntime?: boolean,
        forceRefresh?: boolean,
    ): Promise<positron.LanguageRuntimeMetadata | undefined>;
    selectLanguageRuntimeFromPath(pythonPath: string, recreateRuntime?: boolean): Promise<string | undefined>;
    triggerInterpreterRefresh(): Promise<void>;
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

    private readonly _onDidRemoveRuntime = new EventEmitter<string>();

    private readonly _onDidCreateSession = new EventEmitter<PythonRuntimeSession>();

    /**
     * An event that fires when a new Python language runtime is discovered.
     */
    public readonly onDidDiscoverRuntime = this._onDidDiscoverRuntime.event;

    /**
     * An event that fires when a previously registered Python runtime should be
     * retracted from Positron, carrying the runtimeId to remove. Used to drop a
     * runtime whose interpreter was deleted, or a symlink alias that
     * de-duplication has collapsed into another path.
     */
    public readonly onDidRemoveRuntime = this._onDidRemoveRuntime.event;

    public readonly onDidCreateSession = this._onDidCreateSession.event;

    /**
     * Serializes handling of `onDidChangeInterpreters` events. The handler is
     * async (it resolves interpreter details before registering), so without a
     * queue a `Created` and a follow-up `Changed`/`Deleted` for the same path
     * could interleave and leave the registry out of sync with the picker.
     */
    private _interpreterChangeQueue: Promise<void> = Promise.resolve();

    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
    ) {
        const disposables = this.serviceContainer.get<Disposable[]>(IDisposableRegistry);
        disposables.push(this);

        this.disposables.push(
            positron.runtime.registerLanguageRuntimeManager('python', this),

            positron.runtime.registerRuntimePickerContribution(
                new CondaPythonPickerContribution(this.serviceContainer),
            ),

            // When an interpreter is added, removed, or replaced, keep our
            // registry (and the Positron picker) in sync. Serialized so a
            // Created and a follow-up Changed/Deleted for the same path can't
            // interleave. Each event's failure is caught and logged so one
            // transient error can't reject the queue and stop every later event
            // from being handled until reload.
            interpreterService.onDidChangeInterpreters((event) => {
                this._interpreterChangeQueue = this._interpreterChangeQueue
                    .then(() => this.handleInterpreterChange(event))
                    .catch((error) => {
                        const changedPath = event.new?.path ?? event.old?.path;
                        traceError(`Failed to handle interpreter change for ${changedPath}: ${error}`);
                    });
            }),

            interpreterService.onDidChangeInterpreter(async (event) => {
                // Split event: only session-intent fires should start a session. Storage-only fires
                // (migration, install-complete, active-env-deleted, positron-session-start, ...)
                // must not spawn a console here - that would reintroduce the #12116 regression.
                if (!event.startSession) {
                    traceInfo(
                        `Skipping session start for onDidChangeInterpreter fire (source=${event.source}, resource=${
                            event.resource?.fsPath ?? 'undefined'
                        })`,
                    );
                    return;
                }
                traceInfo(
                    `Handling onDidChangeInterpreter fire (source=${event.source}, resource=${
                        event.resource?.fsPath ?? 'undefined'
                    })`,
                );
                const interpreter = await interpreterService.getActiveInterpreter(event.resource);
                if (!interpreter) {
                    traceError(
                        `Interpreter not found; could not select language runtime. Workspace: ${event.resource?.fsPath}`,
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
     * Handles an interpreter add/remove/replace event, keeping the registry and
     * the Positron picker in sync. Invoked serially via `_interpreterChangeQueue`.
     *
     * - Added (`new` only): register a runtime for the new path. Uses
     *   forceRefresh so that if a cached discovery pass already registered this
     *   path with a stale version, we re-resolve and supersede it.
     * - Removed (`old` only): retract the removed path's runtime and shut down
     *   any sessions still backed by it.
     * - Replaced (`old` and `new` with different paths): de-duplication collapsed
     *   one interpreter alias into another (e.g. a symlink resolved to a shorter
     *   path). Retract the old alias's runtime -- which may already be in the
     *   picker from its own earlier Created event -- and register the survivor
     *   with forceRefresh so a stale cached version for the survivor path is
     *   re-resolved and superseded rather than returned as is.
     *   Same-path changes are metadata refreshes and leave the registration as is.
     */
    private async handleInterpreterChange(event: PythonEnvironmentsChangedEvent): Promise<void> {
        if (!event.old && event.new) {
            await this.registerLanguageRuntimeFromPath(
                event.new.path,
                /* recreateRuntime */ false,
                /* forceRefresh */ true,
            );
        } else if (event.old && !event.new) {
            const deletedPath = event.old.path;
            this.unregisterRuntimeForPath(deletedPath);
            try {
                // Only Python sessions; other languages' sessions may not even have
                // extraRuntimeData (e.g. restored from a serialized state).
                const sessions = await getActivePythonSessions();
                const toShutdown = sessions.filter(
                    (s) => (s.runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData).pythonPath === deletedPath,
                );
                if (toShutdown.length > 0) {
                    traceInfo(`Shutting down ${toShutdown.length} session(s) for deleted interpreter ${deletedPath}`);
                    await Promise.all(toShutdown.map((s) => s.shutdown(positron.RuntimeExitReason.Shutdown)));
                }
            } catch (error) {
                traceError(`Failed to clean up sessions for deleted interpreter ${deletedPath}: ${error}`);
            }
        } else if (event.old && event.new && event.old.path !== event.new.path) {
            this.unregisterRuntimeForPath(event.old.path);
            await this.registerLanguageRuntimeFromPath(
                event.new.path,
                /* recreateRuntime */ false,
                /* forceRefresh */ true,
            );
        }
    }

    /**
     * Retract the runtime registered for a given interpreter path, if any, so it
     * is removed from the Positron picker. No-op if the path isn't registered.
     */
    private unregisterRuntimeForPath(pythonPath: string): void {
        const existing = this.registeredPythonRuntimes.get(pythonPath);
        if (existing) {
            this.registeredPythonRuntimes.delete(pythonPath);
            this._onDidRemoveRuntime.fire(existing.runtimeId);
        }
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
            interpreterPath =
                os.platform() === 'win32'
                    ? path.join(workspaceUri.fsPath, '.venv', 'Scripts', 'python.exe')
                    : path.join(workspaceUri.fsPath, '.venv', 'bin', 'python');
            isImmediate = true;
        } else if (await hasFiles(['.conda/**/*'])) {
            interpreterPath =
                os.platform() === 'win32'
                    ? path.join(workspaceUri.fsPath, '.conda', 'Scripts', 'python.exe')
                    : path.join(workspaceUri.fsPath, '.conda', 'bin', 'python');
            isImmediate = true;
        } else if (await hasFiles(['*/bin/python', '*/Scripts/python.exe'])) {
            // if we found */bin/python or */Scripts/python.exe but not .venv or .conda, use the first one we find
            const files = await vscode.workspace.findFiles(
                os.platform() === 'win32' ? '*/Scripts/python.exe' : '*/bin/python',
                '**/node_modules/**',
            );
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

        // if user has startup set to manual, isImmediate should be false even if we find a recommended interpreter
        // Check both the general interpreters setting and the Python-specific override
        const generalStartupBehavior = getConfiguration('interpreters').get<string>('startupBehavior');
        const pythonStartupBehavior = getConfiguration('interpreters', { languageId: 'python' }).get<string>(
            'startupBehavior',
        );
        if (generalStartupBehavior === 'manual' || pythonStartupBehavior === 'manual') {
            isImmediate = false;
        }
        return { path: interpreterPath, isImmediate };
    }

    /**
     * Snapshot the directories this extension scans for Python interpreters.
     * Used by Positron to detect newly-installed Python interpreters between
     * startups without having to rerun a full discovery pass. See
     * `getPythonDiscoveryRootSignature` for the source list and what's excluded.
     */
    async getDiscoveryRootSignature(): Promise<positron.RuntimeRootSignature> {
        return getPythonDiscoveryRootSignature();
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
            let interpreter = await this.interpreterService.getInterpreterDetails(interpreterPath, workspaceUri);

            // This runs during startup, before interpreter discovery has necessarily
            // resolved this path. A cold resolve returns undefined, which would drop the
            // workspace default entirely, since it is never re-queried after discovery.
            // Trigger a refresh and retry once so the default is recommended reliably.
            // Mirrors the retry in selectLanguageRuntimeFromPath.
            if (!interpreter) {
                traceInfo(`Recommended interpreter ${interpreterPath} not resolved yet, triggering refresh...`);
                await this.interpreterService.triggerRefresh().ignoreErrors();
                interpreter = await this.interpreterService.getInterpreterDetails(interpreterPath, workspaceUri);
            }

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
            // If this path is already registered under a different runtime id
            // (e.g. a stale version -- the same venv reported as 3.14.4 by the
            // cached discovery pass and 3.14.6 once resolved), retract the old
            // one first so the picker shows a single entry per interpreter path.
            const existing = this.registeredPythonRuntimes.get(extraData.pythonPath);
            if (existing && existing.runtimeId !== runtime.runtimeId) {
                this._onDidRemoveRuntime.fire(existing.runtimeId);
            }

            // Save the runtime for later use
            this.registeredPythonRuntimes.set(extraData.pythonPath, runtime);
            this._onDidDiscoverRuntime.fire(runtime);

            // If this is a module environment runtime, register it with the environment-modules API
            const pendingRegistration = pendingModuleRuntimeRegistrations.get(extraData.pythonPath);
            if (pendingRegistration) {
                this.registerModuleRuntimeWithApi(
                    pendingRegistration.environmentName,
                    runtime.runtimeId,
                    extraData.pythonPath,
                );
                // Remove from pending registrations
                pendingModuleRuntimeRegistrations.delete(extraData.pythonPath);
            }
        } else {
            traceInfo(`Not registering runtime ${extraData.pythonPath} as it is excluded via user settings.`);
        }
    }

    /**
     * Register a module runtime with the environment-modules API for tracking.
     */
    private async registerModuleRuntimeWithApi(
        environmentName: string,
        runtimeId: string,
        interpreterPath: string,
    ): Promise<void> {
        try {
            const api = await getEnvironmentModulesApi();
            if (api) {
                api.registerDiscoveredRuntime(environmentName, 'python', interpreterPath);
                traceInfo(
                    `Registered module runtime ${runtimeId} for environment "${environmentName}" with environment-modules API`,
                );
            }
        } catch (error) {
            traceError(`Failed to register module runtime with environment-modules API: ${error}`);
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
        const environmentVariablesProvider =
            this.serviceContainer.get<IEnvironmentVariablesProvider>(IEnvironmentVariablesProvider);

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

        // On Windows, conda environments need additional library paths (Library/bin, etc.)
        // for DLL loading. Without these, Python could crash with STATUS_FATAL_USER_CALLBACK_EXCEPTION
        // when importing packages with native dependencies like numpy, matplotlib, etc.
        // See: https://github.com/posit-dev/positron/issues/9740
        if (os.platform() === 'win32' && (await isCondaEnvironment(extraData.pythonPath))) {
            const root = path.dirname(extraData.pythonPath);
            const condaPaths = [
                path.join(root, 'Library', 'bin'),
                path.join(root, 'Library', 'mingw-w64', 'bin'),
                path.join(root, 'Library', 'usr', 'bin'),
                path.join(root, 'bin'),
                path.join(root, 'Scripts'),
            ].join(path.delimiter);
            env.PATH = env.PATH ? condaPaths + path.delimiter + env.PATH : condaPaths;
        }
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

        // If this Python is from a module environment, set the startup command
        // to load the required modules before starting the kernel
        if (extraData.moduleMetadata?.startupCommand) {
            kernelSpec.startup_command = extraData.moduleMetadata.startupCommand;
            traceInfo(`createPythonSession: using module startup command: ${kernelSpec.startup_command}`);
        }

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
            const extraData = runtime.extraRuntimeData as PythonRuntimeExtraData;

            // If the live `onDidChangeInterpreters` handler already registered
            // this path during discovery, it resolved the interpreter and may
            // hold a more accurate version than this (cached) discovery pass --
            // e.g. a venv whose base was upgraded in place, reported here as the
            // stale `pyvenv.cfg` version but resolved live to the real one.
            // Yield the existing registration so the same path can't produce two
            // picker entries with different versions.
            const existing = this.registeredPythonRuntimes.get(extraData.pythonPath);
            if (existing && existing.runtimeId !== runtime.runtimeId) {
                yield existing;
                continue;
            }

            // Save a copy of the metadata for later use
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
        forceRefresh?: boolean,
    ): Promise<positron.LanguageRuntimeMetadata | undefined> {
        const alreadyRegisteredRuntime = this.registeredPythonRuntimes.get(pythonPath);
        if (alreadyRegisteredRuntime && !recreateRuntime && !forceRefresh) {
            // Fast path: a runtime is already registered for this path and the
            // caller hasn't asked us to recreate it or re-check its metadata, so
            // avoid re-resolving the interpreter.
            return alreadyRegisteredRuntime;
        }
        if (alreadyRegisteredRuntime && recreateRuntime) {
            const sessions = await getActivePythonSessions();
            // Find any active sessions using this runtime
            const sessionsToShutdown = sessions.filter((session) => {
                const sessionRuntime = session.runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData;
                return sessionRuntime.pythonPath === pythonPath;
            });

            // Shut down all sessions for this runtime before recreating it
            if (sessionsToShutdown.length > 0) {
                traceInfo(`Shutting down ${sessionsToShutdown.length} sessions using Python runtime at ${pythonPath}`);
                await Promise.all(
                    sessionsToShutdown.map((session) => session.shutdown(positron.RuntimeExitReason.Shutdown)),
                );
            }

            // clear stale entry so registerLanguageRuntime below fires _onDidDiscoverRuntime
            // for the new runtime vs. leaving Positron with an orphaned stale entry.
            this.registeredPythonRuntimes.delete(pythonPath);
        }

        // Get the interpreter corresponding to the new runtime. This resolves the
        // interpreter (running it when needed), so the version reflects what the
        // interpreter actually reports rather than a stale `pyvenv.cfg` version a
        // cached discovery pass may have registered for this path.
        const interpreter = await this.interpreterService.getInterpreterDetails(pythonPath);
        // Create the runtime and register it with Positron.
        if (interpreter) {
            // Set recommendedForWorkspace to false, since we change the active runtime
            // in the onDidChangeActiveEnvironmentPath listener.
            const newRuntime = await createPythonRuntimeMetadata(interpreter, this.serviceContainer, false);
            // On a forceRefresh, if the resolved runtime matches what's already
            // registered for this path, there's nothing to do. If it differs (e.g.
            // the real version supersedes a stale one from discovery),
            // registerLanguageRuntime retracts the stale entry so the picker shows
            // the correct version.
            if (
                alreadyRegisteredRuntime &&
                !recreateRuntime &&
                alreadyRegisteredRuntime.runtimeId === newRuntime.runtimeId
            ) {
                return alreadyRegisteredRuntime;
            }
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
    async selectLanguageRuntimeFromPath(pythonPath: string, recreateRuntime?: boolean): Promise<string | undefined> {
        // Try to register the runtime
        let metadata = await this.registerLanguageRuntimeFromPath(pythonPath, recreateRuntime);

        // If registration failed, the interpreter might be newly created - trigger a refresh and retry
        if (!metadata) {
            traceInfo(`Runtime not found for ${pythonPath}, triggering interpreter refresh...`);
            await this.triggerInterpreterRefresh();
            metadata = await this.registerLanguageRuntimeFromPath(pythonPath, recreateRuntime);
        }

        if (metadata) {
            await positron.runtime.selectLanguageRuntime(metadata.runtimeId);
            return metadata.runtimeId;
        } else {
            traceError(`Tried to switch to a language runtime that has not been registered: ${pythonPath}`);
            return undefined;
        }
    }

    /**
     * Triggers a refresh of the interpreter list.
     */
    async triggerInterpreterRefresh(): Promise<void> {
        await this.interpreterService.triggerRefresh();
    }
}
