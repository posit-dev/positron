/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProgressLocation, ProgressOptions } from 'vscode';
import * as fs from 'fs';
import { IDisposableRegistry, IInstaller, InstallerResponse, Product, ProductInstallStatus } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo, traceLog } from '../logging';
import { IPYKERNEL_VERSION, MINIMUM_PYTHON_VERSION, Commands } from '../common/constants';
import { InstallOptions } from '../common/installer/types';
import { EnvironmentType } from '../pythonEnvironments/info';
import { isProblematicCondaEnvironment } from '../interpreter/configuration/environmentTypeComparer';
import { Interpreters } from '../common/utils/localize';
import { IApplicationShell } from '../common/application/types';
import { activateAppDetection } from './webAppContexts';

export async function activatePositron(
    serviceContainer: IServiceContainer,
    context: vscode.ExtensionContext,
): Promise<void> {
    try {
        const disposables = serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
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

        // Activate detection for web applications
        activateAppDetection(context.subscriptions);

        disposables.push(
            vscode.tasks.registerTaskProvider('streamlit', {
                provideTasks(_token) {
                    const document = vscode.window.activeTextEditor?.document;
                    if (document?.languageId !== 'python') {
                        return;
                    }

                    const path = document.uri.fsPath;
                    console.log('Path:', path);

                    return [
                        new vscode.Task(
                            {
                                type: 'streamlit',
                            },
                            vscode.TaskScope.Workspace,
                            'Run Streamlit app',
                            'streamlit',
                            new vscode.ShellExecution(
                                '${command:python.interpreterPath} -m streamlit run --port ${file}',
                            ),
                            [],
                        ),
                    ];
                },
                resolveTask(_task, _token) {
                    return undefined;
                },
            }),
        );
        // TODO: This should probably live in its own extension, like Shiny.
        // Register a command to run Streamlit.
        // TODO: Could provide a callback that has access to runtimePath, file, port, session URL (?).
        disposables.push(
            positron.applications.registerApplicationRunner('python.streamlit', {
                label: 'Streamlit',
                languageId: 'python',
                getRunOptions(runtimePath, filePath, port) {
                    return {
                        command: [
                            runtimePath,
                            '-m',
                            'streamlit',
                            'run',
                            filePath,
                            '--server.port',
                            port.toString(),
                            '--server.headless',
                            'true',
                        ].join(' '),
                    };
                },
            }),
            positron.applications.registerApplicationRunner('python.dash', {
                label: 'Dash',
                languageId: 'python',
                getRunOptions(runtimePath, filePath, port) {
                    return {
                        command: [runtimePath, filePath].join(' '),
                        env: {
                            PORT: port.toString(),
                        },
                    };
                },
            }),
            positron.applications.registerApplicationRunner('python.gradio', {
                label: 'Gradio',
                languageId: 'python',
                getRunOptions(runtimePath, filePath, port) {
                    return {
                        command: [runtimePath, filePath].join(' '),
                        env: {
                            GRADIO_SERVER_PORT: port.toString(),
                        },
                    };
                },
            }),
            positron.applications.registerApplicationRunner('python.fastapi', {
                label: 'FastAPI',
                languageId: 'python',
                getRunOptions(runtimePath, filePath, port) {
                    return {
                        command: [
                            runtimePath,
                            '-m',
                            'uvicorn',
                            // TODO: How to allow customizing the app name?
                            `${pathToModule(filePath)}:app`,
                            '--port',
                            port.toString(),
                        ].join(' '),
                        url: `http://localhost:${port}/docs`,
                    };
                },
            }),
            positron.applications.registerApplicationRunner('python.flask', {
                label: 'Flask',
                languageId: 'python',
                getRunOptions(runtimePath, filePath, port) {
                    return {
                        command: [
                            runtimePath,
                            '-m',
                            'flask',
                            '--app',
                            // TODO: How to allow customizing the app name?
                            `${pathToModule(filePath)}:app`,
                            'run',
                            '--port',
                            port.toString(),
                        ].join(' '),
                    };
                },
            }),

            vscode.commands.registerCommand('python.runStreamlitApp', async () => {
                await positron.applications.runApplication('python.streamlit');
            }),
            vscode.commands.registerCommand('python.runDashApp', async () => {
                await positron.applications.runApplication('python.dash');
            }),
            vscode.commands.registerCommand('python.runGradioApp', async () => {
                await positron.applications.runApplication('python.gradio');
            }),
            vscode.commands.registerCommand('python.runFastAPIApp', async () => {
                await positron.applications.runApplication('python.fastapi');
            }),
            vscode.commands.registerCommand('python.runFlaskApp', async () => {
                await positron.applications.runApplication('python.flask');
            }),
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

// TODO: Better way?
function pathToModule(p: string): string {
    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspacePath) {
        throw new Error('No workspace path');
    }
    const relativePath = path.relative(workspacePath, p);
    const mod = path.parse(relativePath).name;
    const parts = path.dirname(relativePath).split(path.sep);
    return parts.concat(mod).join('.');
}
