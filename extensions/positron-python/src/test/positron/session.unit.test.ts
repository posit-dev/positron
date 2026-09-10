/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-empty-function */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { interfaces } from 'inversify';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import { anything, reset, when } from 'ts-mockito';
import * as vscode from 'vscode';
import * as fs from '../../client/common/platform/fs-paths';
import { ILanguageServerOutputChannel } from '../../client/activation/types';
import { IApplicationShell, IWorkspaceService } from '../../client/common/application/types';
import {
    IConfigurationService,
    IInstaller,
    IInterpreterPathService,
    InstallerResponse,
    IPythonSettings,
    ProductInstallStatus,
} from '../../client/common/types';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../client/common/process/types';
import { InterpreterInformation } from '../../client/pythonEnvironments/info';
import { Architecture } from '../../client/common/utils/platform';
import { createDeferred } from '../../client/common/utils/async';
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../../client/common/variables/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import {
    PositronSupervisorApi,
    JupyterKernelSpec,
    JupyterLanguageRuntimeSession,
    JupyterSession,
    JupyterKernel,
} from '../../client/positron-supervisor.d';
import { PythonRuntimeSession } from '../../client/positron/session';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { PythonVersion } from '../../client/pythonEnvironments/info/pythonVersion';
import { mock } from './utils';
import { IpykernelBundle } from '../../client/positron/ipykernel';
import { MockMemento } from '../mocks/mementos';
import { mockedPositronNamespaces, mockedVSCodeNamespaces } from '../vscode-mock';

suite('Python Runtime Session', () => {
    let disposables: vscode.Disposable[];
    let applicationShell: IApplicationShell;
    let installerSpy: sinon.SinonSpiedInstance<IInstaller>;
    let interpreterPathService: IInterpreterPathService;
    let interpreterService: IInterpreterService;
    let envVarsServiceSpy: sinon.SinonSpiedInstance<IEnvironmentVariablesService>;
    let interpreter: PythonEnvironment;
    let serviceContainer: IServiceContainer;
    let kernelSpec: JupyterKernelSpec;
    let kernel: JupyterLanguageRuntimeSession;
    let pathExistsStub: sinon.SinonStub;
    let executionFactorySpy: sinon.SinonSpiedInstance<IPythonExecutionFactory>;
    let useBundledIpykernel: boolean;

    setup(() => {
        disposables = [];
        useBundledIpykernel = true;

        applicationShell = mock<IApplicationShell>({
            showErrorMessage: () => Promise.resolve(undefined),
        });

        interpreterPathService = mock<IInterpreterPathService>({
            update: () => Promise.resolve(),
        });

        interpreter = mock<PythonEnvironment>({
            id: 'pythonEnvironmentId',
            path: '/path/to/python',
            version: mock<PythonVersion>({ major: 3, minor: 9 }),
            architecture: Architecture.x64,
            implementation: 'cpython',
        });

        interpreterService = mock<IInterpreterService>({
            getInterpreterDetails: (_pythonPath, _resource) => Promise.resolve(interpreter),
            triggerRefresh: () => Promise.resolve(),
        });

        const installer = mock<IInstaller>({
            isInstalled: () => Promise.resolve(true),
            promptToInstall: () => Promise.resolve(InstallerResponse.Installed),
            isProductVersionCompatible: () => Promise.resolve(ProductInstallStatus.Installed),
        });
        installerSpy = sinon.spy(installer);

        const outputChannel = mock<ILanguageServerOutputChannel>({});

        // Mock workspace configuration for getIpykernelBundle
        const workspaceConfiguration = mock<vscode.WorkspaceConfiguration>({
            get: (section: string) => (section === 'useBundledIpykernel' ? useBundledIpykernel : undefined),
        });
        const workspaceService = mock<IWorkspaceService>({
            workspaceFolders: undefined,
            getWorkspaceFolder: () => undefined,
            getConfiguration: () => workspaceConfiguration,
        });

        // Mock python execution service for fresh interpreter info fetches
        const pythonExecutionService = mock<IPythonExecutionService>({
            getInterpreterInformation: () =>
                Promise.resolve(
                    mock<InterpreterInformation>({
                        implementation: 'cpython',
                        version: interpreter.version,
                        architecture: Architecture.x64,
                    }),
                ),
        });
        const pythonExecutionFactory = mock<IPythonExecutionFactory>({
            create: () => Promise.resolve(pythonExecutionService),
        });
        executionFactorySpy = sinon.spy(pythonExecutionFactory);

        const pythonSettings = mock<IPythonSettings>({
            autoComplete: { extraPaths: [] },
        });

        const configService = mock<IConfigurationService>({
            getSettings: () => pythonSettings,
        });

        const envVarsProvider = mock<IEnvironmentVariablesProvider>({
            onDidEnvironmentVariablesChange: () => ({ dispose() {} }),
        });

        const envVarsService = mock<IEnvironmentVariablesService>({
            appendPythonPath: () => Promise.resolve(),
        });
        envVarsServiceSpy = sinon.spy(envVarsService);

        serviceContainer = mock<IServiceContainer>({
            get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                switch (serviceIdentifier) {
                    case IApplicationShell:
                        return applicationShell as T;
                    case IConfigurationService:
                        return configService as T;
                    case IEnvironmentVariablesProvider:
                        return envVarsProvider as T;
                    case IEnvironmentVariablesService:
                        return envVarsService as T;
                    case IInstaller:
                        return installer as T;
                    case IInterpreterPathService:
                        return interpreterPathService as T;
                    case IInterpreterService:
                        return interpreterService as T;
                    case ILanguageServerOutputChannel:
                        return outputChannel as T;
                    case IWorkspaceService:
                        return workspaceService as T;
                    case IPythonExecutionFactory:
                        return pythonExecutionFactory as T;
                    default:
                        return undefined as T;
                }
            },
        });

        kernelSpec = mock<JupyterKernelSpec>({ env: {} });

        kernel = mock<JupyterLanguageRuntimeSession>({
            execute: () => {},
            onDidChangeRuntimeState: () => ({ dispose() {} }),
            onDidReceiveRuntimeMessage: () => ({ dispose() {} }),
            onDidEndSession: () => ({ dispose() {} }),
            onDidUpdateResourceUsage: () => ({ dispose() {} }),
            start: () => Promise.resolve({} as positron.LanguageRuntimeInfo),
        });

        const adapterApi = mock<PositronSupervisorApi>({
            createSession: sinon.stub().resolves(kernel),
            restoreSession: sinon.stub().resolves(kernel),
        });

        sinon.stub(vscode.extensions, 'getExtension').callsFake((extensionId) => {
            if (extensionId === 'positron.positron-supervisor') {
                return {
                    id: '',
                    extensionPath: '',
                    extensionKind: vscode.ExtensionKind.UI,
                    isActive: true,
                    packageJSON: {},
                    exports: adapterApi,
                    extensionUri: vscode.Uri.parse(''),
                    activate: () => Promise.resolve(adapterApi),
                };
            }
            return undefined;
        });

        const nullConfig = mock<vscode.WorkspaceConfiguration>({
            get: () => undefined,
        });
        vscode.workspace.getConfiguration = () => nullConfig;

        // Stub fs.pathExists so getIpykernelBundle returns valid bundle paths
        pathExistsStub = sinon.stub(fs, 'pathExists').resolves(true);
    });

    function createSession(
        sessionMode: positron.LanguageRuntimeSessionMode,
        ipykernelBundle: IpykernelBundle = {},
    ): PythonRuntimeSession {
        const runtimeMetadata = mock<positron.LanguageRuntimeMetadata>({
            extraRuntimeData: { pythonPath: interpreter.path, ipykernelBundle },
        });
        const metadata = mock<positron.RuntimeSessionMetadata>({ sessionMode });
        return new PythonRuntimeSession(runtimeMetadata, metadata, serviceContainer, kernelSpec);
    }

    teardown(() => {
        disposables.forEach((disposable) => disposable.dispose());
        sinon.restore();
    });

    test('Start: updates the active interpreter with Global target when no workspace is opened', async () => {
        // workspaceService.workspaceFolders is undefined in the test setup -> Global target.
        const target = sinon.spy(interpreterPathService, 'update');

        const session = createSession(positron.LanguageRuntimeSessionMode.Console);
        await session.start();

        sinon.assert.calledOnceWithExactly(
            target,
            undefined,
            vscode.ConfigurationTarget.Global,
            interpreter.path,
            // Session start is a storage-only fire: the session is already starting here, so the
            // PythonRuntimeManager listener must not start another one.
            { startSession: false, source: 'positron-session-start' },
        );
    });

    test('Start: does not update the active interpreter for notebook sessions', async () => {
        const target = sinon.spy(interpreterPathService, 'update');

        const session = createSession(positron.LanguageRuntimeSessionMode.Notebook);
        await session.start();

        sinon.assert.notCalled(target);
    });

    test('Start: bundle ipykernel if enabled', async () => {
        // Start a console session - getIpykernelBundle is called fresh to compute bundle paths
        const session = createSession(positron.LanguageRuntimeSessionMode.Console);
        await session.start();

        // Should not try to use ipykernel from the environment.
        sinon.assert.notCalled(installerSpy.isProductVersionCompatible);

        // Ipykernel bundles should be added to the PYTHONPATH (3 paths: cpx, cp3, py3).
        sinon.assert.callCount(envVarsServiceSpy.appendPythonPath, 3);
    });

    test('Start: dont bundle ipykernel if disabled', async () => {
        // Change pathExists stub to return false so getIpykernelBundle returns disabled
        pathExistsStub.resolves(false);

        const session = createSession(positron.LanguageRuntimeSessionMode.Console);
        await session.start();

        // PYTHONPATH should be unchanged since bundle paths don't exist.
        sinon.assert.notCalled(envVarsServiceSpy.appendPythonPath);

        // Should try to use ipykernel from the environment.
        sinon.assert.called(installerSpy.isProductVersionCompatible);
    });

    test('Start: custom launchers without embedded interpreter information use the project kernel', async () => {
        kernelSpec.startKernel = async () => {};
        const session = createSession(positron.LanguageRuntimeSessionMode.Console, { paths: ['/previous/bundle'] });
        await session.start();
        assert.strictEqual(session.runtimeMetadata.extraRuntimeData.ipykernelBundle.paths, undefined);
        sinon.assert.notCalled(envVarsServiceSpy.appendPythonPath);
        sinon.assert.calledOnce(installerSpy.isProductVersionCompatible);
    });

    for (const { enabled, minor, architecture, expectedArchitecture } of [
        { enabled: true, minor: 14, architecture: 'arm64', expectedArchitecture: Architecture.arm64 },
        { enabled: true, minor: 12, architecture: 'x64', expectedArchitecture: Architecture.x64 },
        { enabled: false, minor: 14, architecture: 'arm64', expectedArchitecture: undefined },
        { enabled: true, minor: 15, architecture: 'arm64', expectedArchitecture: undefined },
        { enabled: true, minor: 14, architecture: 'i686', expectedArchitecture: undefined },
    ]) {
        test(`Start: embedded Python 3.${minor} ${architecture}, bundle enabled=${enabled}`, async () => {
            useBundledIpykernel = enabled;
            kernelSpec.startKernel = async () => {};
            const session = createSession(positron.LanguageRuntimeSessionMode.Console);
            session.runtimeMetadata.extraRuntimeData.embeddedInterpreter = {
                version: { major: 3, minor },
                implementation: 'cpython',
                architecture,
            };
            await session.start();

            const bundle = session.runtimeMetadata.extraRuntimeData.ipykernelBundle;
            const bundled = expectedArchitecture !== undefined;
            assert.deepStrictEqual(
                {
                    architecture: bundle.architecture,
                    version: bundle.paths && path.basename(bundle.paths[0]),
                    appendedPaths: envVarsServiceSpy.appendPythonPath.callCount,
                    checkedProjectKernel: installerSpy.isProductVersionCompatible.callCount,
                },
                {
                    architecture: expectedArchitecture,
                    version: bundled ? `cp3${minor}` : undefined,
                    appendedPaths: bundled ? 3 : 0,
                    checkedProjectKernel: bundled ? 0 : 1,
                },
            );
            sinon.assert.notCalled(installerSpy.promptToInstall);
            sinon.assert.notCalled(executionFactorySpy.create);
        });
    }

    suite('Reticulate runtime manager', () => {
        teardown(() => {
            reset(mockedVSCodeNamespaces.window);
            reset(mockedVSCodeNamespaces.workspace);
            reset(mockedPositronNamespaces.window);
        });

        test('forwards bundle paths and refreshes interpreter metadata on restart', async () => {
            const rState = new vscode.EventEmitter<positron.RuntimeState>();
            const pythonState = new vscode.EventEmitter<positron.RuntimeState>();
            const pythonExit = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
            disposables.push(rState, pythonState, pythonExit);
            const firstInterpreter = {
                version: { major: 3, minor: 14 },
                implementation: 'cpython',
                architecture: 'arm64',
            };
            const nextInterpreter = {
                version: { major: 3, minor: 12 },
                implementation: 'cpython',
                architecture: 'x86_64',
            };
            const callMethod = sinon.stub();
            callMethod.withArgs('reticulate_id').resolves('reticulate-id');
            callMethod.withArgs('is_installed').resolves(true);
            callMethod
                .withArgs('reticulate_check_prerequisites')
                .onFirstCall()
                .resolves({
                    python: '/project/python',
                    venv: '/project',
                    embeddedInterpreter: firstInterpreter,
                })
                .onSecondCall()
                .resolves({
                    python: '/other/python',
                    venv: '/other',
                    embeddedInterpreter: nextInterpreter,
                });
            callMethod.withArgs('reticulate_start_kernel').resolves('');
            const rSession = mock<positron.LanguageRuntimeSession>({
                runtimeMetadata: mock<positron.LanguageRuntimeMetadata>({ languageId: 'r' }),
                metadata: mock<positron.RuntimeSessionMetadata>({ sessionId: 'r-session' }),
                callMethod,
                onDidChangeRuntimeState: rState.event,
                restart: async () => {
                    rState.fire(positron.RuntimeState.Ready);
                },
            });
            const registration = { dispose() {} };
            sinon
                .stub(require('positron'), 'runtime')
                .value(Object.assign(Object.create(positron.runtime), { getActiveSessions: async () => [rSession] }));
            when(mockedVSCodeNamespaces.workspace!.onDidChangeConfiguration(anything())).thenReturn(registration);
            when(mockedVSCodeNamespaces.window!.createOutputChannel(anything(), anything())).thenReturn(
                mock<vscode.LogOutputChannel>({ info() {} }),
            );
            when(mockedVSCodeNamespaces.window!.withProgress(anything(), anything())).thenCall((_options, task) =>
                task({ report() {} }, {}),
            );
            const prompts = mockedPositronNamespaces.window!;
            when(prompts.showSimpleModalDialogPrompt(anything(), anything(), anything(), anything())).thenReturn(
                Promise.resolve(true),
            );

            const connection = mock<JupyterSession>({
                state: { connectionFile: '/connection.json', logFile: '/kernel.log' } as JupyterSession['state'],
            });
            const connect = sinon.stub().resolves();
            const jupyterKernel = mock<JupyterKernel>({ log() {}, connectToSession: connect });
            let bundlePaths = ['/bundle/cp314', '/bundle/arm64/cp3', '/bundle/py3'];
            let started = createDeferred();
            const createPythonSession = sinon.spy(
                (
                    runtimeMetadata: positron.LanguageRuntimeMetadata,
                    metadata: positron.RuntimeSessionMetadata,
                    spec: JupyterKernelSpec,
                ) =>
                    mock<positron.LanguageRuntimeSession>({
                        runtimeMetadata,
                        metadata,
                        onDidChangeRuntimeState: pythonState.event,
                        onDidReceiveRuntimeMessage: () => registration,
                        onDidEndSession: pythonExit.event,
                        onDidUpdateResourceUsage: () => registration,
                        start: async () => {
                            runtimeMetadata.extraRuntimeData.ipykernelBundle = { paths: bundlePaths };
                            await spec.startKernel!(connection, jupyterKernel);
                            pythonState.fire(positron.RuntimeState.Ready);
                            started.resolve();
                            return mock<positron.LanguageRuntimeInfo>({});
                        },
                        shutdown: async () => {
                            pythonExit.fire(mock<positron.LanguageRuntimeExit>({}));
                        },
                    }),
            );
            (vscode.extensions.getExtension as sinon.SinonStub).withArgs('ms-python.python').returns({
                isActive: true,
                exports: { positron: { createPythonRuntimeSession: createPythonSession } },
            });
            // The reticulate extension is outside the Python extension's compilation tree.
            require('ts-node').register({
                project: path.join(__dirname, '../../../../positron-reticulate/tsconfig.json'),
                transpileOnly: true,
                scope: true,
            });
            const { ReticulateRuntimeManager } = require('../../../../positron-reticulate/src/extension');
            const manager: positron.LanguageRuntimeManager = new ReticulateRuntimeManager(
                mock<vscode.ExtensionContext>({
                    subscriptions: disposables,
                    workspaceState: new MockMemento(),
                }),
            );
            const session: positron.LanguageRuntimeSession = await manager.createSession(
                mock<positron.LanguageRuntimeMetadata>({
                    extraRuntimeData: { ipykernelBundle: {}, externallyManaged: true },
                }),
                mock<positron.RuntimeSessionMetadata>({ sessionId: 'python-session' }),
            );
            await session.start();
            const firstPaths = bundlePaths;
            bundlePaths = [];
            started = createDeferred();
            await session.restart(undefined);
            await started.promise;

            assert.deepStrictEqual(
                createPythonSession.args.map(([metadata]) => [
                    metadata.runtimePath,
                    metadata.extraRuntimeData.pythonPath,
                    metadata.extraRuntimeData.embeddedInterpreter,
                ]),
                [
                    ['/project/python', '/project/python', firstInterpreter],
                    ['/other/python', '/other/python', nextInterpreter],
                ],
            );
            assert.deepStrictEqual(
                callMethod
                    .withArgs('reticulate_start_kernel')
                    .args.map((args) => [path.basename(args[1]), ...args.slice(2)]),
                [
                    ['positron_language_server.py', '/connection.json', '/kernel.log', 'debug', firstPaths],
                    ['positron_language_server.py', '/connection.json', '/kernel.log', 'debug'],
                ],
            );
            sinon.assert.calledTwice(connect);
        });
    });

    test('Start: retries interpreter resolution after a refresh when the first resolve fails', async () => {
        const getDetails = sinon.stub(interpreterService, 'getInterpreterDetails');
        getDetails.onFirstCall().resolves(undefined);
        getDetails.onSecondCall().resolves(interpreter);
        const triggerRefresh = sinon.spy(interpreterService, 'triggerRefresh');

        const session = createSession(positron.LanguageRuntimeSessionMode.Console);
        await session.start();

        sinon.assert.calledOnce(triggerRefresh);
        sinon.assert.calledTwice(getDetails);
    });

    test('Start: throws when the interpreter cannot be resolved after a refresh', async () => {
        sinon.stub(interpreterService, 'getInterpreterDetails').resolves(undefined);
        sinon.stub(interpreterService, 'triggerRefresh').resolves();

        const session = createSession(positron.LanguageRuntimeSessionMode.Console);
        await assert.rejects(() => session.start(), /failed to resolve interpreter/);
    });

    test('Execute: dont uninstall bundled packages', async () => {
        // Stub fs.readdirSync to return 'ipykernel' for any path - getIpykernelBundle computes actual paths
        sinon.stub(fs, 'readdirSync').returns(['ipykernel']);

        const session = createSession(positron.LanguageRuntimeSessionMode.Console);
        await session.start();

        // Spy on the kernel execute method.
        const executeSpy = sinon.spy(kernel, 'execute');

        // Record emitted runtime messages.
        const messages: positron.LanguageRuntimeMessage[] = [];
        disposables.push(session.onDidReceiveRuntimeMessage((message) => messages.push(message)));

        // Execute a command that tries to uninstall a bundled package.
        const id = 'execute-id';
        session.execute(
            'pip uninstall ipykernel',
            id,
            positron.RuntimeCodeExecutionMode.Interactive,
            positron.RuntimeErrorBehavior.Stop,
        );

        // Should not execute the command.
        sinon.assert.notCalled(executeSpy);

        // Should display a message and end the execution (via state: idle).
        assert.strictEqual(messages.length, 2);
        assert.strictEqual(messages[0].type, positron.LanguageRuntimeMessageType.Stream);
        const stream = messages[0] as positron.LanguageRuntimeStream;
        assert.ok(stream.text.startsWith('Cannot uninstall'));
        assert.strictEqual(messages[1].type, positron.LanguageRuntimeMessageType.State);
        const state = messages[1] as positron.LanguageRuntimeState;
        assert.strictEqual(state.state, positron.RuntimeOnlineState.Idle);
    });

    test('Restore: keeps bundled packages protected from uninstall commands', async () => {
        sinon.stub(fs, 'readdirSync').returns(['ipykernel']);
        const original = createSession(positron.LanguageRuntimeSessionMode.Console);
        await original.start();

        const savedMetadata = JSON.parse(JSON.stringify(original.runtimeMetadata));
        const restored = new PythonRuntimeSession(savedMetadata, original.metadata, serviceContainer);
        await restored.start();
        const execute = sinon.spy(kernel, 'execute');
        restored.execute(
            'pip uninstall ipykernel',
            'uninstall-after-restore',
            positron.RuntimeCodeExecutionMode.Interactive,
            positron.RuntimeErrorBehavior.Stop,
        );
        sinon.assert.notCalled(execute);
    });

    test('Execute: propagates the kernel execute promise (e.g. incomplete code)', async () => {
        sinon.stub(fs, 'readdirSync').returns(['ipykernel']);

        const session = createSession(positron.LanguageRuntimeSessionMode.Console);
        await session.start();

        // For Unprocessed code the supervisor checks completeness itself and
        // rejects with a CodeIncompleteError when the code is incomplete. That
        // rejection must propagate back through execute() so the console can
        // show a continuation prompt instead of hanging forever.
        const incompleteError = new Error('Code fragment is incomplete');
        incompleteError.name = 'CodeIncompleteError';
        sinon.stub(kernel, 'execute').rejects(incompleteError);

        await assert.rejects(
            Promise.resolve(
                session.execute(
                    'def f():',
                    'execute-id',
                    positron.RuntimeCodeExecutionMode.Unprocessed,
                    positron.RuntimeErrorBehavior.Continue,
                ),
            ),
            (err: Error) => err.name === 'CodeIncompleteError',
        );
    });
});
