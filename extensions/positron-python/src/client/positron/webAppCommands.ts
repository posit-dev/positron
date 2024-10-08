/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { PositronRunApp, RunAppTerminalOptions } from '../positron-run-app.d';
import { IServiceContainer } from '../ioc/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IInstaller, Product } from '../common/types';
import { traceError } from '../logging';
import { Commands } from '../common/constants';

export function activateWebAppCommands(serviceContainer: IServiceContainer, disposables: vscode.Disposable[]): void {
    disposables.push(
        vscode.commands.registerCommand(Commands.Exec_Dash_In_Terminal, async () => {
            const runAppApi = await getPositronRunAppApi();
            await runAppApi.runApplication({
                name: 'Dash',
                getTerminalOptions(runtime, document, _port, urlPrefix) {
                    const terminalOptions: RunAppTerminalOptions = {
                        commandLine: [runtime.runtimePath, document.uri.fsPath].join(' '),
                    };
                    terminalOptions.env = {};
                    if (urlPrefix) {
                        // Note that this will result in the app being run at http://localhost:APP_PORT/proxy/PROXY_PORT/
                        terminalOptions.env.DASH_URL_BASE_PATHNAME = urlPrefix;
                    }
                    return terminalOptions;
                },
            });
        }),

        vscode.commands.registerCommand(Commands.Exec_FastAPI_In_Terminal, async () => {
            const runAppApi = await getPositronRunAppApi();
            await runAppApi.runApplication({
                name: 'FastAPI',
                async getTerminalOptions(runtime, document, _port, _urlPrefix) {
                    let hasFastapiCli = false;

                    const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
                    const interpreter = await interpreterService.getInterpreterDetails(runtime.runtimePath);
                    if (interpreter) {
                        const installer = serviceContainer.get<IInstaller>(IInstaller);
                        hasFastapiCli = await installer.isInstalled(Product.fastapiCli, interpreter);
                    } else {
                        traceError(
                            `Could not check if fastapi-cli is installed due to an invalid interpreter path: ${runtime.runtimePath}`,
                        );
                    }

                    let args: string[];
                    if (hasFastapiCli) {
                        args = [runtime.runtimePath, '-m', 'fastapi', 'dev', document.uri.fsPath];
                    } else {
                        const appName = await getAppName(document, 'FastAPI');
                        if (!appName) {
                            return undefined;
                        }
                        args = [
                            runtime.runtimePath,
                            '-m',
                            'uvicorn',
                            '--reload',
                            `${pathToModule(document.uri.fsPath)}:${appName}`,
                        ];
                    }
                    return { commandLine: args.join(' ') };
                },
                urlPath: '/docs',
            });
        }),

        vscode.commands.registerCommand(Commands.Exec_Flask_In_Terminal, async () => {
            const runAppApi = await getPositronRunAppApi();
            await runAppApi.runApplication({
                name: 'Flask',
                async getTerminalOptions(runtime, document, _port, _urlPrefix) {
                    const args = [runtime.runtimePath, '-m', 'flask', 'run'];
                    const terminalOptions: RunAppTerminalOptions = { commandLine: args.join(' ') };
                    terminalOptions.env = {};
                    terminalOptions.env.FLASK_APP = document.uri.fsPath;
                    return terminalOptions;
                },
            });
        }),

        vscode.commands.registerCommand(Commands.Exec_Gradio_In_Terminal, async () => {
            const runAppApi = await getPositronRunAppApi();
            await runAppApi.runApplication({
                name: 'Gradio',
                getTerminalOptions(runtime, document, _port, urlPrefix) {
                    const terminalOptions: RunAppTerminalOptions = {
                        commandLine: [runtime.runtimePath, document.uri.fsPath].join(' '),
                    };

                    terminalOptions.env = {};
                    if (urlPrefix) {
                        // Gradio doc: https://www.gradio.app/guides/environment-variables#7-gradio-root-path
                        // Issue with Gradio not loading assets when Gradio is run via proxy:
                        //     https://github.com/gradio-app/gradio/issues/9529
                        // Gradio works if we use these versions: gradio==3.3.1 fastapi==0.85.2 httpx==0.24.1
                        terminalOptions.env.GRADIO_ROOT_PATH = urlPrefix;
                    }

                    return terminalOptions;
                },
            });
        }),

        vscode.commands.registerCommand(Commands.Exec_Shiny_In_Terminal, async () => {
            const runAppApi = await getPositronRunAppApi();
            await runAppApi.runApplication({
                name: 'Shiny',
                getTerminalOptions(runtime, document, _port, _urlPrefix) {
                    const args = [runtime.runtimePath, '-m', 'shiny', 'run', '--reload', document.uri.fsPath];
                    return { commandLine: args.join(' ') };
                },
            });
        }),

        vscode.commands.registerCommand(Commands.Exec_Streamlit_In_Terminal, async () => {
            const runAppApi = await getPositronRunAppApi();
            await runAppApi.runApplication({
                name: 'Streamlit',
                getTerminalOptions(runtime, document, _port, _urlPrefix) {
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
                    // Maybe related? https://github.com/streamlit/streamlit/issues/6305
                    // None of the suggestions from https://docs.streamlit.io/knowledge-base/deploy/remote-start
                    // resolve the infinite skeleton loading issue.
                    // Console error: WebSocket connection to 'ws://localhost:8080/proxy/49767/_stcore/stream' failed: WebSocket is closed before the connection is established.
                    return { commandLine: args.join(' ') };
                },
            });
        }),
    );
}

/**
 * Convert a file path string to Python module format.
 * For example `path/to/module.py` becomes `path.to.module`.
 */
function pathToModule(p: string): string {
    // Get the path's directory relative to the workspace root.
    const relativePath = vscode.workspace.asRelativePath(p);
    let relativeDir = path.dirname(relativePath);

    // Get the name of the module.
    const mod = path.parse(p).name;

    // If the module is in the workspace root, return it as is.
    if (relativeDir === '.') {
        return mod;
    }
    // If the module is in a parent directory, remove one '.' as expected by the Python module format.
    if (relativeDir.match(/\.+/)) {
        relativeDir = relativeDir.slice(0, -1);
    }

    // Otherwise, convert the path to a Python module format.
    const parts = relativeDir.split(path.sep);

    return parts.concat(mod).join('.');
}

/**
 * Get an ASGI application object's name from a document, prompting the user if necessary.
 *
 * @param document The Python application document.
 * @param className The name of the ASGI application class e.g. 'FastAPI' or 'Flask'.
 * @returns The name of the ASGI application object, or `undefined` if it could not be determined.
 */
async function getAppName(document: vscode.TextDocument, className: string): Promise<string | undefined> {
    const text = document.getText();
    let appName = text.match(new RegExp(`([^\\s]+)\\s*=\\s*${className}\\(`))?.[1];
    if (!appName) {
        appName = await vscode.window.showInputBox({
            prompt: vscode.l10n.t(
                'No {0} object found in your application code. Please enter the name manually.',
                className,
            ),
            validateInput(value) {
                if (!value.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
                    return vscode.l10n.t('Invalid {0} app object name.', className);
                }
                return undefined;
            },
        });
        if (!appName) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('No {0} application object name provided, aborting. Please try again.', className),
            );
            return undefined;
        }
    }
    return appName;
}

/** Get the Positron Run App extension's API. */
async function getPositronRunAppApi(): Promise<PositronRunApp> {
    const runAppExt = vscode.extensions.getExtension<PositronRunApp>('vscode.positron-run-app');
    if (!runAppExt) {
        throw new Error('vscode.positron-run-app extension not found');
    }
    const runAppApi = await runAppExt.activate();
    return runAppApi;
}
