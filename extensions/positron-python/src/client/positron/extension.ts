/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IDisposableRegistry, IInstaller, InstallerResponse, Product } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo } from '../logging';
import { MINIMUM_PYTHON_VERSION, Commands } from '../common/constants';
import { getIpykernelBundle } from './ipykernel';
import { InstallOptions } from '../common/installer/types';
import { activateAppDetection as activateWebAppDetection } from './webAppContexts';
import { activateWebAppCommands } from './webAppCommands';
import { activateWalkthroughCommands } from './walkthroughCommands';
import { printInterpreterDebugInfo } from './interpreterSettings';
import { registerLanguageServerManager } from './languageServerManager';
import { registerPythonFilePasteProvider } from '../languageFeatures/pythonFilePasteProvider.js';

export async function activatePositron(serviceContainer: IServiceContainer): Promise<void> {
    try {
        const disposables = serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        // Register a command to check if ipykernel is bundled for a given interpreter.
        disposables.push(
            vscode.commands.registerCommand('python.isIpykernelBundled', async (pythonPath: string) => {
                const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getInterpreterDetails(pythonPath);
                if (interpreter) {
                    const bundle = await getIpykernelBundle(interpreter, serviceContainer);
                    return bundle.disabledReason === undefined;
                }
                traceError(
                    `Could not check if ipykernel is installed due to an invalid interpreter path: ${pythonPath}`,
                );
                return false;
            }),
        );
        // Register a command to install ipykernel for a given interpreter.
        disposables.push(
            vscode.commands.registerCommand('python.installIpykernel', async (pythonPath: string) => {
                const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getInterpreterDetails(pythonPath);
                if (interpreter) {
                    const installer = serviceContainer.get<IInstaller>(IInstaller);
                    // Check if ipykernel is bundled for the interpreter before trying to install.
                    const bundle = await getIpykernelBundle(interpreter, serviceContainer);
                    if (bundle.disabledReason !== undefined) {
                        // Using a process to install modules avoids using the terminal service,
                        // which has issues waiting for the outcome of the install.
                        const installOptions: InstallOptions = { installAsProcess: true };
                        const installResult = await installer.install(
                            Product.ipykernel,
                            interpreter,
                            undefined,
                            undefined,
                            installOptions,
                        );
                        if (installResult !== InstallerResponse.Installed) {
                            traceError(
                                `Could not install ipykernel for interpreter: ${pythonPath}. Install result - ${installResult}`,
                            );
                        }
                    } else {
                        traceInfo(`Already bundling ipykernel for interpreter ${pythonPath}. No need to install it.`);
                    }
                } else {
                    traceError(`Could not install ipykernel due to an invalid interpreter path: ${pythonPath}`);
                }
            }),
        );
        // Register a command to get the minimum version of python supported by the extension.
        disposables.push(
            vscode.commands.registerCommand('python.getMinimumPythonVersion', (): string => MINIMUM_PYTHON_VERSION.raw),
        );
        // Register a command to output information about Python environments.
        disposables.push(
            vscode.commands.registerCommand(Commands.Show_Interpreter_Debug_Info, async () => {
                // Open up the Python Language Pack output channel.
                await vscode.commands.executeCommand(Commands.ViewOutput);

                // Log information about the Python environments.
                const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreters = interpreterService.getInterpreters();
                printInterpreterDebugInfo(interpreters);
            }),
        );

        // Activate detection for web applications
        activateWebAppDetection(disposables);

        // Activate web application commands.
        activateWebAppCommands(serviceContainer, disposables);

        // Activate walkthrough commands.
        activateWalkthroughCommands(disposables);

        // Register the language server manager to support multiple console sessions.
        registerLanguageServerManager(serviceContainer, disposables);

        // Register Python file paste provider.
        registerPythonFilePasteProvider(disposables);

        traceInfo('activatePositron: done!');
    } catch (ex) {
        traceError('activatePositron() failed.', ex);
    }
}
