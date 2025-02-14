/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo, traceVerbose } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
import { createPythonRuntimeMetadata } from './runtime';
import { comparePythonVersionDescending } from '../interpreter/configuration/environmentTypeComparer';
import { MINIMUM_PYTHON_VERSION } from '../common/constants';
import { arePathsSame, isParentPath } from '../pythonEnvironments/common/externalDependencies';
import { getUserExcludedInterpreters, getUserIncludedInterpreters } from './interpreterSettings';

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
        const interpreterSelector = serviceContainer.get<IInterpreterSelector>(IInterpreterSelector);

        // Get the recommended interpreter
        // NOTE: We may need to pass a resource to getSettings to support multi-root workspaces
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        const suggestions = interpreterSelector.getSuggestions(workspaceUri);
        let recommendedInterpreter = interpreterSelector.getRecommendedSuggestion(suggestions, workspaceUri)
            ?.interpreter;
        if (!recommendedInterpreter) {
            // fallback to active interpreter if we don't have a recommended interpreter
            recommendedInterpreter = await interpreterService.getActiveInterpreter(workspaceUri);
        }
        traceInfo(`pythonRuntimeDiscoverer: recommended interpreter: ${recommendedInterpreter?.path}`);

        // Discover Python interpreters
        let interpreters = interpreterService.getInterpreters();

        traceInfo(`pythonRuntimeDiscoverer: discovered ${interpreters.length} Python interpreters`);

        // Filter out unsupported and user-excluded interpreters
        traceInfo('pythonRuntimeDiscoverer: filtering interpreters');
        interpreters = filterInterpreters(interpreters);

        // TODO: the filtering is working, but the UI is populated with the excluded interpreters before// --- Start Positron ---
        // separately from this list. Need to find the right place to filter them out.
        // --- End Positron ---
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
 * Check if a version is supported (i.e. >= the minimum supported version).
 * Also returns true if the version could not be determined.
 */
function isVersionSupported(version: PythonVersion | undefined, minimumSupportedVersion: PythonVersion): boolean {
    return !version || comparePythonVersionDescending(minimumSupportedVersion, version) >= 0;
}

/**
 * Check whether an interpreter should be included in the list of discovered interpreters.
 * If an interpreter is both explicitly included and excluded, it will be included.
 * @param interpreterPath The interpreter path to check
 * @returns Whether the interpreter should be included in the list of discovered interpreters.
 */
function shouldIncludeInterpreter(interpreterPath: string): boolean {
    // If a user has explicitly included the interpreter, include it. In other words, including an
    // interpreter takes precedence over excluding it.
    const interpretersInclude = getUserIncludedInterpreters();
    if (interpretersInclude.length > 0) {
        const userIncluded = interpretersInclude.some(
            (includePath) => isParentPath(interpreterPath, includePath) || arePathsSame(interpreterPath, includePath),
        );
        if (userIncluded) {
            traceVerbose(`[shouldIncludeInterpreter] Interpreter ${interpreterPath} was included via settings`);
            return true;
        }
    }

    // If the user has not explicitly included the interpreter, check if it is explicitly excluded.
    const interpretersExclude = getUserExcludedInterpreters();
    const userExcluded = interpretersExclude.some(
        (excludePath) => isParentPath(interpreterPath, excludePath) || arePathsSame(interpreterPath, excludePath),
    );
    if (userExcluded) {
        traceVerbose(`[shouldIncludeInterpreter] Interpreter ${interpreterPath} was excluded via settings`);
        return false;
    }

    // If the interpreter is not explicitly included or excluded, include it.
    traceVerbose(`[shouldIncludeInterpreter] Interpreter ${interpreterPath} not explicitly included or excluded`);
    return true;
}
