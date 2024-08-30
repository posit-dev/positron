/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CreateEnvironmentOptionsInternal } from '../pythonEnvironments/creation/types';
import {
    CreateEnvironmentAndRegisterResult,
    CreateEnvironmentOptions,
    CreateEnvironmentProvider,
} from '../pythonEnvironments/creation/proposed.createEnvApis';
import { handleCreateEnvironmentCommand } from '../pythonEnvironments/creation/createEnvironment';
import { IPythonRuntimeManager } from './manager';

/**
 * A simplified version of an environment provider that can be used in the Positron Project Wizard
 */
interface WizardEnvironmentProviders {
    id: string;
    name: string;
    description: string;
}

/**
 * Get the list of providers that can be used in the Positron Project Wizard
 * @param providers The available environment creation providers
 * @returns A list of providers that can be used in the Positron Project Wizard
 */
export async function getCreateEnvironmentProviders(
    providers: readonly CreateEnvironmentProvider[],
): Promise<WizardEnvironmentProviders[]> {
    const providersForWizard = providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        description: provider.description,
    }));
    return providersForWizard;
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
    if (!options.providerId || (!options.interpreterPath && !options.condaPythonVersion)) {
        return {
            error: new Error(
                'Missing required options for creating an environment. Please specify a provider ID and a Python interpreter path or a Conda Python version.',
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
