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
import { MockDocument } from '../mocks/mockDocument';

suite('Web app commands', () => {
    const runtimePath = path.join('path', 'to', 'python');
    const workspacePath = path.join('path', 'to', 'workspace');
    const documentPath = path.join(workspacePath, 'file.py');
    const urlPrefix = 'http://new-url-prefix';

    /** Create a mock text document with the given content. */
    function createDocument(text: string): vscode.TextDocument {
        return new MockDocument(text, documentPath, async () => true);
    }

    const disposables: IDisposableRegistry = [];
    let runAppOptions: RunAppOptions | undefined;
    let debugAppOptions: DebugAppOptions | undefined;
    const commands = new Map<string, (uri?: vscode.Uri | string) => Promise<void>>();
    let isFastAPICliInstalled: boolean;

    const originalOpenTextDocument = vscode.workspace.openTextDocument;
    const originalShowInputBox = vscode.window.showInputBox;
    let input: sinon.SinonStub;

    /** URIs passed to `vscode.workspace.openTextDocument`, in call order. */
    let openedUris: vscode.Uri[];

    /** What the stubbed `vscode.workspace.openTextDocument` resolves or rejects with. */
    let openTextDocumentResult: () => Promise<vscode.TextDocument>;

    setup(() => {
        // Stub `vscode.extensions.getExtension('positron.positron-run-app')` to return an extension
        // with:
        // 1. `runApplication` that records the last `options` that it was called with.
        // 2. `debugApplication` that records the last `options` that it was called with.
        runAppOptions = undefined;
        debugAppOptions = undefined;
        input = sinon.stub();
        vscode.window.showInputBox = input;
        const runAppApi: PositronRunApp = {
            async runApplication(_options) {
                assert.ok(!runAppOptions, 'runApplication called more than once');
                runAppOptions = _options;
                return undefined;
            },
            async runApplicationInConsole() {
                return undefined;
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

        // Stub `vscode.workspace.openTextDocument` so the URI tests can see the
        // URI the command resolved without touching the filesystem.
        openedUris = [];
        openTextDocumentResult = () => Promise.reject(new Error('cannot open file'));
        vscode.workspace.openTextDocument = ((uri: vscode.Uri) => {
            openedUris.push(uri);
            return openTextDocumentResult();
        }) as unknown as typeof vscode.workspace.openTextDocument;

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
        // `vscode` is mocked once per process and shared with every other unit
        // test suite, so put the real function back rather than leaking a stub.
        vscode.workspace.openTextDocument = originalOpenTextDocument;
        vscode.window.showInputBox = originalShowInputBox;
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
            command: runtimePath,
            args: [documentPath],
            env: { PYTHONPATH: workspacePath },
        });
    });

    test('Exec Dash in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Dash_In_Terminal,
            {
                command: runtimePath,
                args: [documentPath],
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
            command: runtimePath,
            args: ['-m', 'fastapi', 'dev', documentPath],
        });
    });

    test('Exec FastAPI in terminal - fastapi-cli not installed, inferred app name', async () => {
        isFastAPICliInstalled = false;

        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            { command: runtimePath, args: ['-m', 'uvicorn', '--reload', `${path.parse(documentPath).name}:app`] },
            { documentText: 'app = FastAPI()' },
        );
    });

    test('Exec FastAPI in terminal - annotated factory app name', async () => {
        isFastAPICliInstalled = false;
        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            { command: runtimePath, args: ['-m', 'uvicorn', '--reload', 'file:app'] },
            { documentText: 'from fastapi import FastAPI\napp: FastAPI = create_app(title="My API")' },
        );
        assert.strictEqual(input.callCount, 0);
    });

    test('Exec FastAPI in terminal - annotated direct construction uses variable name', async () => {
        isFastAPICliInstalled = false;
        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            { command: runtimePath, args: ['-m', 'uvicorn', '--reload', 'file:api_server'] },
            { documentText: 'api_server: FastAPI = FastAPI()' },
        );
        assert.strictEqual(input.callCount, 0);
    });

    for (const [description, documentText, name] of [
        ['spaced annotation', 'api_server : FastAPI = create_app()', 'api_server'],
        ['CRLF annotation', 'from fastapi import FastAPI\r\napi_server: FastAPI = create_app()', 'api_server'],
        ['direct construction before annotation', 'first = FastAPI()\nsecond: FastAPI = create_app()', 'first'],
        ['annotation before direct construction', 'first: FastAPI = create_app()\nsecond = FastAPI()', 'first'],
        ['direct construction in module if block', 'if enabled:\n    block_app = FastAPI()', 'block_app'],
        [
            'direct construction in module try block',
            'try:\n    block_app = FastAPI()\nexcept ImportError:\n    pass',
            'block_app',
        ],
        ['annotation in module if block', 'if enabled:\n    block_app: FastAPI = create_app()', 'block_app'],
        [
            'module assignment after local function',
            'def make_app():\n    local: FastAPI = create_app()\napp = FastAPI()',
            'app',
        ],
        [
            'module annotation after multiline factory signature',
            "def create_app(\n    title: str = 'My API',\n) -> FastAPI:\n    local_app: FastAPI = FastAPI(title=title)\n    return local_app\napp: FastAPI = create_app()",
            'app',
        ],
        ['module annotation after one-line factory', 'def create_app(): return FastAPI()\napp: FastAPI = create_app()', 'app'],
        ['module direct construction after one-line factory', 'def create_app(): return FastAPI()\napp = FastAPI()', 'app'],
        ['module annotation after one-line async function', 'async def setup(): pass\napp: FastAPI = create_app()', 'app'],
        ['module annotation after one-line class', 'class Factory: pass\napp: FastAPI = create_app()', 'app'],
        [
            'module annotation after colon in one-line default string',
            'def create_app(title="My: API"): return FastAPI()\napp: FastAPI = create_app()',
            'app',
        ],
        [
            'module annotation after colon in bracketed default',
            "def create_app(options={'title': 'My API'}): return FastAPI()\napp: FastAPI = create_app()",
            'app',
        ],
        [
            'module annotation after multiline header with annotated parameter',
            'def create_app(\n    title: str\n): return FastAPI()\napp: FastAPI = create_app()',
            'app',
        ],
        [
            'module annotation after triple-quoted multiline default',
            'def create_app(x="""\n)\n"""):\n    pass\napp: FastAPI = create_app()',
            'app',
        ],
        [
            'module direct construction after triple-quoted multiline default',
            'async def setup(x="""\n)\n"""): pass\napp = FastAPI()',
            'app',
        ],
        [
            'module annotation after hash-prefixed triple-quoted default line',
            "def create_app(x='''\n#'''):\n    pass\napp: FastAPI = create_app()",
            'app',
        ],
    ]) {
        test(`Exec FastAPI in terminal - ${description}`, async () => {
            isFastAPICliInstalled = false;
            await verifyRunAppCommand(
                Commands.Exec_FastAPI_In_Terminal,
                { command: runtimePath, args: ['-m', 'uvicorn', '--reload', `file:${name}`] },
                { documentText },
            );
            assert.strictEqual(input.callCount, 0);
        });
    }

    for (const [description, documentText] of [
        ['unannotated factory', 'app = create_app()'],
        ['comment', '# app: FastAPI = create_app()'],
        ['quoted example', '"app: FastAPI = create_app()"'],
        ['declaration without initializer', 'app: FastAPI'],
        ['assignment without initializer', 'app: FastAPI = # explanation'],
        ['equality', 'app: FastAPI == create_app()'],
        ['indented local', 'def make_app():\n    app: FastAPI = create_app()'],
        ['nested local', 'def make_app():\n    if enabled:\n        app: FastAPI = create_app()'],
        ['local direct construction', 'def make_app():\n    app = FastAPI()'],
        ['local annotation in one-line factory', 'def make_app(): app: FastAPI = create_app()'],
        ['local direct construction in one-line factory', 'def make_app(): app = FastAPI()'],
    ]) {
        test(`Exec FastAPI in terminal - ${description} prompts`, async () => {
            isFastAPICliInstalled = false;
            input.resolves('manual_app');
            await verifyRunAppCommand(
                Commands.Exec_FastAPI_In_Terminal,
                { command: runtimePath, args: ['-m', 'uvicorn', '--reload', 'file:manual_app'] },
                { documentText },
            );
            assert.strictEqual(input.callCount, 1);
        });
    }

    test('Exec FastAPI in terminal - CLI installed ignores annotated assignment', async () => {
        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            { command: runtimePath, args: ['-m', 'fastapi', 'dev', documentPath] },
            { documentText: 'api_server: FastAPI = create_app()' },
        );
        assert.strictEqual(input.callCount, 0);
    });

    test('Exec FastAPI in terminal - fastapi-cli not installed, could not infer app name', async () => {
        isFastAPICliInstalled = false;

        await verifyRunAppCommand(Commands.Exec_FastAPI_In_Terminal, undefined);
    });

    test('Exec FastAPI in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_FastAPI_In_Terminal,
            { command: runtimePath, args: ['-m', 'fastapi', 'dev', documentPath] },
            { urlPrefix },
        );
    });

    test('Exec Flask in terminal - without urlPrefix', async () => {
        await verifyRunAppCommand(Commands.Exec_Flask_In_Terminal, {
            command: runtimePath,
            args: ['-m', 'flask', '--app', documentPath, 'run'],
        });
    });

    test('Exec Flask in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Flask_In_Terminal,
            {
                command: runtimePath,
                args: ['-m', 'flask', '--app', documentPath, 'run'],
            },
            { urlPrefix },
        );
    });

    test('Exec Gradio in terminal - without urlPrefix', async () => {
        await verifyRunAppCommand(Commands.Exec_Gradio_In_Terminal, {
            command: runtimePath,
            args: [documentPath],
        });
    });

    test('Exec Gradio in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Gradio_In_Terminal,
            {
                command: runtimePath,
                args: [documentPath],
            },
            { urlPrefix },
        );
    });

    test('Exec Streamlit in terminal - without urlPrefix', async () => {
        await verifyRunAppCommand(Commands.Exec_Streamlit_In_Terminal, {
            command: runtimePath,
            args: ['-m', 'streamlit', 'run', documentPath, '--server.headless', 'true'],
        });
    });

    test('Exec Streamlit in terminal - with urlPrefix', async () => {
        await verifyRunAppCommand(
            Commands.Exec_Streamlit_In_Terminal,
            {
                command: runtimePath,
                args: ['-m', 'streamlit', 'run', documentPath, '--server.headless', 'true'],
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

    test('Debug FastAPI in terminal - annotated factory without CLI', async () => {
        isFastAPICliInstalled = false;
        await verifyDebugAppCommand(
            Commands.Debug_FastAPI_In_Terminal,
            {
                type: 'python',
                name: 'FastAPI',
                request: 'launch',
                jinja: true,
                stopOnEntry: false,
                module: 'uvicorn',
                args: ['--reload', 'file:api_server'],
            },
            { documentText: 'api_server: FastAPI = create_app()' },
        );
        assert.strictEqual(input.callCount, 0);
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

    test('URI argument - opens the given file and runs it', async () => {
        // The command should open the passed URI rather than relying on the
        // active editor, so the editor title button runs its own group's file
        // rather than the active group's.
        const fileUri = vscode.Uri.file(path.resolve(workspacePath, 'app.py'));
        const document = createDocument('import flask');
        openTextDocumentResult = () => Promise.resolve(document);

        const callback = commands.get(Commands.Exec_Flask_In_Terminal);
        assert.ok(callback, 'Command not registered');
        await callback(fileUri);

        assert.deepStrictEqual(openedUris, [fileUri]);
        assert.ok(runAppOptions, 'runAppOptions not set');
        // The document is passed to the Run App API, which runs it.
        assert.strictEqual(runAppOptions.document, document);
    });

    test('URI argument - accepts the string form of a URI', async () => {
        // A command argument that crosses a process boundary (a keybinding's
        // `args`, an agent's tool call) is JSON, so the URI arrives as a
        // string. The string is parsed, so a scheme without slashes
        // (untitled:, vscode-notebook-cell:) survives too.
        const fileUri = vscode.Uri.parse('untitled:Untitled-1');
        const document = createDocument('import flask');
        openTextDocumentResult = () => Promise.resolve(document);

        const callback = commands.get(Commands.Exec_Flask_In_Terminal);
        assert.ok(callback, 'Command not registered');
        await callback(fileUri.toString());

        assert.deepStrictEqual(
            openedUris.map((uri) => uri.toString()),
            [fileUri.toString()],
        );
        assert.ok(runAppOptions, 'runAppOptions not set');
        assert.strictEqual(runAppOptions.document, document);
    });

    test('URI argument - the debug commands take it too', async () => {
        const fileUri = vscode.Uri.file(path.resolve(workspacePath, 'app.py'));
        const document = createDocument('import flask');
        openTextDocumentResult = () => Promise.resolve(document);

        const callback = commands.get(Commands.Debug_Flask_In_Terminal);
        assert.ok(callback, 'Command not registered');
        await callback(fileUri);

        assert.deepStrictEqual(openedUris, [fileUri]);
        assert.ok(debugAppOptions, 'debugAppOptions not set');
        assert.strictEqual(debugAppOptions.document, document);
    });

    test('URI argument - an empty string is a bad argument, not an omitted one', async () => {
        // Falling back to the active editor here would silently run whatever
        // is focused instead of the file the caller meant.
        const callback = commands.get(Commands.Exec_Flask_In_Terminal);
        assert.ok(callback, 'Command not registered');
        await assert.rejects(callback(''), /cannot open file/);

        assert.strictEqual(openedUris.length, 1, 'the empty string should be opened as a URI');
        assert.strictEqual(runAppOptions, undefined, 'runApplication should not be called');
    });

    test('No URI argument - leaves the document to the Run App API', async () => {
        // The API falls back to the active editor's document, so the command
        // passes no document rather than resolving one itself.
        const callback = commands.get(Commands.Exec_Flask_In_Terminal);
        assert.ok(callback, 'Command not registered');
        await callback();

        assert.deepStrictEqual(openedUris, []);
        assert.ok(runAppOptions, 'runAppOptions not set');
        assert.strictEqual(runAppOptions.document, undefined);
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
