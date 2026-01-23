/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-empty-function */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { interfaces } from 'inversify';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
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
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../../client/common/variables/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import {
    PositronSupervisorApi,
    JupyterKernelSpec,
    JupyterLanguageRuntimeSession,
} from '../../client/positron-supervisor.d';
import { PythonRuntimeSession } from '../../client/positron/session';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { PythonVersion } from '../../client/pythonEnvironments/info/pythonVersion';
import { mock } from './utils';
import { IpykernelBundle } from '../../client/positron/ipykernel';

suite('Python Runtime Session', () => {
    let disposables: vscode.Disposable[];
    let applicationShell: IApplicationShell;
    let installerSpy: sinon.SinonSpiedInstance<IInstaller>;
    let interpreterPathService: IInterpreterPathService;
    let envVarsServiceSpy: sinon.SinonSpiedInstance<IEnvironmentVariablesService>;
    let interpreter: PythonEnvironment;
    let serviceContainer: IServiceContainer;
    let kernelSpec: JupyterKernelSpec;
    let kernel: JupyterLanguageRuntimeSession;
    let pathExistsStub: sinon.SinonStub;

    setup(() => {
        disposables = [];

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

        const interpreterService = mock<IInterpreterService>({
            getInterpreterDetails: (_pythonPath, _resource) => Promise.resolve(interpreter),
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
            get: (section: string) => (section === 'useBundledIpykernel' ? true : undefined),
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

    test('Start: updates the active interpreter for console sessions', async () => {
        const target = sinon.spy(interpreterPathService, 'update');

        const session = createSession(positron.LanguageRuntimeSessionMode.Console);
        await session.start();

        sinon.assert.calledOnceWithExactly(
            target,
            undefined,
            vscode.ConfigurationTarget.WorkspaceFolder,
            interpreter.path,
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
});
