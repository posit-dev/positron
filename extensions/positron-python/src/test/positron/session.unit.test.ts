/* eslint-disable @typescript-eslint/no-empty-function */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ILanguageServerOutputChannel } from '../../client/activation/types';
import { IWorkspaceService } from '../../client/common/application/types';
import {
    IConfigurationService,
    IInstaller,
    IInterpreterPathService,
    InstallerResponse,
    IPythonSettings,
    ProductInstallStatus,
} from '../../client/common/types';
import { IEnvironmentVariablesProvider } from '../../client/common/variables/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterLanguageRuntimeSession } from '../../client/jupyter-adapter.d';
import { PythonRuntimeSession } from '../../client/positron/session';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';

suite('Python Runtime Session', () => {
    let runtimeMetadata: positron.LanguageRuntimeMetadata;
    let interpreterPathService: IInterpreterPathService;
    let interpreter: PythonEnvironment;
    let serviceContainer: IServiceContainer;
    let kernelSpec: JupyterKernelSpec;
    let consoleSession: positron.LanguageRuntimeSession;
    let notebookSession: positron.LanguageRuntimeSession;

    setup(() => {
        interpreterPathService = ({
            update: () => Promise.resolve(),
        } as Partial<IInterpreterPathService>) as IInterpreterPathService;

        interpreter = {
            id: 'pythonEnvironmentId',
            path: '/path/to/python',
        } as PythonEnvironment;

        runtimeMetadata = {
            extraRuntimeData: { pythonEnvironmentId: interpreter.id },
        } as positron.LanguageRuntimeMetadata;

        const interpreterService = {
            getInterpreters: () => [interpreter],
        } as IInterpreterService;

        const installer = ({
            isInstalled: () => Promise.resolve(true),
            promptToInstall: () => Promise.resolve(InstallerResponse.Installed),
            isProductVersionCompatible: () => Promise.resolve(ProductInstallStatus.Installed),
        } as Partial<IInstaller>) as IInstaller;

        const outputChannel = {} as ILanguageServerOutputChannel;

        const workspaceService = ({
            workspaceFolders: undefined,
            getWorkspaceFolder: () => undefined,
        } as Partial<IWorkspaceService>) as IWorkspaceService;

        const pythonSettings = ({ autoComplete: { extraPaths: [] } } as Partial<IPythonSettings>) as IPythonSettings;

        const configService = {
            getSettings: () => pythonSettings,
        } as IConfigurationService;

        const envVarsProvider = ({
            onDidEnvironmentVariablesChange: () => ({ dispose() {} }),
        } as Partial<IEnvironmentVariablesProvider>) as IEnvironmentVariablesProvider;

        serviceContainer = {
            get: (serviceIdentifier) => {
                switch (serviceIdentifier) {
                    case IInterpreterService:
                        return interpreterService;
                    case IInterpreterPathService:
                        return interpreterPathService;
                    case IInstaller:
                        return installer;
                    case ILanguageServerOutputChannel:
                        return outputChannel;
                    case IWorkspaceService:
                        return workspaceService;
                    case IEnvironmentVariablesProvider:
                        return envVarsProvider;
                    case IConfigurationService:
                        return configService;
                    default:
                        return undefined;
                }
            },
        } as IServiceContainer;

        kernelSpec = {} as JupyterKernelSpec;

        const kernel = ({
            onDidChangeRuntimeState: () => ({ dispose() {} }),
            onDidReceiveRuntimeMessage: () => ({ dispose() {} }),
            onDidEndSession: () => ({ dispose() {} }),
            start() {
                return Promise.resolve();
            },
        } as Partial<JupyterLanguageRuntimeSession>) as JupyterLanguageRuntimeSession;

        const adapterApi = ({
            createSession: sinon.stub().resolves(kernel),
        } as Partial<JupyterAdapterApi>) as JupyterAdapterApi;

        sinon.stub(vscode.extensions, 'getExtension').callsFake((extensionId) => {
            if (extensionId === 'vscode.kallichore-adapter' || extensionId === 'vscode.jupyter-adapter') {
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

        const nullConfig = ({ get: () => undefined } as Partial<
            vscode.WorkspaceConfiguration
        >) as vscode.WorkspaceConfiguration;
        vscode.workspace.getConfiguration = () => nullConfig;

        const consoleMetadata = {
            sessionMode: positron.LanguageRuntimeSessionMode.Console,
        } as positron.RuntimeSessionMetadata;
        consoleSession = new PythonRuntimeSession(runtimeMetadata, consoleMetadata, serviceContainer, kernelSpec);

        const notebookMetadata = {
            sessionMode: positron.LanguageRuntimeSessionMode.Notebook,
        } as positron.RuntimeSessionMetadata;
        notebookSession = new PythonRuntimeSession(runtimeMetadata, notebookMetadata, serviceContainer, kernelSpec);
    });

    teardown(() => {
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
});
