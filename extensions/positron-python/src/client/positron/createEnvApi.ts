/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { Disposable, Uri, WorkspaceFolder } from 'vscode';
import { CreateEnvironmentOptionsInternal } from '../pythonEnvironments/creation/types';
import {
    CreateEnvironmentOptions,
    CreateEnvironmentProvider,
    CreateEnvironmentResult,
} from '../pythonEnvironments/creation/proposed.createEnvApis';
import {
    handleCreateEnvironmentCommand,
    holdCreatingEnvironment,
} from '../pythonEnvironments/creation/createEnvironment';
import { IPythonRuntimeManager } from './manager';
import { PythonRuntimeExtraData } from './runtime';
import { arePathsSame } from '../pythonEnvironments/common/externalDependencies';
import { getExtension } from '../common/vscodeApis/extensionsApi';
import { PythonExtension } from '../api/types';
import { PVSC_EXTENSION_ID } from '../common/constants';
import { getConfiguration, getWorkspaceFolder, getWorkspaceFolders } from '../common/vscodeApis/workspaceApis';
import { CreateEnv } from '../common/utils/localize';
import { CONDA_PROVIDER_ID } from '../pythonEnvironments/creation/provider/condaCreationProvider';
import { VenvCreationProviderId } from '../pythonEnvironments/creation/provider/venvCreationProvider';
import { UV_PROVIDER_ID } from '../pythonEnvironments/creation/provider/uvCreationProvider';
import { traceInfo, traceVerbose } from '../logging';

const ENVIRONMENT_PROVIDERS_ENABLED_KEY = 'environmentProviders.enabled';
const DEPRECATED_ENVIRONMENT_PROVIDERS_ENABLE_KEY = 'environmentProviders.enable';

/**
 * A simplified version of an environment provider that can be used in the Positron New Folder Flow
 */
interface FlowEnvironmentProviders {
    id: string;
    name: string;
    description: string;
}

/**
 * Result of creating a Python environment and registering it with the language runtime manager.
 */
type CreateEnvironmentAndRegisterResult = CreateEnvironmentResult & { metadata?: positron.LanguageRuntimeMetadata };

/**
 * JSON-safe options for the `python.createEnvironmentAndRegister` command. Mirrors
 * `CreateEnvironmentOptions & CreateEnvironmentOptionsInternal`, but `workspaceFolder` is a URI
 * string instead of a `WorkspaceFolder` object, so callers can pass this across a command
 * boundary (e.g. embedded in `fix.args`) without needing to serialize a `WorkspaceFolder`.
 */
export interface CreateEnvironmentAndRegisterOptions
    extends Omit<CreateEnvironmentOptions & CreateEnvironmentOptionsInternal, 'workspaceFolder'> {
    workspaceFolder?: string;
    /**
     * Set when the caller will start a session for the new environment itself (the New Folder
     * flow). The new-environment prompt is then suppressed, not delayed, from creation until that
     * session starts, or for at most `SESSION_START_HOLD_MS`. A watcher event that arrives in that
     * window is dropped, so if no session starts (e.g. Manual startup), no prompt appears.
     */
    sessionWillStart?: boolean;
}

/**
 * The longest time `createEnvironmentAndRegister` keeps the new-environment prompt quiet while
 * it waits for the caller to start a session (`sessionWillStart`). It covers a session that
 * never starts, such as with Manual startup.
 */
export const SESSION_START_HOLD_MS = 60_000;

/**
 * Rehydrates a workspace folder URI string into a `WorkspaceFolder`.
 *
 * The URI string is produced by the workbench/main thread, but this extension host
 * may represent the same folder under a different URI scheme -- e.g. the main
 * thread's `vscode-remote://` vs. a remote extension host's `file://`. An
 * exact-URI lookup therefore misses even when the folder is registered, so fall
 * back to matching by path before giving up.
 * @param workspaceFolderUri The URI string of the workspace folder, or undefined.
 * @returns The corresponding `WorkspaceFolder`, or undefined if no URI was given.
 */
function rehydrateWorkspaceFolder(workspaceFolderUri: string | undefined): WorkspaceFolder | undefined {
    if (!workspaceFolderUri) {
        return undefined;
    }
    const targetUri = Uri.parse(workspaceFolderUri);
    const folder =
        getWorkspaceFolder(targetUri) ?? (getWorkspaceFolders() ?? []).find((f) => f.uri.path === targetUri.path);
    if (!folder) {
        throw new Error(`Workspace folder not found for URI: ${workspaceFolderUri}`);
    }
    return folder;
}

/**
 * Get the list of providers that can be used in the Positron New Folder Flow
 * @param providers The available environment creation providers
 * @returns A list of providers that can be used in the Positron New Folder Flow
 */
export async function getCreateEnvironmentProviders(
    providers: readonly CreateEnvironmentProvider[],
): Promise<FlowEnvironmentProviders[]> {
    return providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        description: provider.description,
    }));
}

/**
 * Create an environment and register it with the Python runtime manager
 * @param providers The available environment creation providers
 * @param pythonRuntimeManager The manager for the Python runtimes
 * @param options Options for creating the environment
 * @returns The result of creating the environment and registering it, including the metadata for the environment
 */
export async function createEnvironmentAndRegister(
    providers: readonly CreateEnvironmentProvider[],
    pythonRuntimeManager: IPythonRuntimeManager,
    options: CreateEnvironmentAndRegisterOptions,
): Promise<CreateEnvironmentAndRegisterResult | undefined> {
    if (!options.providerId || (!options.interpreterPath && !options.condaPythonVersion && !options.uvPythonVersion)) {
        throw new Error(
            'Missing required options for creating an environment. Please specify a provider ID and a Python interpreter path or a Conda or uv Python version.',
        );
    }
    const workspaceFolder = rehydrateWorkspaceFolder(options.workspaceFolder);
    // Every provider creates the environment inside a workspace folder. With none passed and none
    // open, the interactive flow blocks on a notification until the user opens one, so a non-
    // interactive caller (e.g. the assistant) hangs. Reject up front instead.
    if (!workspaceFolder && (getWorkspaceFolders() ?? []).length === 0) {
        throw new Error(CreateEnv.noWorkspace);
    }
    const { sessionWillStart, ...providerOptions } = options;
    const resolvedOptions: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal = {
        ...providerOptions,
        workspaceFolder,
    };
    if (!sessionWillStart) {
        return createAndRegister(providers, pythonRuntimeManager, resolvedOptions);
    }

    // Raise the hold before creating, so the watcher event for the new interpreter cannot show the
    // prompt, and keep it up after returning: the caller starts the session only once this
    // command resolves (#16584).
    let endHold!: () => void;
    const held = new Promise<void>((resolve) => {
        endHold = resolve;
    });
    void holdCreatingEnvironment(() => held);
    let result: CreateEnvironmentAndRegisterResult | undefined;
    try {
        result = await createAndRegister(providers, pythonRuntimeManager, resolvedOptions);
    } catch (ex) {
        endHold();
        throw ex;
    }
    if (!result?.path) {
        endHold();
        return result;
    }
    const pythonPaths = [result.path];
    const registeredPath = (result.metadata?.extraRuntimeData as PythonRuntimeExtraData | undefined)?.pythonPath;
    if (registeredPath) {
        pythonPaths.push(registeredPath);
    }
    void waitForSessionStart(pythonRuntimeManager, pythonPaths, SESSION_START_HOLD_MS).then(endHold);
    return result;
}

/**
 * Creates an environment with the given options and registers it with the Python runtime manager.
 */
async function createAndRegister(
    providers: readonly CreateEnvironmentProvider[],
    pythonRuntimeManager: IPythonRuntimeManager,
    options: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal,
): Promise<CreateEnvironmentAndRegisterResult | undefined> {
    const result = await handleCreateEnvironmentCommand(providers, options);
    if (result?.path) {
        const metadata = await pythonRuntimeManager.registerLanguageRuntimeFromPath(result.path);
        return { ...result, metadata };
    }
    return result;
}

/**
 * Resolves when a session for one of the given interpreter paths leaves the Uninitialized state,
 * or after `timeoutMs`. A session only counts as running once it leaves Uninitialized, so
 * resolving when it is created would leave a gap for the new-environment prompt.
 */
function waitForSessionStart(
    pythonRuntimeManager: IPythonRuntimeManager,
    pythonPaths: string[],
    timeoutMs: number,
): Promise<void> {
    return new Promise<void>((resolve) => {
        const disposables: Disposable[] = [];
        const done = () => {
            disposables.forEach((d) => d.dispose());
            resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        disposables.push({ dispose: () => clearTimeout(timer) });
        disposables.push(
            pythonRuntimeManager.onDidCreateSession((session) => {
                const extraData = session.runtimeMetadata.extraRuntimeData as PythonRuntimeExtraData;
                if (!pythonPaths.some((p) => arePathsSame(p, extraData.pythonPath))) {
                    return;
                }
                if (session.getRuntimeState() !== positron.RuntimeState.Uninitialized) {
                    done();
                    return;
                }
                disposables.push(
                    session.onDidChangeRuntimeState((state) => {
                        if (state !== positron.RuntimeState.Uninitialized) {
                            done();
                        }
                    }),
                );
            }),
        );
    });
}

/**
 * Checks if the given interpreter is a global python installation.
 * @param interpreterPath The interpreter path to check.
 * @returns True if the interpreter is a global python installation, false if it is not, and
 * undefined if the check could not be performed.
 * Implementation is based on isGlobalPythonSelected in extensions/positron-python/src/client/pythonEnvironments/creation/common/createEnvTriggerUtils.ts
 */
export async function isGlobalPython(interpreterPath: string): Promise<boolean | undefined> {
    const extension = getExtension<PythonExtension>(PVSC_EXTENSION_ID);
    if (!extension) {
        return undefined;
    }
    const extensionApi: PythonExtension = extension.exports as PythonExtension;
    const interpreterDetails = await extensionApi.environments.resolveEnvironment(interpreterPath);

    // If we can't resolve the interpreter details, we can't determine if it's a global python installation
    if (!interpreterDetails) {
        return undefined;
    }

    // If the interpreter is not in a virtual environment, it is a global python installation
    if (interpreterDetails.environment === undefined) {
        return true;
    }

    // If the interpreter is in a virtual environment, but was installed via Pyenv, it is a global python installation
    if (interpreterDetails.tools.includes('Pyenv')) {
        return true;
    }

    return false;
}

/**
 * A mapping from the environment provider names to their IDs.
 * The provider names are used in the settings, while the IDs are used in the code.
 */
enum EnvProviderToProviderId {
    'Venv' = VenvCreationProviderId,
    'Conda' = CONDA_PROVIDER_ID,
    'uv' = UV_PROVIDER_ID,
}

interface ConfigurationInspection<T> {
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
}

function isConfigurationSet<T>(inspection: ConfigurationInspection<T> | undefined): boolean {
    return (
        inspection?.globalValue !== undefined ||
        inspection?.workspaceValue !== undefined ||
        inspection?.workspaceFolderValue !== undefined
    );
}

function getEnvProviderConfig(): Record<string, boolean> | undefined {
    const config = getConfiguration('python');
    for (const key of [ENVIRONMENT_PROVIDERS_ENABLED_KEY, DEPRECATED_ENVIRONMENT_PROVIDERS_ENABLE_KEY]) {
        if (isConfigurationSet(config.inspect<Record<string, boolean>>(key))) {
            return config.get<Record<string, boolean>>(key);
        }
    }
    return undefined;
}

/**
 * Retrieves the list of enabled Python environment providers.
 * @returns The list of enabled Python environment provider IDs.
 */
function getEnabledEnvProviderIds(): string[] {
    const envProviderConfig = getEnvProviderConfig();
    if (!envProviderConfig) {
        // If the config hasn't been set, return the default providers
        traceInfo('[getEnabledEnvProviderIds] No environment provider settings configured. Using default providers.');
        return [VenvCreationProviderId, CONDA_PROVIDER_ID, UV_PROVIDER_ID];
    }
    const enabledProviderIds = Object.entries(envProviderConfig)
        // filter to include only enabled providers that are supported
        .filter(([providerName, isEnabled]) => {
            const includeProvider = isEnabled && Object.keys(EnvProviderToProviderId).includes(providerName);
            if (!includeProvider) {
                traceVerbose(`[getEnabledEnvProviderIds] Filtering out provider ${providerName}`);
            }
            return includeProvider;
        })
        // map the provider names to provider IDs
        .map(([providerName]) => EnvProviderToProviderId[providerName as keyof typeof EnvProviderToProviderId]);
    traceVerbose(`[getEnabledEnvProviderIds] Enabled environment providers: ${enabledProviderIds}`);
    return enabledProviderIds;
}

/**
 * Checks if the given provider is enabled.
 * @param providerId The ID of the provider to check
 * @returns Whether the given provider is enabled
 */
export function isEnvProviderEnabled(providerId: string): boolean {
    const enabledProviders = getEnabledEnvProviderIds();
    return enabledProviders.includes(providerId);
}
