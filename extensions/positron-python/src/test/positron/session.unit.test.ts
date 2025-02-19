/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-empty-function */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { interfaces } from 'inversify';
import * as os from 'os';
import * as path from 'path';
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
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../../client/common/variables/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import {
    PositronSupervisorApi,
    JupyterKernelSpec,
    JupyterLanguageRuntimeSession,
} from '../../client/positron-supervisor.d';
import { PythonRuntimeSession } from '../../client/positron/session';
import { InterpreterInformation, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../client/common/process/types';
import { PythonVersion } from '../../client/pythonEnvironments/info/pythonVersion';
import { mock } from './utils';
import { EXTENSION_ROOT_DIR } from '../../client/constants';

suite('Python Runtime Session', () => {
    let disposables: vscode.Disposable[];
    let applicationShell: IApplicationShell;
    let runtimeMetadata: positron.LanguageRuntimeMetadata;
    let installerSpy: sinon.SinonSpiedInstance<IInstaller>;
    let interpreterPathService: IInterpreterPathService;
    let workspaceConfiguration: vscode.WorkspaceConfiguration;
    let envVarsServiceSpy: sinon.SinonSpiedInstance<IEnvironmentVariablesService>;
    let pythonExecutionService: IPythonExecutionService;
    let interpreter: PythonEnvironment;
    let serviceContainer: IServiceContainer;
    let kernelSpec: JupyterKernelSpec;
    let kernel: JupyterLanguageRuntimeSession;
    let consoleSession: positron.LanguageRuntimeSession;
    let notebookSession: positron.LanguageRuntimeSession;

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
            version: mock<PythonVersion>({ major: 3, minor: 8 }),
        });

        runtimeMetadata = mock<positron.LanguageRuntimeMetadata>({
            extraRuntimeData: { pythonPath: interpreter.path },
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

        workspaceConfiguration = mock<vscode.WorkspaceConfiguration>({
            get: (section) => (section === 'useBundledIpykernel' ? true : undefined),
        });
        const workspaceService = mock<IWorkspaceService>({
            workspaceFolders: undefined,
            getWorkspaceFolder: () => undefined,
            getConfiguration: () => workspaceConfiguration,
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

        pythonExecutionService = mock<IPythonExecutionService>({
            getInterpreterInformation: () =>
                Promise.resolve(
                    mock<InterpreterInformation>({ implementation: 'cpython', version: interpreter.version }),
                ),
        });

        const pythonExecutionFactory = mock<IPythonExecutionFactory>({
            create: () => Promise.resolve(pythonExecutionService),
        });

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
                    case IPythonExecutionFactory:
                        return pythonExecutionFactory as T;
                    case IWorkspaceService:
                        return workspaceService as T;
                    default:
                        return undefined as T;
                }
            },
        });

        kernelSpec = mock<JupyterKernelSpec>({ env: {} });

        kernel = mock<JupyterLanguageRuntimeSession>({
            execute: () => { },
            onDidChangeRuntimeState: () => ({ dispose() {} }),
            onDidReceiveRuntimeMessage: () => ({ dispose() {} }),
            onDidEndSession: () => ({ dispose() {} }),
            start: () => Promise.resolve({} as positron.LanguageRuntimeInfo,
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

        const consoleMetadata = mock<positron.RuntimeSessionMetadata>({
            sessionMode: positron.LanguageRuntimeSessionMode.Console,
        });
        consoleSession = new PythonRuntimeSession(runtimeMetadata, consoleMetadata, serviceContainer, kernelSpec);

        const notebookMetadata = mock<positron.RuntimeSessionMetadata>({
            sessionMode: positron.LanguageRuntimeSessionMode.Notebook,
        });
        notebookSession = new PythonRuntimeSession(runtimeMetadata, notebookMetadata, serviceContainer, kernelSpec);
    });

    teardown(() => {
        disposables.forEach((disposable) => disposable.dispose());
        sinon.restore();
    });

    test('Start: updates the active interpreter for console sessions', async () => {
        const target = sinon.spy(interpreterPathService, 'update');

        await consoleSession.start();

        sinon.assert.calledOnceWithExactly(
            target,
            undefined,
            vscode.ConfigurationTarget.WorkspaceFolder,
            interpreter.path,
        );
    });

    test('Start: does not update the active interpreter for notebook sessions', async () => {
        const target = sinon.spy(interpreterPathService, 'update');

        await notebookSession.start();

        sinon.assert.notCalled(target);
    });

    test('Start: bundle ipykernel', async () => {
        // Start a console session.
        await consoleSession.start();

        // Should not try to use ipykernel from the environment.
        sinon.assert.notCalled(installerSpy.isProductVersionCompatible);

        // Ipykernel bundles should be added to the PYTHONPATH.
        sinon.assert.callCount(envVarsServiceSpy.appendPythonPath, 3);
        const arch = os.arch();
        assert.deepStrictEqual(envVarsServiceSpy.appendPythonPath.args[0], [
            kernelSpec.env,
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', arch, 'cp38'),
        ]);
        assert.deepStrictEqual(envVarsServiceSpy.appendPythonPath.args[1], [
            kernelSpec.env,
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', arch, 'cp3'),
        ]);
        assert.deepStrictEqual(envVarsServiceSpy.appendPythonPath.args[2], [
            kernelSpec.env,
            path.join(EXTENSION_ROOT_DIR, 'python_files', 'lib', 'ipykernel', 'py3'),
        ]);
    });

    test('Start: dont bundle ipykernel if setting is disabled', async () => {
        // Disable ipykernel bundling.
        sinon.stub(workspaceConfiguration, 'get').withArgs('useBundledIpykernel').returns(false);

        // Start a console session.
        await consoleSession.start();

        // PYTHONPATH should be unchanged.
        sinon.assert.notCalled(envVarsServiceSpy.appendPythonPath);

        // Should try to use ipykernel from the environment.
        sinon.assert.called(installerSpy.isProductVersionCompatible);
    });

    test('Start: dont bundle ipykernel if version is incompatible', async () => {
        // Stub the interpreter version to be incompatible.
        sinon.stub(interpreter, 'version').get(() => mock<PythonVersion>({ major: 2, minor: 7 }));

        // Start a console session.
        await consoleSession.start();

        // PYTHONPATH should be unchanged.
        sinon.assert.notCalled(envVarsServiceSpy.appendPythonPath);

        // Should try to use ipykernel from the environment.
        sinon.assert.called(installerSpy.isProductVersionCompatible);
    });

    test('Start: dont bundle ipykernel if implementation is incompatible', async () => {
        // Stub the interpreter implementation to be incompatible.
        sinon.stub(pythonExecutionService, 'getInterpreterInformation').resolves(
            mock<InterpreterInformation>({ implementation: 'not_cpython', version: interpreter.version }),
        );

        // Start a console session.
        await consoleSession.start();

        // PYTHONPATH should be unchanged.
        sinon.assert.notCalled(envVarsServiceSpy.appendPythonPath);

        // Should try to use ipykernel from the environment.
        sinon.assert.called(installerSpy.isProductVersionCompatible);
    });

    test('Start: dont bundle if bundle path does not exist', async () => {
        // Simulate the bundle paths not existing.
        sinon.stub(fs, 'pathExists').resolves(false);

        // Start a console session.
        await consoleSession.start();

        // PYTHONPATH should be unchanged.
        sinon.assert.notCalled(envVarsServiceSpy.appendPythonPath);

        // Should try to use ipykernel from the environment.
        sinon.assert.called(installerSpy.isProductVersionCompatible);
    });

    test('Execute: dont uninstall bundled packages', async () => {
        // Start a console session.
        await consoleSession.start();

        // Spy on the kernel execute method.
        const executeSpy = sinon.spy(kernel, 'execute');

        // Record emitted runtime messages.
        const messages: positron.LanguageRuntimeMessage[] = [];
        disposables.push(consoleSession.onDidReceiveRuntimeMessage(message => messages.push(message)));

        // Execute a command that tries to uninstall a bundled package.
        const id = 'execute-id';
        consoleSession.execute(
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
