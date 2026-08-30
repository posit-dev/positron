// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Start Positron ---
/* eslint-disable import/no-duplicates */
/* eslint-disable import/order */
// --- End Positron ---

import * as chaiAsPromised from 'chai-as-promised';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { assert, use as chaiUse } from 'chai';
import { ConfigurationTarget, Uri } from 'vscode';
import { IDisposableRegistry, IPathUtils } from '../../../client/common/types';
import * as commandApis from '../../../client/common/vscodeApis/commandApis';
import {
    IInterpreterQuickPick,
    IPythonPathUpdaterServiceManager,
} from '../../../client/interpreter/configuration/types';
import { registerCreateEnvironmentFeatures } from '../../../client/pythonEnvironments/creation/createEnvApi';
import * as windowApis from '../../../client/common/vscodeApis/windowApis';
import { handleCreateEnvironmentCommand } from '../../../client/pythonEnvironments/creation/createEnvironment';
import {
    CreateEnvironmentProvider,
    // --- Start Positron ---
    CreateEnvironmentOptions,
    CreateEnvironmentResult,
    // --- End Positron ---
} from '../../../client/pythonEnvironments/creation/proposed.createEnvApis';

// --- Start Positron ---
import { WorkspaceConfiguration } from 'vscode';
import * as workspaceApis from '../../../client/common/vscodeApis/workspaceApis';
import { IPythonRuntimeManager } from '../../../client/positron/manager';
import { capture, when } from 'ts-mockito';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { mockedPositronNamespaces } from '../../vscode-mock';
import { Commands } from '../../../client/common/constants';
import * as uvUtils from '../../../client/pythonEnvironments/creation/provider/uvUtils';
import * as uvPythonInstaller from '../../../client/pythonEnvironments/common/environmentManagers/uvPythonInstaller';
import * as globalEnvironment from '../../../client/pythonEnvironments/common/environmentManagers/globalEnvironment';
import * as uv from '../../../client/pythonEnvironments/common/environmentManagers/uv';
import { UV_PROVIDER_ID } from '../../../client/pythonEnvironments/creation/provider/uvCreationProvider';
import { CONDA_PROVIDER_ID } from '../../../client/pythonEnvironments/creation/provider/condaCreationProvider';
import { CreateEnvironmentOptionsInternal } from '../../../client/pythonEnvironments/creation/types';
// --- End Positron ---

chaiUse(chaiAsPromised.default);

suite('Create Environment APIs', () => {
    let registerCommandStub: sinon.SinonStub;
    let showQuickPickStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    const disposables: IDisposableRegistry = [];
    let interpreterQuickPick: typemoq.IMock<IInterpreterQuickPick>;
    let interpreterPathService: typemoq.IMock<IPythonPathUpdaterServiceManager>;
    let pathUtils: typemoq.IMock<IPathUtils>;
    // --- Start Positron ---
    let getConfigurationStub: sinon.SinonStub;
    let workspaceConfig: typemoq.IMock<WorkspaceConfiguration>;
    let pythonRuntimeManager: typemoq.IMock<IPythonRuntimeManager>;
    // --- End Positron ---

    // --- Start Positron ---
    setup(async () => {
        // --- End Positron ---
        showQuickPickStub = sinon.stub(windowApis, 'showQuickPick');
        showInformationMessageStub = sinon.stub(windowApis, 'showInformationMessage');

        registerCommandStub = sinon.stub(commandApis, 'registerCommand');
        interpreterQuickPick = typemoq.Mock.ofType<IInterpreterQuickPick>();
        interpreterPathService = typemoq.Mock.ofType<IPythonPathUpdaterServiceManager>();
        pathUtils = typemoq.Mock.ofType<IPathUtils>();
        // --- Start Positron ---
        pythonRuntimeManager = typemoq.Mock.ofType<IPythonRuntimeManager>();
        workspaceConfig = typemoq.Mock.ofType<WorkspaceConfiguration>();

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake((section?: string) => {
            if (section === 'python') {
                return workspaceConfig.object;
            }
            return undefined;
        });
        // --- End Positron ---

        registerCommandStub.callsFake((_command: string, _callback: (...args: any[]) => any) => ({
            dispose: () => {
                // Do nothing
            },
        }));

        pathUtils.setup((p) => p.getDisplayName(typemoq.It.isAny())).returns(() => 'test');

        // --- Start Positron ---
        await registerCreateEnvironmentFeatures(
            // --- End Positron ---
            disposables,
            interpreterQuickPick.object,
            interpreterPathService.object,
            pathUtils.object,
            // --- Start Positron ---
            pythonRuntimeManager.object,
            // --- End Positron ---
        );
    });
    teardown(() => {
        disposables.forEach((d) => d.dispose());
        sinon.restore();
    });

    [true, false].forEach((selectEnvironment) => {
        test(`Set environment selectEnvironment == ${selectEnvironment}`, async () => {
            const workspace1 = {
                uri: Uri.file('/path/to/env'),
                name: 'workspace1',
                index: 0,
            };
            const provider = typemoq.Mock.ofType<CreateEnvironmentProvider>();
            provider.setup((p) => p.name).returns(() => 'test');
            provider.setup((p) => p.id).returns(() => 'test-id');
            provider.setup((p) => p.description).returns(() => 'test-description');
            provider
                .setup((p) => p.createEnvironment(typemoq.It.isAny()))
                .returns(() =>
                    Promise.resolve({
                        path: '/path/to/env',
                        workspaceFolder: workspace1,
                        action: undefined,
                        error: undefined,
                    }),
                );
            provider.setup((p) => (p as any).then).returns(() => undefined);

            showQuickPickStub.resolves(provider.object);

            interpreterPathService
                .setup((p) =>
                    p.updatePythonPath(
                        typemoq.It.isValue('/path/to/env'),
                        ConfigurationTarget.WorkspaceFolder,
                        'ui',
                        typemoq.It.isAny(),
                    ),
                )
                .returns(() => Promise.resolve())
                .verifiable(selectEnvironment ? typemoq.Times.once() : typemoq.Times.never());

            await handleCreateEnvironmentCommand([provider.object], { selectEnvironment });

            assert.ok(showQuickPickStub.calledOnce);
            assert.ok(selectEnvironment ? showInformationMessageStub.calledOnce : showInformationMessageStub.notCalled);
            interpreterPathService.verifyAll();
        });
    });

    // --- Start Positron ---
    suite('Runtime picker contribution', () => {
        let executeCommandStub: sinon.SinonStub;

        setup(() => {
            executeCommandStub = sinon.stub(commandApis, 'executeCommand');
            executeCommandStub.resolves(undefined);
        });

        function capturedContribution(): positron.runtime.RuntimePickerContribution {
            // The outer setup() calls registerCreateEnvironmentFeatures, which registers
            // the contribution on the global positron mock; grab that registration.
            const [contribution] = capture(mockedPositronNamespaces.runtime!.registerRuntimePickerContribution).last();
            return contribution;
        }

        function stubRegisteredRuntimes(sources: string[]): void {
            const runtimes = sources.map(
                (runtimeSource, i) =>
                    ({
                        runtimeId: `runtime-${i}`,
                        languageId: 'python',
                        runtimeSource,
                    } as unknown as positron.LanguageRuntimeMetadata),
            );
            when(mockedPositronNamespaces.runtime!.getRegisteredRuntimes()).thenReturn(Promise.resolve(runtimes));
        }

        test('getItems shows only the uv install item when no Python runtimes exist', async () => {
            stubRegisteredRuntimes([]);

            const items = await capturedContribution().getItems();

            assert.deepEqual(
                items.map((item) => item.id),
                ['install-python-uv'],
            );
        });

        test('getItems shows only the uv install item when only system/global Pythons exist', async () => {
            stubRegisteredRuntimes(['System', 'Global']);

            const items = await capturedContribution().getItems();

            assert.deepEqual(
                items.map((item) => item.id),
                ['install-python-uv'],
            );
        });

        test('getItems shows only the create environment item when a non-system Python exists', async () => {
            stubRegisteredRuntimes(['System', 'Venv']);

            const items = await capturedContribution().getItems();

            assert.deepEqual(
                items.map((item) => ({ id: item.id, label: item.label, separatorLabel: item.separatorLabel })),
                [
                    {
                        id: 'create-python-env',
                        label: '$(add) Create Python Environment',
                        separatorLabel: 'Create Environment',
                    },
                ],
            );
        });

        test('onDidSelectItem create-python-env runs the Create Environment command', async () => {
            const result = await capturedContribution().onDidSelectItem('create-python-env');

            assert.ok(executeCommandStub.calledOnceWithExactly(Commands.Create_Environment));
            assert.strictEqual(result, undefined);
        });

        test('onDidSelectItem create-python-env resolves undefined when the command fails', async () => {
            executeCommandStub.rejects(new Error('create env failed'));

            const result = await capturedContribution().onDidSelectItem('create-python-env');

            assert.strictEqual(result, undefined);
        });
    });

    suite('Create Environment with no folder open', () => {
        let getWorkspaceFoldersStub: sinon.SinonStub;
        let getGlobalEnvironmentDirStub: sinon.SinonStub;
        let promptStub: sinon.SinonStub;
        let ensureUvInstalledStub: sinon.SinonStub;
        let pickPythonVersionStub: sinon.SinonStub;
        let createGlobalEnvironmentStub: sinon.SinonStub;
        let showUvInstallErrorStub: sinon.SinonStub;
        let getAvailablePythonVersionsStub: sinon.SinonStub;

        function runCommand(
            options?: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal,
        ): Promise<CreateEnvironmentResult | undefined> {
            const call = registerCommandStub.getCalls().find((c) => c.args[0] === Commands.Create_Environment);
            assert.ok(call, 'python.createEnvironment was not registered');
            return call!.args[1](options);
        }

        setup(() => {
            getWorkspaceFoldersStub = sinon.stub(workspaceApis, 'getWorkspaceFolders').returns(undefined);
            getGlobalEnvironmentDirStub = sinon
                .stub(globalEnvironment, 'getGlobalEnvironmentDir')
                .returns('/venvs/positron');
            promptStub = sinon.stub(globalEnvironment, 'promptForGlobalEnvironment').resolves('create');
            ensureUvInstalledStub = sinon.stub(uvPythonInstaller, 'ensureUvInstalled').resolves({ ok: true });
            pickPythonVersionStub = sinon.stub(uvUtils, 'pickPythonVersion').resolves('3.13');
            createGlobalEnvironmentStub = sinon.stub(globalEnvironment, 'createGlobalEnvironment').resolves({
                outcome: 'created',
                venvDir: '/venvs/positron',
                pythonPath: '/venvs/positron/bin/python',
            });
            showUvInstallErrorStub = sinon.stub(uvPythonInstaller, 'showUvInstallError').resolves();
            getAvailablePythonVersionsStub = sinon.stub(uv, 'getAvailablePythonVersions').resolves([
                { version: '3.14', isInstalled: false, identifier: 'cpython-3.14.0' },
                { version: '3.13', isInstalled: true, identifier: 'cpython-3.13.1' },
            ]);
        });

        test('Offers the global environment instead of dead-ending', async () => {
            const result = await runCommand();

            assert.ok(promptStub.calledOnce);
            assert.deepStrictEqual(result, { path: '/venvs/positron/bin/python' });
        });

        test('Selects the environment it created', async () => {
            pythonRuntimeManager
                .setup((m) => m.selectLanguageRuntimeFromPath('/venvs/positron/bin/python', true))
                .returns(() => Promise.resolve('runtime-id'))
                .verifiable(typemoq.Times.once());

            await runCommand();

            pythonRuntimeManager.verifyAll();
        });

        test('Notifies without a folder-scoped interpreter update', async () => {
            await runCommand();

            assert.strictEqual(showInformationMessageStub.callCount, 1);
            interpreterPathService.verify(
                (p) =>
                    p.updatePythonPath(typemoq.It.isAny(), typemoq.It.isAny(), typemoq.It.isAny(), typemoq.It.isAny()),
                typemoq.Times.never(),
            );
        });

        test('Leaves the environment unselected when the caller opts out', async () => {
            const result = await runCommand({ selectEnvironment: false });

            assert.deepStrictEqual(result, { path: '/venvs/positron/bin/python' });
            pythonRuntimeManager.verify(
                (m) => m.selectLanguageRuntimeFromPath(typemoq.It.isAny(), typemoq.It.isAny()),
                typemoq.Times.never(),
            );
        });

        test('Builds from the version the user picked', async () => {
            pickPythonVersionStub.resolves('3.12');

            await runCommand();

            assert.ok(createGlobalEnvironmentStub.calledOnceWithExactly('3.12'));
        });

        test('Not Now creates nothing', async () => {
            promptStub.resolves('dismiss');

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('Open Folder creates nothing', async () => {
            promptStub.resolves('openFolder');

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(createGlobalEnvironmentStub.notCalled);
            assert.ok(ensureUvInstalledStub.notCalled);
        });

        test('Backing out of the version pick creates nothing', async () => {
            pickPythonVersionStub.resolves(undefined);

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('The Back button reopens the global environment prompt', async () => {
            pickPythonVersionStub.onFirstCall().callsFake(() => Promise.reject(windowApis.MultiStepAction.Back));
            promptStub.onSecondCall().resolves('dismiss');

            assert.strictEqual(await runCommand(), undefined);
            assert.strictEqual(promptStub.callCount, 2);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('Back followed by a version pick still creates the environment', async () => {
            pickPythonVersionStub.onFirstCall().callsFake(() => Promise.reject(windowApis.MultiStepAction.Back));
            pickPythonVersionStub.onSecondCall().resolves('3.12');

            assert.deepStrictEqual(await runCommand(), { path: '/venvs/positron/bin/python' });
            assert.ok(createGlobalEnvironmentStub.calledOnceWithExactly('3.12'));
        });

        test('Cancelling the version pick creates nothing', async () => {
            pickPythonVersionStub.callsFake(() => Promise.reject(windowApis.MultiStepAction.Cancel));

            assert.strictEqual(await runCommand(), undefined);
            assert.strictEqual(promptStub.callCount, 1);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('Declining the uv install creates nothing and says nothing', async () => {
            ensureUvInstalledStub.resolves({ ok: false });

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(createGlobalEnvironmentStub.notCalled);
            assert.ok(showUvInstallErrorStub.notCalled);
        });

        test('An unreachable uv is reported', async () => {
            ensureUvInstalledStub.resolves({ ok: false, error: 'uv is not on the PATH' });

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(showUvInstallErrorStub.calledOnceWithExactly('uv is not on the PATH'));
        });

        test('An occupied path is reported and nothing is selected', async () => {
            createGlobalEnvironmentStub.resolves({ outcome: 'occupied', venvDir: '/venvs/positron' });

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(
                showUvInstallErrorStub.calledOnceWithExactly(
                    globalEnvironment.globalEnvironmentErrorMessage({
                        outcome: 'occupied',
                        venvDir: '/venvs/positron',
                    }),
                ),
            );
        });

        test('With the uv provider disabled the interception does not fire', async () => {
            workspaceConfig
                .setup((c) => c.inspect<Record<string, boolean>>('environmentProviders.enabled'))
                .returns(() => ({ key: 'environmentProviders.enabled', workspaceValue: { venv: true, conda: true, uv: false } }));
            workspaceConfig
                .setup((c) => c.get<Record<string, boolean>>('environmentProviders.enabled'))
                .returns(() => ({ venv: true, conda: true, uv: false }));
            showQuickPickStub.resolves(undefined);

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(promptStub.notCalled);
            assert.ok(ensureUvInstalledStub.notCalled);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('With only the deprecated setting set, provider checks fall back to it', async () => {
            workspaceConfig
                .setup((c) => c.inspect<Record<string, boolean>>('environmentProviders.enabled'))
                .returns(() => undefined);
            workspaceConfig
                .setup((c) => c.inspect<Record<string, boolean>>('environmentProviders.enable'))
                .returns(() => ({ key: 'environmentProviders.enable', workspaceValue: { venv: true, conda: true, uv: false } }));
            workspaceConfig
                .setup((c) => c.get<Record<string, boolean>>('environmentProviders.enable'))
                .returns(() => ({ venv: true, conda: true, uv: false }));
            showQuickPickStub.resolves(undefined);

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(promptStub.notCalled);
            assert.ok(ensureUvInstalledStub.notCalled);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('A caller asking for uv gets the global environment', async () => {
            assert.deepStrictEqual(await runCommand({ providerId: UV_PROVIDER_ID }), {
                path: '/venvs/positron/bin/python',
            });
        });

        test('A caller asking for another provider does not get a uv environment', async () => {
            showQuickPickStub.resolves(undefined);

            assert.strictEqual(await runCommand({ providerId: CONDA_PROVIDER_ID }), undefined);
            assert.ok(promptStub.notCalled);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('A requested version is used without asking again', async () => {
            await runCommand({ uvPythonVersion: '3.11' });

            assert.ok(pickPythonVersionStub.notCalled);
            assert.ok(createGlobalEnvironmentStub.calledOnceWithExactly('3.11'));
        });

        test("A version of 'auto' builds from uv's newest version", async () => {
            await runCommand({ uvPythonVersion: 'auto' });

            assert.ok(pickPythonVersionStub.notCalled);
            assert.ok(createGlobalEnvironmentStub.calledOnceWithExactly('3.14'));
        });

        test("A version of 'auto' with nothing available creates nothing", async () => {
            getAvailablePythonVersionsStub.resolves([]);

            assert.strictEqual(await runCommand({ uvPythonVersion: 'auto' }), undefined);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('With nowhere to put the environment the interception does not fire', async () => {
            getGlobalEnvironmentDirStub.returns(undefined);
            showQuickPickStub.resolves(undefined);

            assert.strictEqual(await runCommand(), undefined);
            assert.ok(promptStub.notCalled);
            assert.ok(createGlobalEnvironmentStub.notCalled);
        });

        test('With a folder open the interception does not fire', async () => {
            getWorkspaceFoldersStub.returns([{ uri: Uri.file('/project'), name: 'project', index: 0 }]);
            showQuickPickStub.resolves(undefined);

            await runCommand();

            assert.ok(promptStub.notCalled);
        });
    });
    // --- End Positron ---
});
