/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { PythonExtension } from '../api/types';
import { IDisposableRegistry } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { createPythonRuntime, pythonRuntimeProvider } from './provider';

export async function activatePositron(
    activatedPromise: Promise<void>,
    pythonApi: PythonExtension,
    serviceContainer: IServiceContainer,
): Promise<void> {
    try {
        // Map of interpreter path to language runtime metadata, used to determine the runtimeId when
        // switching the active interpreter path.
        const runtimes = new Map<string, positron.LanguageRuntimeMetadata>();

        // Register the Python language runtime provider with positron.
        traceInfo('activatePositron: registering python runtime provider');
        positron.runtime.registerLanguageRuntimeProvider(
            'python',
            pythonRuntimeProvider(serviceContainer, runtimes, activatedPromise),
        );

        // Wait for all extension components to be activated before registering event listeners
        traceInfo('activatePositron: awaiting extension activation');
        await activatedPromise;

        // If the interpreter is changed via the Python extension, select the corresponding
        // language runtime in Positron.
        const disposables = serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        disposables.push(
            pythonApi.environments.onDidChangeActiveEnvironmentPath(async (event) => {
                // Select the new runtime.
                const runtimeMetadata = runtimes.get(event.path);
                if (runtimeMetadata) {
                    positron.runtime.selectLanguageRuntime(runtimeMetadata.runtimeId);
                } else {
                    throw Error(`Tried to switch to a language runtime that has not been registered: ${event.path}`);
                }
            }),
        );

        // If a new interpreter is added via the Python extension, create and register a
        // corresponding language runtime.
        disposables.push(
            pythonApi.environments.onDidChangeEnvironments(async (event) => {
                if (event.type === 'add') {
                    const interpreterPath = event.env.path;
                    if (!runtimes.has(interpreterPath)) {
                        // Get the interpreter corresponding to the new runtime.
                        const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                        const interpreter = await interpreterService.getInterpreterDetails(interpreterPath);

                        // Create the runtime and register it with Positron.
                        if (interpreter) {
                            // Set recommendedForWorkspace to false, since we change the active runtime
                            // in the onDidChangeActiveEnvironmentPath listener.
                            const runtime = await createPythonRuntime(interpreter, serviceContainer, false);
                            const runtimeMetadata = runtime.metadata;
                            disposables.push(positron.runtime.registerLanguageRuntime(runtime));
                            runtimes.set(interpreterPath, runtimeMetadata);
                        }
                    }
                }
            }),
        );

        traceInfo('activatePositron: done!');
    } catch (ex) {
        traceError('activatePositron() failed.', ex);
    }
}
