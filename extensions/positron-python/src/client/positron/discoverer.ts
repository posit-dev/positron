/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

import { IInterpreterComparer, IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { createPythonRuntimeMetadata } from './runtime';
import { comparePythonVersionDescending } from '../interpreter/configuration/environmentTypeComparer';
import { MINIMUM_PYTHON_VERSION } from '../common/constants';
import { isVersionSupported, shouldIncludeInterpreter } from './interpreterSettings';
import { getUserDefaultInterpreter } from './util';

/**
 * Provides Python language runtime metadata to Positron; called during the
 * discovery phase of startup.
 *
 * @param serviceContainer The Python extension's service container to use for
 * dependency injection.
 *
 * @returns An async generator that yields Python language runtime metadata.
 */
export async function* pythonRuntimeDiscoverer(
    serviceContainer: IServiceContainer,
): AsyncGenerator<positron.LanguageRuntimeMetadata> {
    try {
        traceInfo('pythonRuntimeDiscoverer: Starting Python runtime discoverer');
        const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);

        // Discover Python interpreters
        let interpreters = interpreterService.getInterpreters();
        const recommendedInterpreter = await recommendInterpreter(serviceContainer, interpreters);

        traceInfo(`pythonRuntimeDiscoverer: discovered ${interpreters.length} Python interpreters`);

        // Filter out unsupported and user-excluded interpreters
        traceInfo('pythonRuntimeDiscoverer: filtering interpreters');
        interpreters = filterInterpreters(interpreters);

        traceInfo(`pythonRuntimeDiscoverer: ${interpreters.length} Python interpreters remain after filtering`);

        // Sort the available interpreters, favoring the recommended interpreter (if one is available)
        traceInfo('pythonRuntimeDiscoverer: sorting interpreters');
        interpreters = sortInterpreters(interpreters, recommendedInterpreter);

        // Recommend Python for the workspace if it contains Python-relevant files
        let recommendedForWorkspace = await hasFiles([
            // Code and notebook files
            '**/*.py',
            '**/*.ipynb',
            // Virtual environment folders
            '.venv/**/*',
            '.conda/**/*',
            // Config files
            'pyproject.toml',
            'Pipfile',
            '*requirements.txt',
            '.python-version',
            'environment.yml',
        ]);
        traceInfo(`pythonRuntimeDiscoverer: recommended for workspace: ${recommendedForWorkspace}`);

        // Register each interpreter as a language runtime metadata entry
        for (const interpreter of interpreters) {
            try {
                const runtime = await createPythonRuntimeMetadata(
                    interpreter,
                    serviceContainer,
                    recommendedForWorkspace,
                );

                // Ensure we only recommend one runtime for the workspace.
                recommendedForWorkspace = false;

                traceInfo(
                    `pythonRuntimeDiscoverer: registering runtime for interpreter ${interpreter.path} with id ${runtime.runtimeId}`,
                );
                yield runtime;
            } catch (err) {
                traceError(
                    `pythonRuntimeDiscoverer: failed to register runtime for interpreter ${interpreter.path}`,
                    err,
                );
            }
        }
    } catch (ex) {
        traceError('pythonRuntimeDiscoverer() failed', ex);
    }
}

/**
 * Returns a list of Python interpreters with unsupported and user-excluded interpreters removed.
 * @param interpreters The list of Python interpreters to filter.
 * @returns A list of Python interpreters that are supported and not user-excluded.
 */
function filterInterpreters(interpreters: PythonEnvironment[]): PythonEnvironment[] {
    return interpreters.filter((interpreter) => {
        // Check if the interpreter version is supported
        const isSupported = isVersionSupported(interpreter.version, MINIMUM_PYTHON_VERSION);
        if (!isSupported) {
            traceInfo(`pythonRuntimeDiscoverer: filtering out unsupported interpreter ${interpreter.path}`);
            return false;
        }

        // Check if the interpreter is excluded by the user
        const shouldInclude = shouldIncludeInterpreter(interpreter.path);
        if (!shouldInclude) {
            traceInfo(`pythonRuntimeDiscoverer: filtering out user-excluded interpreter ${interpreter.path}`);
            return false;
        }

        // Otherwise, keep the interpreter!
        return true;
    });
}

// Returns a sorted copy of the array of Python environments, in descending order
function sortInterpreters(
    interpreters: PythonEnvironment[],
    preferredInterpreter: PythonEnvironment | undefined,
): PythonEnvironment[] {
    const copy: PythonEnvironment[] = [...interpreters];
    copy.sort((a: PythonEnvironment, b: PythonEnvironment) => {
        // Favor preferred interpreter, if specified, in descending order
        if (preferredInterpreter) {
            if (preferredInterpreter.id === a.id) return -1;
            if (preferredInterpreter.id === b.id) return 1;
        }

        // Compare versions in descending order
        return comparePythonVersionDescending(a.version, b.version);
    });
    return copy;
}

// Check if the current workspace contains files matching any of the passed glob ptaterns
async function hasFiles(includes: string[]): Promise<boolean> {
    // Create a single glob pattern e.g. ['a', 'b'] => '{a,b}'
    const include = `{${includes.join(',')}}`;
    // Exclude node_modules for performance reasons
    return (await vscode.workspace.findFiles(include, '**/node_modules/**', 1)).length > 0;
}

/**
 * Recommends a Python interpreter based on workspace configuration and available suggestions.
 *
 * The function follows this priority order:
 * 1. If no workspace and default interpreter is set, use the default interpreter
 * 2. Use the recommended interpreter from suggestions
 * 3. Fall back to the active interpreter
 *
 * @param serviceContainer - Container providing access to interpreter services
 * @returns Promise resolving to a recommended Python environment or undefined if none found
 *
 */
export async function recommendInterpreter(
    serviceContainer: IServiceContainer,
    interpreters: PythonEnvironment[],
): Promise<PythonEnvironment | undefined> {
    const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
    const interpreterComparer = serviceContainer.get<IInterpreterComparer>(IInterpreterComparer);

    // Get the recommended interpreter
    // NOTE: We may need to pass a resource to getSettings to support multi-root workspaces
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;

    let recommendedInterpreter: PythonEnvironment | undefined;

    // if there is no workspace and a default interpreter is set, use that
    if (!workspaceUri && getUserDefaultInterpreter()) {
        recommendedInterpreter = await interpreterService.getInterpreterDetails(getUserDefaultInterpreter());
        if (recommendedInterpreter) {
            traceInfo(`pythonRuntimeDiscoverer: using default interpreter ${recommendedInterpreter?.path}`);
            return recommendedInterpreter;
        }
    }

    // if no interpreter found yet, try to get recommended interpreter
    recommendedInterpreter = interpreterComparer.getRecommended(interpreters, workspaceUri);
    if (recommendedInterpreter) {
        traceInfo(`pythonRuntimeDiscoverer: using recommended suggestion ${recommendedInterpreter?.path}`);
        return recommendedInterpreter;
    }

    // if still no interpreter, use the active one
    recommendedInterpreter = await interpreterService.getActiveInterpreter(workspaceUri);
    if (recommendedInterpreter) {
        traceInfo(`pythonRuntimeDiscoverer: falling back to active interpreter ${recommendedInterpreter?.path}`);
        return recommendedInterpreter;
    }

    return recommendedInterpreter;
}
