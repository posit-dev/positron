/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { createPythonRuntimeMetadata } from './runtime';
import { isProblematicCondaEnvironment } from '../interpreter/configuration/environmentTypeComparer';
import { shouldIncludeInterpreter } from './interpreterSettings';

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

        // Ensure PET discovery is complete before reading interpreters. If a
        // refresh is already in progress (started during extension
        // initialization) triggerRefresh() joins it rather than starting a new
        // one; if no refresh is running (e.g. user-initiated re-discovery)
        // this starts a fresh scan.
        await interpreterService.triggerRefresh().ignoreErrors();

        // Nothing here decides what starts. Every runtime is Explicit; the recommendation
        // (from recommendWorkspaceRuntime) is the only one that auto-starts, and core
        // uses it wherever it needs a Python runtime. The picker
        // sorts by `runtimeSourceOrder`, so the yield order doesn't matter either.
        const interpreters = filterInterpreters(interpreterService.getInterpreters());
        traceInfo(`pythonRuntimeDiscoverer: ${interpreters.length} Python interpreters after filtering`);

        for (const interpreter of interpreters) {
            try {
                // Skip conda environments without Python - they'll be handled by PickerContribution
                if (isProblematicCondaEnvironment(interpreter)) {
                    traceInfo(
                        `pythonRuntimeDiscoverer: skipping conda env without Python (handled by picker): ${interpreter.path}`,
                    );
                    continue;
                }
                // Not the recommendation, so the default `Explicit`.
                const runtime = await createPythonRuntimeMetadata(interpreter, serviceContainer);
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

        // Otherwise, keep the interpreter!
        return true;
    });
}
