/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
import { createPythonRuntimeMetadata } from './runtime';
import { comparePythonVersionDescending } from '../interpreter/configuration/environmentTypeComparer';
import { MINIMUM_PYTHON_VERSION } from '../common/constants';

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
        let recommendedInterpreter = interpreterSelector.getRecommendedSuggestion(
            suggestions,
            workspaceUri,
        )?.interpreter;
        if (!recommendedInterpreter) {
            // fallback to active interpreter if we don't have a recommended interpreter
            recommendedInterpreter = await interpreterService.getActiveInterpreter(workspaceUri);
        }
        traceInfo(`pythonRuntimeDiscoverer: recommended interpreter: ${recommendedInterpreter?.path}`);

        // Discover Python interpreters
        let interpreters = interpreterService.getInterpreters();
        // Sort the available interpreters, favoring the recommended interpreter (if one is available)
        traceInfo('pythonRuntimeDiscoverer: sorting interpreters');
        interpreters = sortInterpreters(interpreters, recommendedInterpreter);

        traceInfo(`pythonRuntimeDiscoverer: discovered ${interpreters.length} Python interpreters`);

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
                if (isVersionSupported(interpreter?.version, MINIMUM_PYTHON_VERSION)) {
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
                } else {
                    traceInfo(`pythonRuntimeDiscoverer: skipping unsupported interpreter ${interpreter.path}`);
                }
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
