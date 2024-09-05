/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as path from 'path';
import * as net from 'net';
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
import { JupyterAdapterApi } from '../jupyter-adapter.d';

export async function activatePositron(serviceContainer: IServiceContainer): Promise<void> {
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
        // Register application runners.
        disposables.push(
            registerApplicationRunner({
                id: 'python.streamlit',
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
            registerApplicationRunner({
                id: 'python.dash',
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
            registerApplicationRunner({
                id: 'python.gradio',
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
            registerApplicationRunner({
                id: 'python.fastapi',
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
            registerApplicationRunner({
                id: 'python.flask',
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
                await runApplication('python.streamlit');
            }),
            vscode.commands.registerCommand('python.runDashApp', async () => {
                await runApplication('python.dash');
            }),
            vscode.commands.registerCommand('python.runGradioApp', async () => {
                await runApplication('python.gradio');
            }),
            vscode.commands.registerCommand('python.runFastAPIApp', async () => {
                await runApplication('python.fastapi');
            }),
            vscode.commands.registerCommand('python.runFlaskApp', async () => {
                await runApplication('python.flask');
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

interface ApplicationRunOptions {
    command: string;
    env?: { [key: string]: string | null | undefined };
    url?: string;
}

interface ApplicationRunner {
    id: string;
    label: string;
    languageId: string;
    getRunOptions(runtimePath: string, filePath: string, port: number): ApplicationRunOptions;
}

const appRunnersById = new Map<string, ApplicationRunner>();

function registerApplicationRunner(appRunner: ApplicationRunner): vscode.Disposable {
    if (appRunnersById.has(appRunner.id)) {
        throw new Error(`Application runner already registered for id '${appRunner.id}'`);
    }

    appRunnersById.set(appRunner.id, appRunner);

    return {
        dispose() {
            appRunnersById.delete(appRunner.id);
            // TODO: Should this also dispose the appRunner?
        },
    };
}

async function runApplication(id: string): Promise<void> {
    const appRunner = appRunnersById.get(id);
    if (!appRunner) {
        throw new Error(`Application runner not found for id '${id}'`);
    }

    console.log(`Running ${appRunner.label} App...`);

    const filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!filePath) {
        return;
    }
    console.log('Path:', filePath);

    if (vscode.window.activeTextEditor?.document.isDirty) {
        await vscode.window.activeTextEditor.document.save();
    }

    const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
    if (!ext) {
        throw new Error('Jupyter Adapter extension not found');
    }
    if (!ext.isActive) {
        await ext.activate();
    }
    const adapterApi = ext?.exports as JupyterAdapterApi;

    // TODO: Check for a port setting?
    // TODO: Cache used port?
    // TODO: Extract from jupyter-adapter extension
    const port = await adapterApi.findAvailablePort([], 25);
    console.log('Port:', port);

    const oldTerminals = vscode.window.terminals.filter((t) => t.name === appRunner.label);

    const runtime = await positron.runtime.getPreferredRuntime(appRunner.languageId);

    const commandOptions = appRunner.getRunOptions(runtime.runtimePath, filePath, port);

    const terminal = vscode.window.createTerminal({
        name: appRunner.label,
        env: commandOptions.env,
    });
    terminal.show(true);

    const closingTerminals = oldTerminals.map((x) => {
        const p = new Promise<void>((resolve) => {
            // Resolve when the terminal is closed. We're working hard to be accurate
            // BUT empirically it doesn't seem like the old Shiny processes are
            // actually terminated at the time this promise is resolved, so callers
            // shouldn't assume that.
            const subscription = vscode.window.onDidCloseTerminal((term) => {
                if (term === x) {
                    subscription.dispose();
                    resolve();
                }
            });
        });
        x.dispose();
        return p;
    });
    await Promise.allSettled(closingTerminals);

    // TODO: Escape the command for the terminal.
    // const cmdline = escapeCommandForTerminal(terminal, python, args);
    console.log('Command:', commandOptions.command);
    terminal.sendText(commandOptions.command);

    positron.window.previewUrl(vscode.Uri.parse('about:blank'));

    // TODO: Handle being in workbench.
    const localUri = vscode.Uri.parse(commandOptions.url ?? `http://localhost:${port}`);
    const uri = await vscode.env.asExternalUri(localUri);

    const host = '127.0.0.1';
    const timeout = 1000;
    const maxDate = Date.now() + 10_000;
    while (Date.now() < maxDate) {
        try {
            await new Promise<boolean>((resolve, reject) => {
                const client = new net.Socket();

                client.setTimeout(timeout);
                client.connect(port, host, () => {
                    resolve(true);
                    client.end();
                });

                client.on('timeout', () => {
                    client.destroy();
                    reject(new Error('Timed out'));
                });

                client.on('error', (err) => {
                    reject(err);
                });

                client.on('close', () => {
                    reject(new Error('Connection closed'));
                });
            });
            break;
        } catch (ex) {
            console.log('Waiting for Streamlit to start...');
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }

    positron.window.previewUrl(uri);
}
