/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { PositronRunApp, RunAppTerminalOptions } from '../positron-run-app.d';
import { IServiceContainer } from '../ioc/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IInstaller, Product } from '../common/types';
import { traceError } from '../logging';
import { Commands } from '../common/constants';

export function activateWebAppCommands(serviceContainer: IServiceContainer, disposables: vscode.Disposable[]): void {
    disposables.push(
        registerExecCommand(Commands.Exec_Dash_In_Terminal, 'Dash', (_runtime, document, port, urlPrefix) =>
            getDashDebugConfig(document, port, urlPrefix),
        ),
        registerExecCommand(Commands.Exec_FastAPI_In_Terminal, 'FastAPI', (runtime, document, port, urlPrefix) =>
            getFastAPIDebugConfig(serviceContainer, runtime, document, port, urlPrefix),
        ),
        registerExecCommand(Commands.Exec_Flask_In_Terminal, 'Flask', (_runtime, document, port, urlPrefix) =>
            getFlaskDebugConfig(document, port, urlPrefix),
        ),
        registerExecCommand(Commands.Exec_Gradio_In_Terminal, 'Gradio', (_runtime, document, port, urlPrefix) =>
            getGradioDebugConfig(document, port, urlPrefix),
        ),
        registerExecCommand(Commands.Exec_Shiny_In_Terminal, 'Shiny', (_runtime, document, port, _urlPrefix) =>
            getShinyDebugConfig(document, port),
        ),
        registerExecCommand(Commands.Exec_Streamlit_In_Terminal, 'Streamlit', (_runtime, document, port, _urlPrefix) =>
            getStreamlitDebugConfig(document, port),
        ),
        registerDebugCommand(Commands.Debug_Dash_In_Terminal, 'Dash', (_runtime, document, port, urlPrefix) =>
            getDashDebugConfig(document, port, urlPrefix),
        ),
        registerDebugCommand(Commands.Debug_FastAPI_In_Terminal, 'FastAPI', (runtime, document, port, urlPrefix) =>
            getFastAPIDebugConfig(serviceContainer, runtime, document, port, urlPrefix),
        ),
        registerDebugCommand(Commands.Debug_Flask_In_Terminal, 'Flask', (_runtime, document, port, urlPrefix) =>
            getFlaskDebugConfig(document, port, urlPrefix),
        ),
        registerDebugCommand(Commands.Debug_Gradio_In_Terminal, 'Gradio', (_runtime, document, port, urlPrefix) =>
            getGradioDebugConfig(document, port, urlPrefix),
        ),
        registerDebugCommand(Commands.Debug_Shiny_In_Terminal, 'Shiny', (_runtime, document, port, _urlPrefix) =>
            getShinyDebugConfig(document, port),
        ),
        registerDebugCommand(
            Commands.Debug_Streamlit_In_Terminal,
            'Streamlit',
            (_runtime, document, port, _urlPrefix) => getStreamlitDebugConfig(document, port),
        ),
    );
}

function registerExecCommand(
    command: string,
    name: string,
    getDebugConfiguration: (
        runtime: positron.LanguageRuntimeMetadata,
        document: vscode.TextDocument,
        port?: string,
        urlPrefix?: string,
    ) => DebugConfiguration | undefined | Promise<DebugConfiguration | undefined>,
    urlPath?: string,
): vscode.Disposable {
    return vscode.commands.registerCommand(command, async () => {
        const runAppApi = await getPositronRunAppApi();
        await runAppApi.runApplication({
            name,
            async getTerminalOptions(runtime, document, port, urlPrefix) {
                const config = await getDebugConfiguration(runtime, document, port, urlPrefix);
                if (!config) {
                    return undefined;
                }

                const args = [runtime.runtimePath];
                if ('module' in config) {
                    args.push('-m', config.module);
                } else {
                    args.push(config.program);
                }
                if (config.args) {
                    args.push(...config.args);
                }

                const terminalOptions: RunAppTerminalOptions = {
                    commandLine: args.join(' '),
                };
                // Add environment variables if any.
                if (config.env && Object.keys(config.env).length > 0) {
                    terminalOptions.env = config.env;
                }
                return terminalOptions;
            },
            urlPath,
        });
    });
}

function registerDebugCommand(
    command: string,
    name: string,
    getPythonDebugConfiguration: (
        runtime: positron.LanguageRuntimeMetadata,
        document: vscode.TextDocument,
        port?: string,
        urlPrefix?: string,
    ) => DebugConfiguration | undefined | Promise<DebugConfiguration | undefined>,
): vscode.Disposable {
    return vscode.commands.registerCommand(command, async () => {
        const runAppApi = await getPositronRunAppApi();
        await runAppApi.debugApplication({
            name,
            async getDebugConfiguration(runtime, document, port, urlPrefix) {
                const config = await getPythonDebugConfiguration(runtime, document, port, urlPrefix);
                if (!config) {
                    return undefined;
                }
                return {
                    type: 'python',
                    name,
                    request: 'launch',
                    ...config,
                    jinja: true,
                    stopOnEntry: false,
                };
            },
        });
    });
}

interface BaseDebugConfiguration {
    env?: { [key: string]: string | null | undefined };
    args?: string[];
}

interface ModuleDebugConfiguration extends BaseDebugConfiguration {
    module: string;
}

interface ProgramDebugConfiguration extends BaseDebugConfiguration {
    program: string;
}

type DebugConfiguration = ModuleDebugConfiguration | ProgramDebugConfiguration;

function getDashDebugConfig(document: vscode.TextDocument, port?: string, urlPrefix?: string): DebugConfiguration {
    const env: { [key: string]: string | null | undefined } = {
        PYTHONPATH: path.dirname(document.uri.fsPath),
    };
    if (port) {
        env.DASH_PORT = port;
    }
    if (urlPrefix) {
        env.DASH_URL_PREFIX = urlPrefix;
    }

    return { program: document.uri.fsPath, env };
}

async function getFastAPIDebugConfig(
    serviceContainer: IServiceContainer,
    runtime: positron.LanguageRuntimeMetadata,
    document: vscode.TextDocument,
    port?: string,
    urlPrefix?: string,
): Promise<DebugConfiguration | undefined> {
    let mod: string | undefined;
    let args: string[];
    if (await isFastAPICLIInstalled(serviceContainer, runtime.runtimePath)) {
        mod = 'fastapi';
        args = ['dev', document.uri.fsPath];
    } else {
        const appName = await getAppName(document, 'FastAPI');
        if (!appName) {
            return undefined;
        }
        mod = 'uvicorn';
        args = ['--reload', `${pathToModule(document.uri.fsPath)}:${appName}`];
    }

    if (port) {
        args.push('--port', port);
    }
    if (urlPrefix) {
        args.push('--root-path', urlPrefix);
    }

    return { module: mod, args };
}

async function isFastAPICLIInstalled(serviceContainer: IServiceContainer, pythonPath: string): Promise<boolean> {
    const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
    const interpreter = await interpreterService.getInterpreterDetails(pythonPath);
    if (!interpreter) {
        traceError(`Could not check if fastapi-cli is installed due to an invalid interpreter path: ${pythonPath}`);
    }
    const installer = serviceContainer.get<IInstaller>(IInstaller);
    return installer.isInstalled(Product.fastapiCli, interpreter);
}

function getFlaskDebugConfig(document: vscode.TextDocument, port?: string, urlPrefix?: string): DebugConfiguration {
    const args = ['--app', document.uri.fsPath, 'run'];
    if (port) {
        args.push('--port', port);
    }
    const env: { [key: string]: string } = {};
    if (urlPrefix) {
        env.SCRIPT_NAME = urlPrefix;
    }
    return { module: 'flask', args, env };
}

function getGradioDebugConfig(document: vscode.TextDocument, port?: string, urlPrefix?: string): DebugConfiguration {
    const env: { [key: string]: string } = {};
    if (port) {
        env.GRADIO_SERVER_PORT = port;
    }
    if (urlPrefix) {
        env.GRADIO_ROOT_PATH = urlPrefix;
    }
    return { program: document.uri.fsPath, env };
}

function getShinyDebugConfig(document: vscode.TextDocument, port?: string): DebugConfiguration {
    const args = ['run', '--reload', document.uri.fsPath];
    if (port) {
        args.push('--port', port);
    }
    return { module: 'shiny', args };
}

function getStreamlitDebugConfig(document: vscode.TextDocument, port?: string): DebugConfiguration {
    const args = ['run', document.uri.fsPath, '--server.headless', 'true'];
    if (port) {
        args.push('--port', port);
    }
    return { module: 'streamlit', args };
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
