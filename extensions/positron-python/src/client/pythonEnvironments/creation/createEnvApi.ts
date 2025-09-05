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
import { getCondaPythonVersions } from './provider/condaUtils';
import { IPythonRuntimeManager } from '../../positron/manager';
import { Conda } from '../common/environmentManagers/conda';
import { getUvPythonVersions } from './provider/uvUtils';
import { isUvInstalled } from '../common/environmentManagers/uv';
import { UvCreationProvider } from './provider/uvCreationProvider';
import {
    createEnvironmentAndRegister,
    getCreateEnvironmentProviders,
    isEnvProviderEnabled,
    isGlobalPython,
} from '../../positron/createEnvApi';
import { traceLog } from '../../logging';
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
        registerCommand(
            Commands.Create_Environment_Button,
            async (): Promise<void> => {
                sendTelemetryEvent(EventName.ENVIRONMENT_BUTTON, undefined, undefined);
                await executeCommand(Commands.Create_Environment);
            },
        ),
        // --- Start Positron ---
        registerCommand(Commands.Get_Create_Environment_Providers, () => {
            const providers = _createEnvironmentProviders.getAll();
            return getCreateEnvironmentProviders(providers);
        }),
        registerCommand(
            Commands.Create_Environment_And_Register,
            (options: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal) => {
                const providers = _createEnvironmentProviders.getAll();
                return createEnvironmentAndRegister(providers, pythonRuntimeManager, options);
            },
        ),
        registerCommand(
            Commands.Is_Conda_Installed,
            async (): Promise<boolean> => {
                const conda = await Conda.getConda();
                return conda !== undefined;
            },
        ),
        registerCommand(Commands.Get_Conda_Python_Versions, () => getCondaPythonVersions()),
        registerCommand(Commands.Is_Uv_Installed, async () => await isUvInstalled()),
        registerCommand(Commands.Get_Uv_Python_Versions, () => getUvPythonVersions()),
        registerCommand(Commands.Is_Global_Python, (interpreterPath: string) => isGlobalPython(interpreterPath)),
        // --- End Positron ---
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
