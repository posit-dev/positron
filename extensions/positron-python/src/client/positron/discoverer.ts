/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

import { IInterpreterSelector } from '../interpreter/configuration/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { PythonEnvironment, EnvironmentType } from '../pythonEnvironments/info';
import { createPythonRuntimeMetadata } from './runtime';
import { comparePythonVersionDescending } from '../interpreter/configuration/environmentTypeComparer';
import { shouldIncludeInterpreter } from './interpreterSettings';
import { hasFiles } from './util';
import * as fs from 'fs-extra';

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

        // Ensure PET discovery is complete before reading interpreters. If a
        // refresh is already in progress (started during extension
        // initialization) triggerRefresh() joins it rather than starting a new
        // one; if no refresh is running (e.g. user-initiated re-discovery)
        // this starts a fresh scan.
        await interpreterService.triggerRefresh().ignoreErrors();

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

        let interpreters = interpreterService.getInterpreters();

        traceInfo(`pythonRuntimeDiscoverer: discovered ${interpreters.length} Python interpreters`);

        // Log details about conda environments for debugging picker contribution
        const condaEnvs = interpreters.filter((i) => i.envType === EnvironmentType.Conda);
        traceInfo(`pythonRuntimeDiscoverer: found ${condaEnvs.length} conda environments`);
        for (const env of condaEnvs) {
            traceInfo(`  - Conda env: ${env.path}, exists: ${fs.existsSync(env.path)}, envName: ${env.envName}`);
        }

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
                // Skip conda environments without Python - they'll be handled by PickerContribution
                if (interpreter.envType === EnvironmentType.Conda && !fs.existsSync(interpreter.path)) {
                    traceInfo(
                        `pythonRuntimeDiscoverer: skipping runtime registration for conda env without Python: ${interpreter.path}`,
                    );
                    continue;
                }

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
 * Returns a list of Python interpreters with user-excluded interpreters removed.
 * @param interpreters The list of Python interpreters to filter.
 * @returns A list of Python interpreters that are not user-excluded.
 */
function filterInterpreters(interpreters: PythonEnvironment[]): PythonEnvironment[] {
    return interpreters.filter((interpreter) => {
        // Check if the interpreter is excluded by the user
        const shouldInclude = shouldIncludeInterpreter(interpreter.path);
        if (!shouldInclude) {
            traceInfo(`pythonRuntimeDiscoverer: filtering out user-excluded interpreter ${interpreter.path}`);
            return false;
        }

        // Keep conda environments even if Python doesn't exist - they'll be handled by PickerContribution
        // but we need them in the interpreter list for discovery
        if (interpreter.envType === EnvironmentType.Conda && !fs.existsSync(interpreter.path)) {
            traceInfo(
                `pythonRuntimeDiscoverer: found conda env without Python (will be handled by picker contribution): ${interpreter.path}`,
            );
            // Keep it in the list but it will be filtered out of runtime registration
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
