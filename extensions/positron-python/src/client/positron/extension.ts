/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { PythonExtension } from '../api/types';
import { IDisposableRegistry } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { PythonRuntimeManager } from './manager';
import { createPythonRuntimeMetadata } from './runtime';
import { provider } from './linkProvider';

export async function activatePositron(
    activatedPromise: Promise<void>,
    pythonApi: PythonExtension,
    serviceContainer: IServiceContainer,
): Promise<void> {
    try {
        traceInfo('activatePositron: creating runtime manager');
        const manager = new PythonRuntimeManager(serviceContainer, pythonApi, activatedPromise);

        // Register the Python runtime discoverer (to find all available runtimes) with positron.
        traceInfo('activatePositron: registering python runtime manager');
        positron.runtime.registerLanguageRuntimeManager(manager);

        // Wait for all extension components to be activated before registering event listeners
        traceInfo('activatePositron: awaiting extension activation');
        await activatedPromise;

        vscode.window.registerTerminalLinkProvider(provider);

        const registerRuntime = async (interpreterPath: string) => {
            if (!manager.registeredPythonRuntimes.has(interpreterPath)) {
                // Get the interpreter corresponding to the new runtime.
                const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getInterpreterDetails(interpreterPath);
                // Create the runtime and register it with Positron.
                if (interpreter) {
                    // Set recommendedForWorkspace to false, since we change the active runtime
                    // in the onDidChangeActiveEnvironmentPath listener.
                    const runtime = await createPythonRuntimeMetadata(interpreter, serviceContainer, false);
                    // Register the runtime with Positron.
                    manager.registerLanguageRuntime(runtime);
                } else {
                    traceError(`Could not register runtime due to an invalid interpreter path: ${interpreterPath}`);
                }
            }
        };
        // If the interpreter is changed via the Python extension, select the corresponding
        // language runtime in Positron.
        const disposables = serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        disposables.push(
            pythonApi.environments.onDidChangeActiveEnvironmentPath(async (event) => {
                // Select the new runtime.
                await registerRuntime(event.path);
                const runtimeMetadata = manager.registeredPythonRuntimes.get(event.path);
                if (runtimeMetadata) {
                    positron.runtime.selectLanguageRuntime(runtimeMetadata.runtimeId);
                } else {
                    traceError(`Tried to switch to a language runtime that has not been registered: ${event.path}`);
                }
            }),
        );
        // If a new runtime is registered via the Python extension, create and register a corresponding language runtime.
        disposables.push(
            pythonApi.environments.onDidChangeEnvironments(async (event) => {
                if (event.type === 'add') {
                    const interpreterPath = event.env.path;
                    await registerRuntime(interpreterPath);
                }
            }),
        );
        traceInfo('activatePositron: done!');
    } catch (ex) {
        traceError('activatePositron() failed.', ex);
    }
}
