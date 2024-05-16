/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProgressLocation, ProgressOptions } from 'vscode';
import * as fs from 'fs';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { PythonExtension } from '../api/types';
import { IDisposableRegistry, IInstaller, InstallerResponse, Product, ProductInstallStatus } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo, traceLog } from '../logging';
import { PythonRuntimeManager } from './manager';
import { createPythonRuntimeMetadata } from './runtime';
import { IPYKERNEL_VERSION, MINIMUM_PYTHON_VERSION } from '../common/constants';
import { InstallOptions } from '../common/installer/types';
import { EnvironmentType } from '../pythonEnvironments/info';
import { showErrorMessage } from '../common/vscodeApis/windowApis';
import { isProblematicCondaEnvironment } from '../interpreter/configuration/environmentTypeComparer';
import { CreateEnv, Interpreters } from '../common/utils/localize';
import { Commands } from '../common/constants';
import { IApplicationShell } from '../common/application/types';

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
                    await checkAndInstallPython(interpreterPath, serviceContainer);
                    if (!fs.existsSync(interpreterPath)) {
                        showErrorMessage(`${CreateEnv.pathDoesntExist} ${interpreterPath}`);
                    }
                    await registerRuntime(interpreterPath);
                }
            }),
        );
        // Register a command to check if ipykernel is installed for a given interpreter.
        disposables.push(
            vscode.commands.registerCommand('python.isIpykernelInstalled', async (pythonPath: string) => {
                const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getInterpreterDetails(pythonPath);
                if (interpreter) {
                    const installer = serviceContainer.get<IInstaller>(IInstaller);
                    const hasCompatibleKernel = await installer.isProductVersionCompatible(
                        Product.ipykernel,
                        IPYKERNEL_VERSION,
                        interpreter,
                    );
                    return hasCompatibleKernel === ProductInstallStatus.Installed;
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
                    traceError(`Could not install ipykernel due to an invalid interpreter path: ${pythonPath}`);
                }
            }),
        );
        // Register a command to get the minimum version of python supported by the extension.
        disposables.push(
            vscode.commands.registerCommand('python.getMinimumPythonVersion', (): string => MINIMUM_PYTHON_VERSION.raw),
        );
        traceInfo('activatePositron: done!');
    } catch (ex) {
        traceError('activatePositron() failed.', ex);
    }
}

export async function checkAndInstallPython(
    pythonPath: string,
    serviceContainer: IServiceContainer,
): Promise<InstallerResponse> {
    const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
    const interpreter = await interpreterService.getInterpreterDetails(pythonPath);
    if (!interpreter) {
        return InstallerResponse.Ignore;
    }
    if (
        isProblematicCondaEnvironment(interpreter) ||
        (interpreter.id && !fs.existsSync(interpreter.id) && interpreter.envType === EnvironmentType.Conda)
    ) {
        if (interpreter) {
            const installer = serviceContainer.get<IInstaller>(IInstaller);
            const shell = serviceContainer.get<IApplicationShell>(IApplicationShell);
            const progressOptions: ProgressOptions = {
                location: ProgressLocation.Window,
                title: `[${Interpreters.installingPython}](command:${Commands.ViewOutput})`,
            };
            traceLog('Conda envs without Python are known to not work well; fixing conda environment...');
            const promise = installer.install(
                Product.python,
                await interpreterService.getInterpreterDetails(pythonPath),
            );
            shell.withProgress(progressOptions, () => promise);

            // If Python is not installed into the environment, install it.
            if (!(await installer.isInstalled(Product.python))) {
                traceInfo(`Python not able to be installed.`);
                return InstallerResponse.Ignore;
            }
        }
    }
    return InstallerResponse.Installed;
}
