/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
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
import { PositronRunApp, RunAppTerminalOptions } from '../positron-run-app.d';

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
            vscode.commands.registerCommand('python.runShinyApp', async () => {
                const runAppApi = await getPositronRunAppApi();
                await runAppApi.runApplication({
                    name: 'Shiny',
                    getTerminalOptions(runtime, document, port, _urlPrefix) {
                        const args = [runtime.runtimePath, '-m', 'shiny', 'run', '--reload'];
                        if (port) {
                            args.push('--port', port);
                        }
                        args.push(document.uri.fsPath);
                        return { commandLine: args.join(' ') };
                    },
                });
            }),

            vscode.commands.registerCommand('python.runStreamlitApp', async () => {
                const runAppApi = await getPositronRunAppApi();
                await runAppApi.runApplication({
                    name: 'Streamlit',
                    getTerminalOptions(runtime, document, port, _urlPrefix) {
                        const args = [
                            runtime.runtimePath,
                            '-m',
                            'streamlit',
                            'run',
                            document.uri.fsPath,
                            // Enable headless mode to avoid opening a browser window since it
                            // will already be previewed in the viewer pane.
                            '--server.headless',
                            'true',
                        ];
                        if (port) {
                            args.push('--port', port);
                        }
                        return { commandLine: args.join(' ') };
                    },
                });
            }),

            vscode.commands.registerCommand('python.runDashApp', async () => {
                const runAppApi = await getPositronRunAppApi();
                await runAppApi.runApplication({
                    name: 'Dash',
                    getTerminalOptions(runtime, document, port, urlPrefix) {
                        const env: RunAppTerminalOptions['env'] = {};
                        if (port) {
                            env.DASH_PORT = port;
                        }
                        if (urlPrefix) {
                            env.DASH_URL_PREFIX = urlPrefix;
                        }
                        return {
                            commandLine: [runtime.runtimePath, document.uri.fsPath].join(' '),
                            env,
                        };
                    },
                });
            }),

            vscode.commands.registerCommand('python.runGradioApp', async () => {
                const runAppApi = await getPositronRunAppApi();
                await runAppApi.runApplication({
                    name: 'Gradio',
                    getTerminalOptions(runtime, document, port, urlPrefix) {
                        const env: RunAppTerminalOptions['env'] = {};
                        if (port) {
                            env.GRADIO_SERVER_PORT = port;
                        }
                        if (urlPrefix) {
                            env.GRADIO_ROOT_PATH = urlPrefix;
                        }
                        return {
                            commandLine: [runtime.runtimePath, document.uri.fsPath].join(' '),
                            env,
                        };
                    },
                });
            }),

            vscode.commands.registerCommand('python.runFastAPIApp', async () => {
                const runAppApi = await getPositronRunAppApi();
                await runAppApi.runApplication({
                    name: 'FastAPI',
                    async getTerminalOptions(runtime, document, port, urlPrefix) {
                        const appName = await getAppName(document, 'FastAPI');
                        if (!appName) {
                            return undefined;
                        }
                        const args = [
                            runtime.runtimePath,
                            '-m',
                            'uvicorn',
                            `${pathToModule(document.uri.fsPath)}:${appName}`,
                        ];
                        if (port) {
                            args.push('--port', port);
                        }
                        if (urlPrefix) {
                            args.push('--root-path', urlPrefix);
                        }
                        return { commandLine: args.join(' ') };
                    },
                    urlPath: '/docs',
                });
            }),

            vscode.commands.registerCommand('python.runFlaskApp', async () => {
                const runAppApi = await getPositronRunAppApi();
                await runAppApi.runApplication({
                    name: 'Flask',
                    async getTerminalOptions(runtime, document, port, urlPrefix) {
                        const appName = await getAppName(document, 'Flask');
                        if (!appName) {
                            return undefined;
                        }
                        const env: RunAppTerminalOptions['env'] = {};
                        if (port) {
                            env.SCRIPT_NAME = urlPrefix;
                        }
                        return {
                            commandLine: [
                                runtime.runtimePath,
                                '-m',
                                'flask',
                                '--app',
                                `${pathToModule(document.uri.fsPath)}:${appName}`,
                                'run',
                            ].join(' '),
                            env,
                        };
                    },
                });
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

async function getAppName(document: vscode.TextDocument, className: string): Promise<string | undefined> {
    const text = document.getText();
    let appName = text.match(new RegExp(`([^\\s]+)\\s*=\\s*${className}\\(`))?.[1];
    if (!appName) {
        appName = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter the name of the {0} application object', className),
            validateInput(value) {
                if (!value.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
                    return vscode.l10n.t('Invalid {0} app object name.', className);
                }
                return undefined;
            },
        });
        if (!appName) {
            vscode.window.showErrorMessage(vscode.l10n.t('No {0} application object name provided.', className));
            return undefined;
        }
    }
    return appName;
}

async function getPositronRunAppApi(): Promise<PositronRunApp> {
    const runAppExt = vscode.extensions.getExtension<PositronRunApp>('vscode.positron-run-app');
    if (!runAppExt) {
        throw new Error('vscode.positron-run-app extension not found');
    }
    const runAppApi = await runAppExt.activate();
    return runAppApi;
}
