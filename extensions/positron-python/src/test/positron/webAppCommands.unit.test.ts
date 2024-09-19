/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as path from 'path';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as assert from 'assert';
import { IDisposableRegistry, IInstaller } from '../../client/common/types';
import { activateWebAppCommands } from '../../client/positron/webAppCommands';
import { IServiceContainer } from '../../client/ioc/types';
import { PositronRunApp, RunAppOptions, RunAppTerminalOptions } from '../../client/positron-run-app.d';
import { Commands } from '../../client/common/constants';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';

suite('Web app commands', () => {
    const runtimePath = '/path/to/python';
    const documentPath = '/path/to/file.py';
    const port = '8080';
    const urlPrefix = 'http://new-url-prefix';

    const disposables: IDisposableRegistry = [];
    let runAppOptions: RunAppOptions | undefined;
    let commands: Map<string, () => Promise<void>>;
    let isFastAPICliInstalled: boolean;
    let serviceContainer: IServiceContainer;

    setup(() => {
        // Stub `vscode.extensions.getExtension('vscode.positron-run-app')` to return an extension API
        // that records the last `options` passed to `runApplication`.
        runAppOptions = undefined;
        const runAppApi: PositronRunApp = {
            async runApplication(_options) {
                assert(runAppOptions === undefined, 'runApplication called more than once');
                runAppOptions = _options;
            },
        };
        sinon.stub(vscode.extensions, 'getExtension').callsFake((extensionId) => {
            if (extensionId === 'vscode.positron-run-app') {
                return {
                    id: '',
                    extensionPath: '',
                    extensionKind: vscode.ExtensionKind.UI,
                    isActive: true,
                    packageJSON: {},
                    exports: runAppApi as any,
                    extensionUri: vscode.Uri.parse(''),
                    activate: () => Promise.resolve(runAppApi as any),
                };
            }
            return undefined;
        });

        // Stub `vscode.commands.registerCommand` to record registered command callbacks.
        commands = new Map<string, () => Promise<void>>();
        vscode.commands.registerCommand = (command, callback) => {
            assert(!commands.has(command), `Command registered more than once: ${command}`);
            commands.set(command, callback);
            return { dispose: () => undefined };
        };

        const interpreter = {} as PythonEnvironment;

        const interpreterService = {
            getInterpreterDetails(_pythonPath) {
                return Promise.resolve(interpreter);
            },
        } as IInterpreterService;

        isFastAPICliInstalled = true;
        const installer = {
            isInstalled(_product, _interpreter) {
                return Promise.resolve(isFastAPICliInstalled);
            },
        } as IInstaller;

        serviceContainer = {
            get(serviceIdentifier) {
                switch (serviceIdentifier) {
                    case IInstaller:
                        return installer;
                    case IInterpreterService:
                        return interpreterService;
                    default:
                        throw new Error('Unknown service');
                }
            },
        } as IServiceContainer;
    });

    teardown(() => {
        disposables.forEach((d) => d.dispose());
        disposables.splice(0, disposables.length);
        sinon.restore();
    });

    async function verifyRunAppCommand(
        command: string,
        expectedTerminalOptions: RunAppTerminalOptions,
        options?: { documentText?: string; port?: string; urlPrefix?: string },
    ) {
        // Activate web app commands.
        activateWebAppCommands(serviceContainer, disposables);

        // Call the command callback and ensure that the RunAppOptions are set.
        const callback = commands.get(command);
        assert(callback, `Command not registered for: ${command}`);
        await callback();
        assert(runAppOptions, `RunAppOptions not set for command: ${command}`);

        // Test `getTerminalOptions`.
        const runtime = { runtimePath } as positron.LanguageRuntimeMetadata;
        const document = {
            uri: { fsPath: documentPath },
            getText() {
                return options?.documentText ?? '';
            },
        } as vscode.TextDocument;
        const terminalOptions = await runAppOptions.getTerminalOptions(
            runtime,
            document,
            options?.port,
            options?.urlPrefix,
        );
        assert.deepStrictEqual(terminalOptions, expectedTerminalOptions);
    }

    test('Exec Dash in terminal - without port and urlPrefix', async () => {
        await verifyRunAppCommand(Commands.Exec_Dash_In_Terminal, {
            commandLine: `${runtimePath} ${documentPath}`,
            env: {},
        });
    });

    test('Exec Dash in terminal - with port and urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Dash_In_Terminal,
            {
                commandLine: `${runtimePath} ${documentPath}`,
                env: {
                    DASH_PORT: port,
                    DASH_URL_PREFIX: urlPrefix,
                },
            },
            { port, urlPrefix },
        );
    });

    test('Exec FastAPI in terminal - fastapi-cli installed', async () => {
        await verifyRunAppCommand(Commands.Exec_FastAPI_In_Terminal, {
            commandLine: `${runtimePath} -m fastapi dev ${documentPath}`,
        });
    });

    test('Exec FastAPI in terminal - fastapi-cli not installed', async () => {
        isFastAPICliInstalled = false;

        sinon.stub(vscode, 'workspace').get(() => ({
            workspaceFolders: [{ uri: { fsPath: '/path/to' } }],
        }));

        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            {
                commandLine: `${runtimePath} -m uvicorn --reload ${path.parse(documentPath).name}:app`,
            },
            { documentText: 'app = FastAPI()' },
        );
    });

    test('Exec FastAPI in terminal - with port and urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            {
                commandLine: `${runtimePath} -m fastapi dev ${documentPath} --port ${port} --root-path ${urlPrefix}`,
            },
            { port, urlPrefix },
        );
    });

    // TODO: Test Flask
    // TODO: Test Gradio
    // TODO: Test Shiny
    // TODO: Test Streamlit
});

// TODO: Unit tests for pathToModule? And getAppName?
