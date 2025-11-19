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
import { DebugAppOptions, PositronRunApp, RunAppOptions, RunAppTerminalOptions } from '../../client/positron-run-app.d';
import { Commands } from '../../client/common/constants';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';

suite('Web app commands', () => {
    const runtimePath = path.join('path', 'to', 'python');
    const workspacePath = path.join('path', 'to', 'workspace');
    const documentPath = path.join(workspacePath, 'file.py');
    const urlPrefix = 'http://new-url-prefix';

    const disposables: IDisposableRegistry = [];
    let runAppOptions: RunAppOptions | undefined;
    let debugAppOptions: DebugAppOptions | undefined;
    const commands = new Map<string, () => Promise<void>>();
    let isFastAPICliInstalled: boolean;

    setup(() => {
        // Stub `vscode.extensions.getExtension('positron.positron-run-app')` to return an extension
        // with:
        // 1. `runApplication` that records the last `options` that it was called with.
        // 2. `debugApplication` that records the last `options` that it was called with.
        runAppOptions = undefined;
        debugAppOptions = undefined;
        const runAppApi: PositronRunApp = {
            async runApplication(_options) {
                assert.ok(!runAppOptions, 'runApplication called more than once');
                runAppOptions = _options;
            },
            async debugApplication(_options) {
                assert.ok(!debugAppOptions, 'debugApplication called more than once');
                debugAppOptions = _options;
            },
        };
        sinon.stub(vscode.extensions, 'getExtension').callsFake((extensionId) => {
            if (extensionId === 'positron.positron-run-app') {
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
        vscode.commands.registerCommand = (command, callback) => {
            assert.ok(!commands.has(command), `Command registered more than once: ${command}`);
            commands.set(command, callback);
            return { dispose: () => undefined };
        };

        // Stub `vscode.workspace.asRelativePath`.
        vscode.workspace.asRelativePath = (pathOrUri: string | vscode.Uri) => {
            const fsPath = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
            return path.relative(workspacePath, fsPath);
        };

        // Stub the interpreter service and installer services.
        // Tests can set `isFastAPICliInstalled` to control whether the FastAPI CLI is installed.
        isFastAPICliInstalled = true;

        const interpreter = {} as PythonEnvironment;

        const interpreterService = {
            getInterpreterDetails(_pythonPath) {
                return Promise.resolve(interpreter);
            },
        } as IInterpreterService;

        const installer = {
            isInstalled(_product, _interpreter) {
                return Promise.resolve(isFastAPICliInstalled);
            },
        } as IInstaller;

        const serviceContainer = {
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

        // Activate web app commands.
        activateWebAppCommands(serviceContainer, disposables);
    });

    teardown(() => {
        commands.clear();
        disposables.forEach((d) => d.dispose());
        disposables.splice(0, disposables.length);
        sinon.restore();
    });

    async function verifyRunAppCommand(
        command: string,
        expectedTerminalOptions: RunAppTerminalOptions | undefined,
        options?: { documentText?: string; urlPrefix?: string },
    ) {
        // Call the command callback and ensure that it sets runAppOptions.
        const callback = commands.get(command);
        assert.ok(callback, `Command not registered for: ${command}`);
        await callback();
        assert.ok(runAppOptions, `runAppOptions not set for command: ${command}`);

        // Test `getTerminalOptions`.
        const runtime = {
            runtimePath,
            extraRuntimeData: { pythonPath: runtimePath },
        } as positron.LanguageRuntimeMetadata;
        const document = {
            uri: { fsPath: documentPath },
            getText() {
                return options?.documentText ?? '';
            },
        } as vscode.TextDocument;
        const terminalOptions = await runAppOptions.getTerminalOptions(runtime, document, options?.urlPrefix);
        assert.deepStrictEqual(terminalOptions, expectedTerminalOptions);
    }

    test('Exec Dash in terminal - without urlPrefix', async () => {
        await verifyRunAppCommand(Commands.Exec_Dash_In_Terminal, {
            commandLine: `${runtimePath} ${documentPath}`,
            env: { PYTHONPATH: workspacePath },
        });
    });

    test('Exec Dash in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Dash_In_Terminal,
            {
                commandLine: `${runtimePath} ${documentPath}`,
                env: {
                    PYTHONPATH: workspacePath,
                    DASH_URL_BASE_PATHNAME: urlPrefix,
                },
            },
            { urlPrefix },
        );
    });

    test('Exec FastAPI in terminal - fastapi-cli installed', async () => {
        await verifyRunAppCommand(Commands.Exec_FastAPI_In_Terminal, {
            commandLine: `${runtimePath} -m fastapi dev ${documentPath}`,
        });
    });

    test('Exec FastAPI in terminal - fastapi-cli not installed, inferred app name', async () => {
        isFastAPICliInstalled = false;

        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            { commandLine: `${runtimePath} -m uvicorn --reload ${path.parse(documentPath).name}:app` },
            { documentText: 'app = FastAPI()' },
        );
    });

    test('Exec FastAPI in terminal - fastapi-cli not installed, could not infer app name', async () => {
        isFastAPICliInstalled = false;

        await verifyRunAppCommand(Commands.Exec_FastAPI_In_Terminal, undefined);
    });

    test('Exec FastAPI in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            { commandLine: `${runtimePath} -m fastapi dev ${documentPath}` },
            { urlPrefix },
        );
    });

    test('Exec Flask in terminal - without urlPrefix', async () => {
        await verifyRunAppCommand(Commands.Exec_Flask_In_Terminal, {
            commandLine: `${runtimePath} -m flask --app ${documentPath} run`,
        });
    });

    test('Exec Flask in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Flask_In_Terminal,
            {
                commandLine: `${runtimePath} -m flask --app ${documentPath} run`,
            },
            { urlPrefix },
        );
    });

    test('Exec Gradio in terminal - without urlPrefix', async () => {
        await verifyRunAppCommand(Commands.Exec_Gradio_In_Terminal, {
            commandLine: `${runtimePath} ${documentPath}`,
        });
    });

    test('Exec Gradio in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Gradio_In_Terminal,
            {
                commandLine: `${runtimePath} ${documentPath}`,
            },
            { urlPrefix },
        );
    });

    test('Exec Streamlit in terminal - without urlPrefix', async () => {
        await verifyRunAppCommand(Commands.Exec_Streamlit_In_Terminal, {
            commandLine: `${runtimePath} -m streamlit run ${documentPath} --server.headless true`,
        });
    });

    test('Exec Streamlit in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Streamlit_In_Terminal,
            {
                commandLine: `${runtimePath} -m streamlit run ${documentPath} --server.headless true`,
            },
            { urlPrefix },
        );
    });

    async function verifyDebugAppCommand(
        command: string,
        expectedDebugConfig: vscode.DebugConfiguration | undefined,
        options?: { documentText?: string; urlPrefix?: string },
    ) {
        // Call the command callback and ensure that it sets runAppOptions.
        const callback = commands.get(command);
        assert.ok(callback, `Command not registered for: ${command}`);
        await callback!();
        assert.ok(debugAppOptions, `debugAppOptions not set for command: ${command}`);

        // Test `getDebugConfiguration`.
        const runtime = {
            runtimePath,
            extraRuntimeData: { pythonPath: runtimePath },
        } as positron.LanguageRuntimeMetadata;
        const document = {
            uri: { fsPath: documentPath },
            getText() {
                return options?.documentText ?? '';
            },
        } as vscode.TextDocument;
        const terminalOptions = await debugAppOptions!.getDebugConfiguration(runtime, document, options?.urlPrefix);
        assert.deepStrictEqual(terminalOptions, expectedDebugConfig);
    }

    test('Debug Dash in terminal - with urlPrefix', async () => {
        await verifyDebugAppCommand(
            Commands.Debug_Dash_In_Terminal,
            {
                type: 'python',
                name: 'Dash',
                request: 'launch',
                jinja: true,
                stopOnEntry: false,
                program: documentPath,
                env: { PYTHONPATH: workspacePath, DASH_URL_BASE_PATHNAME: urlPrefix },
            },
            { urlPrefix },
        );
    });

    test('Debug FastAPI in terminal - with urlPrefix', async () => {
        await verifyDebugAppCommand(
            Commands.Debug_FastAPI_In_Terminal,
            {
                type: 'python',
                name: 'FastAPI',
                request: 'launch',
                jinja: true,
                stopOnEntry: false,
                module: 'fastapi',
                args: ['dev', documentPath],
            },
            { urlPrefix },
        );
    });

    test('Debug Flask in terminal - without urlPrefix', async () => {
        await verifyDebugAppCommand(
            Commands.Debug_Flask_In_Terminal,
            {
                type: 'python',
                name: 'Flask',
                request: 'launch',
                jinja: true,
                stopOnEntry: false,
                module: 'flask',
                args: ['--app', documentPath, 'run'],
            },
            { urlPrefix },
        );
    });

    test('Debug Gradio in terminal - without urlPrefix', async () => {
        await verifyDebugAppCommand(
            Commands.Debug_Gradio_In_Terminal,
            {
                type: 'python',
                name: 'Gradio',
                request: 'launch',
                jinja: true,
                stopOnEntry: false,
                program: documentPath,
                env: {},
            },
            { urlPrefix },
        );
    });

    test('Debug Streamlit in terminal - with urlPrefix', async () => {
        await verifyDebugAppCommand(
            Commands.Debug_Streamlit_In_Terminal,
            {
                type: 'python',
                name: 'Streamlit',
                request: 'launch',
                jinja: true,
                stopOnEntry: false,
                module: 'streamlit',
                args: ['run', documentPath, '--server.headless', 'true'],
            },
            { urlPrefix },
        );
    });
});
