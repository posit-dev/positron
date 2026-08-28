// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// --- Start Positron ---
/* eslint-disable import/no-duplicates */
// --- End Positron ---

import { ConfigurationTarget, Disposable, QuickInputButtons } from 'vscode';
import { Commands } from '../../common/constants';
import { IDisposableRegistry, IPathUtils } from '../../common/types';
import { executeCommand, registerCommand } from '../../common/vscodeApis/commandApis';
import { IInterpreterQuickPick, IPythonPathUpdaterServiceManager } from '../../interpreter/configuration/types';
import { getCreationEvents, handleCreateEnvironmentCommand } from './createEnvironment';
import { condaCreationProvider } from './provider/condaCreationProvider';
import { VenvCreationProvider, VenvCreationProviderId } from './provider/venvCreationProvider';
import { showInformationMessage } from '../../common/vscodeApis/windowApis';
import { CreateEnv } from '../../common/utils/localize';
import {
    CreateEnvironmentProvider,
    CreateEnvironmentOptions,
    CreateEnvironmentResult,
    ProposedCreateEnvironmentAPI,
    EnvironmentDidCreateEvent,
} from './proposed.createEnvApis';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { CreateEnvironmentOptionsInternal } from './types';
import { useEnvExtension } from '../../envExt/api.internal';
import { PythonEnvironment } from '../../envExt/types';

// --- Start Positron ---
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { getCondaPythonVersions } from './provider/condaUtils';
import { IPythonRuntimeManager } from '../../positron/manager';
import { Conda } from '../common/environmentManagers/conda';
import { getUvPythonVersions, pickPythonVersion } from './provider/uvUtils';
import { getAvailablePythonVersions, isUvInstalled } from '../common/environmentManagers/uv';
import { UV_PROVIDER_ID, UvCreationProvider } from './provider/uvCreationProvider';
import {
    ensureUvInstalled,
    installPythonViaUv,
    InstallPythonResult,
    showUvInstallError,
} from '../common/environmentManagers/uvPythonInstaller';
import {
    createGlobalEnvironment,
    getGlobalEnvironmentDir,
    globalEnvironmentErrorMessage,
    promptForGlobalEnvironment,
} from '../common/environmentManagers/globalEnvironment';
import { MultiStepAction } from '../../common/vscodeApis/windowApis';
import {
    createEnvironmentAndRegister,
    CreateEnvironmentAndRegisterOptions,
    getCreateEnvironmentProviders,
    isEnvProviderEnabled,
    isGlobalPython,
} from '../../positron/createEnvApi';
import { traceError, traceLog } from '../../logging';
import { getConfiguration, getWorkspaceFolders } from '../../common/vscodeApis/workspaceApis';
import { InterpreterQuickPickList } from '../../common/utils/localize';
// --- End Positron ---

class CreateEnvironmentProviders {
    private _createEnvProviders: CreateEnvironmentProvider[] = [];

    constructor() {
        this._createEnvProviders = [];
    }

    // --- Start Positron ---
    // Added toTopOfList param
    public add(provider: CreateEnvironmentProvider, toTopOfList: boolean) {
        if (!isEnvProviderEnabled(provider.id)) {
            traceLog(`${provider.name} environment provider ${provider.id} is not enabled...skipping registration`);
            return;
        }
        // --- End Positron ---

        if (this._createEnvProviders.filter((p) => p.id === provider.id).length > 0) {
            throw new Error(`Create Environment provider with id ${provider.id} already registered`);
        }
        // --- Start Positron ---
        if (toTopOfList) {
            this._createEnvProviders.unshift(provider);
            return;
        }
        // --- End Positron ---
        this._createEnvProviders.push(provider);
    }

    public remove(provider: CreateEnvironmentProvider) {
        this._createEnvProviders = this._createEnvProviders.filter((p) => p !== provider);
    }

    public getAll(): readonly CreateEnvironmentProvider[] {
        return this._createEnvProviders;
    }
}

const _createEnvironmentProviders: CreateEnvironmentProviders = new CreateEnvironmentProviders();

// --- Start Positron ---
// Added toTopOfList param
export function registerCreateEnvironmentProvider(
    provider: CreateEnvironmentProvider,
    toTopOfList: boolean = false,
): Disposable {
    _createEnvironmentProviders.add(provider, toTopOfList);
    // --- End Positron ---
    return new Disposable(() => {
        _createEnvironmentProviders.remove(provider);
    });
}

export const { onCreateEnvironmentStarted, onCreateEnvironmentExited, isCreatingEnvironment } = getCreationEvents();

// --- Start Positron ---
/**
 * Handles the result of installPythonViaUv by registering the runtime and showing errors.
 * Returns the runtime ID if successful, undefined otherwise.
 */
async function handleInstallPythonResult(
    result: InstallPythonResult,
    pythonRuntimeManager: IPythonRuntimeManager,
): Promise<{ pythonPath: string; runtimeId: string | undefined } | undefined> {
    if (result.success && result.pythonPath) {
        // Register the runtime without starting a session - the caller handles that
        let metadata = await pythonRuntimeManager.registerLanguageRuntimeFromPath(result.pythonPath, true);

        // If registration failed, the interpreter might not be discovered yet - trigger refresh and retry
        if (!metadata) {
            await pythonRuntimeManager.triggerInterpreterRefresh();
            metadata = await pythonRuntimeManager.registerLanguageRuntimeFromPath(result.pythonPath, true);
        }

        return { pythonPath: result.pythonPath, runtimeId: metadata?.runtimeId };
    }
    if (result.error && result.error !== 'Cancelled') {
        await showUvInstallError(result.error);
    }
    return undefined;
}

/**
 * Runs Create Environment with no folder open.
 *
 * The provider ladder dead-ends at `pickWorkspaceFolder()` here, so offer the global
 * environment instead of the "open a folder" error. No provider is selected on this
 * path: outside a workspace the global environment is uv-backed by definition, and
 * conda users already have a global named-env model through conda itself, whose
 * environments are discovered independently. The caller only runs this for a request
 * that asked for uv or did not name a provider, so being uv-backed is never a surprise.
 *
 * The command handler's `showBackButton` option is ignored here: the version picker
 * runs on its own rather than as a step in the provider flow's `MultiStepNode` chain,
 * so there is no earlier step for Back to return to. `selectEnvironment` is honored by
 * the caller, since it says what to do with whatever environment came back rather than
 * how to build one.
 *
 * @param uvPythonVersion A `major.minor` version to build from, or `'auto'` to take
 *   uv's newest available version, matching `uvCreationProvider`. When undefined the
 *   user picks a version.
 * @returns The new environment's Python path, or undefined if nothing was created.
 */
async function createGlobalEnvironmentFromCommand(uvPythonVersion?: string): Promise<string | undefined> {
    // The version picker always shows a Back button, and the modal is the step behind
    // it, so Back reopens the modal instead of ending the command.
    let version: string | undefined;
    for (;;) {
        if ((await promptForGlobalEnvironment()) !== 'create') {
            // 'openFolder' reloads the extension host if a folder is opened, ending this
            // command with it.
            return undefined;
        }

        const uvReady = await ensureUvInstalled();
        if (!uvReady.ok) {
            if (uvReady.error) {
                await showUvInstallError(uvReady.error);
            }
            return undefined;
        }

        if (uvPythonVersion) {
            if (uvPythonVersion === 'auto') {
                const versions = await getAvailablePythonVersions();
                if (versions.length === 0) {
                    traceError('No Python versions available from uv for auto-selection.');
                    return undefined;
                }
                version = versions[0].version;
                traceLog(`Auto-selected Python version ${version} for the global environment.`);
            } else {
                version = uvPythonVersion;
            }
            break;
        }

        try {
            version = await pickPythonVersion();
            break;
        } catch (ex) {
            if (ex === MultiStepAction.Back) {
                continue;
            }
            if (ex === MultiStepAction.Cancel) {
                return undefined;
            }
            throw ex;
        }
    }
    if (!version) {
        return undefined;
    }

    const result = await createGlobalEnvironment(version);
    if (result.outcome !== 'created') {
        await showUvInstallError(globalEnvironmentErrorMessage(result));
        return undefined;
    }

    return result.pythonPath;
}

// Changed this function to be async
export async function registerCreateEnvironmentFeatures(
    // --- End Positron ---
    disposables: IDisposableRegistry,
    interpreterQuickPick: IInterpreterQuickPick,
    pythonPathUpdater: IPythonPathUpdaterServiceManager,
    pathUtils: IPathUtils,
    // --- Start Positron ---
    pythonRuntimeManager: IPythonRuntimeManager,
): Promise<void> {
    // --- End Positron ---
    disposables.push(
        registerCommand(
            Commands.Create_Environment,
            async (
                options?: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal,
            ): Promise<CreateEnvironmentResult | undefined> => {
                // --- Start Positron ---
                // With no folder open every provider dead-ends at pickWorkspaceFolder(),
                // so offer the global environment before provider selection runs. The
                // global environment is uv-backed, so a user who turned the uv provider
                // off through python.environmentProviders.enable does not get it, and
                // neither does a caller that explicitly asked for another provider: both
                // fall through to the provider ladder's own open-a-folder error rather
                // than being handed a uv environment they did not ask for. So does a user
                // with nowhere to put the global environment (no WORKON_HOME, no home dir).
                //
                // This path deliberately skips the started/exited creation events: the
                // folder-scoped exit handler below cannot apply without a folder, so the
                // notification is shown here instead.
                const requestedProviderId = options?.providerId;
                if (
                    !getWorkspaceFolders()?.length &&
                    getGlobalEnvironmentDir() &&
                    isEnvProviderEnabled(UV_PROVIDER_ID) &&
                    (requestedProviderId === undefined || requestedProviderId === UV_PROVIDER_ID)
                ) {
                    const path = await createGlobalEnvironmentFromCommand(options?.uvPythonVersion);
                    if (!path) {
                        return undefined;
                    }
                    showInformationMessage(`${CreateEnv.informEnvCreation} ${pathUtils.getDisplayName(path)}`);
                    // Registers the runtime and retries behind an interpreter refresh, which
                    // a freshly created environment needs. Selecting is the default here as
                    // it is on the workspace path below, but a caller that explicitly opts
                    // out gets the path back without a runtime being started.
                    if (options?.selectEnvironment !== false) {
                        await pythonRuntimeManager.selectLanguageRuntimeFromPath(path, true);
                    }
                    return { path };
                }
                // --- End Positron ---
                if (useEnvExtension()) {
                    try {
                        sendTelemetryEvent(EventName.ENVIRONMENT_CREATING, undefined, {
                            environmentType: undefined,
                            pythonVersion: undefined,
                        });
                        const result = await executeCommand<PythonEnvironment | undefined>(
                            'python-envs.createAny',
                            options,
                        );
                        if (result) {
                            const managerId = result.envId.managerId;
                            if (managerId === 'ms-python.python:venv') {
                                sendTelemetryEvent(EventName.ENVIRONMENT_CREATED, undefined, {
                                    environmentType: 'venv',
                                    reason: 'created',
                                });
                            }
                            if (managerId === 'ms-python.python:conda') {
                                sendTelemetryEvent(EventName.ENVIRONMENT_CREATED, undefined, {
                                    environmentType: 'conda',
                                    reason: 'created',
                                });
                            }
                            return { path: result.environmentPath.path };
                        }
                    } catch (err) {
                        if (err === QuickInputButtons.Back) {
                            return { workspaceFolder: undefined, action: 'Back' };
                        }
                        throw err;
                    }
                } else {
                    const providers = _createEnvironmentProviders.getAll();
                    // --- Start Positron ---
                    // register new path
                    const env = await handleCreateEnvironmentCommand(providers, options);
                    if (env?.path) {
                        await pythonRuntimeManager.selectLanguageRuntimeFromPath(env.path, true);
                    }
                    return env;
                    // --- End Positron ---
                }
                return undefined;
            },
        ),
        registerCommand(Commands.Create_Environment_Button, async (): Promise<void> => {
            sendTelemetryEvent(EventName.ENVIRONMENT_BUTTON, undefined, undefined);
            await executeCommand(Commands.Create_Environment);
        }),
        // --- Start Positron ---
        registerCommand(Commands.Get_Create_Environment_Providers, () => {
            const providers = _createEnvironmentProviders.getAll();
            return getCreateEnvironmentProviders(providers);
        }),
        registerCommand(Commands.Create_Environment_And_Register, (options: CreateEnvironmentAndRegisterOptions) => {
            const providers = _createEnvironmentProviders.getAll();
            return createEnvironmentAndRegister(providers, pythonRuntimeManager, options);
        }),
        registerCommand(Commands.Is_Conda_Installed, async (): Promise<boolean> => {
            const conda = await Conda.getConda();
            return conda !== undefined;
        }),
        registerCommand(Commands.Get_Conda_Python_Versions, () => getCondaPythonVersions()),
        registerCommand(Commands.Is_Uv_Installed, async () => await isUvInstalled()),
        registerCommand(Commands.Get_Uv_Python_Versions, async () => await getUvPythonVersions()),
        registerCommand(Commands.InstallPythonViaUv, async () => {
            try {
                const result = await installPythonViaUv();
                const handled = await handleInstallPythonResult(result, pythonRuntimeManager);
                // Start the newly installed runtime in the Console. The runtime-picker path
                // (onDidSelectItem) lets Positron start the returned runtimeId itself, so
                // handleInstallPythonResult only registers - the palette command must start it here.
                if (handled?.runtimeId) {
                    // Best-effort: start the runtime in the console. A failure here does
                    // not mean the install failed - the runtime is still registered and
                    // will appear in the session picker.
                    try {
                        await positron.runtime.selectLanguageRuntime(handled.runtimeId);
                    } catch (startError) {
                        traceError(`Failed to start runtime after Python install: ${startError}`);
                    }
                }
                return handled;
            } catch (error) {
                traceError(`installPythonViaUv command failed: ${error}`);
                await showUvInstallError(InterpreterQuickPickList.UvInstall.installCommandFailed);
                return undefined;
            }
        }),
        registerCommand(Commands.Is_Global_Python, (interpreterPath: string) => isGlobalPython(interpreterPath)),
    );

    // Register the runtime picker contribution that offers environment setup actions:
    // "Install Python via uv" when only system/global Pythons (or none) are registered,
    // and "Create Python Environment" once a non-system Python exists.
    disposables.push(
        positron.runtime.registerRuntimePickerContribution({
            languageId: 'python',

            async getItems(): Promise<positron.runtime.RuntimePickerItem[]> {
                // Get all registered runtimes to check what Python interpreters exist
                const runtimes = await positron.runtime.getRegisteredRuntimes();
                const pythonRuntimes = runtimes.filter((r) => r.languageId === 'python');

                // Check if we only have system/global Python (no virtual environments)
                const hasOnlySystemPython =
                    pythonRuntimes.length > 0 &&
                    pythonRuntimes.every((r) => ['System', 'Global'].includes(r.runtimeSource));
                const hasNonSystemPython = pythonRuntimes.some((r) => !['System', 'Global'].includes(r.runtimeSource));

                // Check if Python installation via uv is allowed
                const allowUvPythonInstall = getConfiguration('python').get<boolean>('allowUvPythonInstall') ?? true;

                // Check if we should always show the option (for testing)
                const alwaysShow =
                    getConfiguration('python').get<boolean>('INTERNAL_alwaysShowUvInstallOption') ?? false;

                const items: positron.runtime.RuntimePickerItem[] = [];

                // Show the install option if:
                // - Always show is enabled (for testing), OR
                // - No Python runtimes found, OR
                // - Only system/global Python found (no virtual environments)
                if (allowUvPythonInstall && (alwaysShow || pythonRuntimes.length === 0 || hasOnlySystemPython)) {
                    items.push({
                        id: 'install-python-uv',
                        label: '$(add) Install Python via uv',
                        separatorLabel: 'Install Python',
                    });
                }

                // Once a non-system Python exists the uv item hides; offer environment
                // creation instead so the picker always has a setup affordance.
                if (hasNonSystemPython) {
                    items.push({
                        id: 'create-python-env',
                        label: '$(add) Create Python Environment',
                        separatorLabel: 'Create Environment',
                    });
                }

                return items;
            },

            async onDidSelectItem(itemId: string): Promise<string | undefined> {
                if (itemId === 'install-python-uv') {
                    try {
                        const result = await installPythonViaUv();
                        const handled = await handleInstallPythonResult(result, pythonRuntimeManager);
                        return handled?.runtimeId;
                    } catch (error) {
                        traceError(`Install Python via uv failed: ${error}`);
                        await showUvInstallError(InterpreterQuickPickList.UvInstall.installCommandFailed);
                    }
                }
                if (itemId === 'create-python-env') {
                    try {
                        // The Positron fork of this command registers the created env's
                        // runtime and starts it in the console, so resolve undefined:
                        // returning a runtimeId would make the picker start a second
                        // session for the same runtime.
                        await executeCommand(Commands.Create_Environment);
                    } catch (error) {
                        traceError(`Create Python Environment from runtime picker failed: ${error}`);
                    }
                }
                return undefined;
            },
        }),
    );
    // --- End Positron ---
    disposables.push(
        registerCreateEnvironmentProvider(new VenvCreationProvider(interpreterQuickPick)),
        registerCreateEnvironmentProvider(condaCreationProvider()),
        // --- Start Positron ---
        registerCreateEnvironmentProvider(new UvCreationProvider(), await isUvInstalled()),
        // --- End Positron ---
        onCreateEnvironmentExited(async (e: EnvironmentDidCreateEvent) => {
            if (e.path && e.options?.selectEnvironment) {
                await pythonPathUpdater.updatePythonPath(
                    e.path,
                    ConfigurationTarget.WorkspaceFolder,
                    'ui',
                    e.workspaceFolder?.uri,
                );
                showInformationMessage(`${CreateEnv.informEnvCreation} ${pathUtils.getDisplayName(e.path)}`);
            }
        }),
    );
}

export function buildEnvironmentCreationApi(): ProposedCreateEnvironmentAPI {
    return {
        onWillCreateEnvironment: onCreateEnvironmentStarted,
        onDidCreateEnvironment: onCreateEnvironmentExited,
        createEnvironment: async (
            options?: CreateEnvironmentOptions | undefined,
        ): Promise<CreateEnvironmentResult | undefined> => {
            const providers = _createEnvironmentProviders.getAll();
            try {
                return await handleCreateEnvironmentCommand(providers, options);
            } catch (err) {
                return { path: undefined, workspaceFolder: undefined, action: undefined, error: err as Error };
            }
        },
        registerCreateEnvironmentProvider: (provider: CreateEnvironmentProvider) =>
            registerCreateEnvironmentProvider(provider),
    };
}

export async function createVirtualEnvironment(options?: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal) {
    const provider = _createEnvironmentProviders.getAll().find((p) => p.id === VenvCreationProviderId);
    if (!provider) {
        return;
    }
    return handleCreateEnvironmentCommand([provider], { ...options, providerId: provider.id });
}
