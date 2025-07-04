/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { CreateEnvironmentOptionsInternal } from '../pythonEnvironments/creation/types';
import {
    CreateEnvironmentOptions,
    CreateEnvironmentProvider,
    CreateEnvironmentResult,
} from '../pythonEnvironments/creation/proposed.createEnvApis';
import { handleCreateEnvironmentCommand } from '../pythonEnvironments/creation/createEnvironment';
import { IPythonRuntimeManager } from './manager';
import { getExtension } from '../common/vscodeApis/extensionsApi';
import { PythonExtension } from '../api/types';
import { PVSC_EXTENSION_ID } from '../common/constants';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';
import { CONDA_PROVIDER_ID } from '../pythonEnvironments/creation/provider/condaCreationProvider';
import { VenvCreationProviderId } from '../pythonEnvironments/creation/provider/venvCreationProvider';
import { UV_PROVIDER_ID } from '../pythonEnvironments/creation/provider/uvCreationProvider';
import { traceInfo, traceVerbose } from '../logging';

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
    options: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal,
): Promise<CreateEnvironmentAndRegisterResult | undefined> {
    if (!options.providerId || (!options.interpreterPath && !options.condaPythonVersion && !options.uvPythonVersion)) {
        return {
            error: new Error(
                'Missing required options for creating an environment. Please specify a provider ID and a Python interpreter path or a Conda or uv Python version.',
            ),
        };
    }
    const result = await handleCreateEnvironmentCommand(providers, options);
    if (result?.path) {
        const metadata = await pythonRuntimeManager.registerLanguageRuntimeFromPath(result.path);
        return { ...result, metadata };
    }
    return result;
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

/**
 * Retrieves the list of enabled Python environment providers.
 * @returns The list of enabled Python environment provider IDs.
 */
function getEnabledEnvProviderIds(): string[] {
    const envProviderConfig = getConfiguration('python').get<Record<string, boolean>>('environmentProviders.enable');
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
