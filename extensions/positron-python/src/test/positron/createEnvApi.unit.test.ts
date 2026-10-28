/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chaiAsPromised from 'chai-as-promised';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { assert, use as chaiUse } from 'chai';
import { EventEmitter, Uri, WorkspaceConfiguration } from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as path from 'path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';
import * as commandApis from '../../client/common/vscodeApis/commandApis';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import * as createEnvironmentApis from '../../client/pythonEnvironments/creation/createEnvironment';
import { IDisposableRegistry, IPathUtils } from '../../client/common/types';
import {
    isCreatingEnvironment,
    registerCreateEnvironmentFeatures,
} from '../../client/pythonEnvironments/creation/createEnvApi';
import { CreateEnvironmentProvider } from '../../client/pythonEnvironments/creation/proposed.createEnvApis';
import { IPythonRuntimeManager } from '../../client/positron/manager';
import { IInterpreterQuickPick, IPythonPathUpdaterServiceManager } from '../../client/interpreter/configuration/types';
import {
    createEnvironmentAndRegister,
    CreateEnvironmentAndRegisterOptions,
    SESSION_START_HOLD_MS,
} from '../../client/positron/createEnvApi';
import { PythonRuntimeSession } from '../../client/positron/session';
import { createTypeMoq } from '../mocks/helper';

chaiUse(chaiAsPromised.default);

suite('Positron Create Environment APIs', () => {
    let registerCommandStub: sinon.SinonStub;
    let handleCreateEnvironmentCommandStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;
    let getWorkspaceFolderStub: sinon.SinonStub;
    let getWorkspaceFoldersStub: sinon.SinonStub;

    const disposables: IDisposableRegistry = [];
    const mockProvider = createTypeMoq<CreateEnvironmentProvider>();
    const mockProviders = [mockProvider.object];

    let pythonRuntimeManager: typemoq.IMock<IPythonRuntimeManager>;
    let pathUtils: typemoq.IMock<IPathUtils>;
    let interpreterQuickPick: typemoq.IMock<IInterpreterQuickPick>;
    let interpreterPathService: typemoq.IMock<IPythonPathUpdaterServiceManager>;
    let workspaceConfig: typemoq.IMock<WorkspaceConfiguration>;
    let sessionCreated: EventEmitter<PythonRuntimeSession>;

    // Test workspace
    const workspace1 = {
        uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
        name: 'workspace1',
        index: 0,
    };
    const workspace1UriString = workspace1.uri.toString();

    // Environment options (workspaceFolder is now a URI string)
    const envOptions: CreateEnvironmentAndRegisterOptions = {
        providerId: 'envProvider-id',
        interpreterPath: '/path/to/venv/python',
        workspaceFolder: workspace1UriString,
    };
    const envOptionsWithInfo = {
        withInterpreterPath: { ...envOptions },
        withCondaPythonVersion: { ...envOptions, interpreterPath: undefined, condaPythonVersion: '3.12' },
        withUvPythonVersion: { ...envOptions, interpreterPath: undefined, uvPythonVersion: '3.13' },
    };
    const envOptionsMissingInfo = {
        noProviderId: { ...envOptions, providerId: undefined },
        noPythonSpecified: {
            ...envOptions,
            interpreterPath: undefined,
            condaPythonVersion: undefined,
            uvPythonVersion: undefined,
        },
    };

    setup(async () => {
        registerCommandStub = sinon.stub(commandApis, 'registerCommand');
        handleCreateEnvironmentCommandStub = sinon.stub(createEnvironmentApis, 'handleCreateEnvironmentCommand');

        pythonRuntimeManager = createTypeMoq<IPythonRuntimeManager>();
        pathUtils = createTypeMoq<IPathUtils>();
        interpreterQuickPick = createTypeMoq<IInterpreterQuickPick>();
        interpreterPathService = createTypeMoq<IPythonPathUpdaterServiceManager>();
        workspaceConfig = createTypeMoq<WorkspaceConfiguration>();
        sessionCreated = new EventEmitter<PythonRuntimeSession>();
        pythonRuntimeManager.setup((m) => m.onDidCreateSession).returns(() => sessionCreated.event);

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake((section?: string) => {
            if (section === 'python') {
                return workspaceConfig.object;
            }
            return undefined;
        });

        getWorkspaceFolderStub = sinon.stub(workspaceApis, 'getWorkspaceFolder');
        getWorkspaceFolderStub.callsFake((uri: Uri) =>
            uri.toString() === workspace1UriString ? workspace1 : undefined,
        );

        getWorkspaceFoldersStub = sinon.stub(workspaceApis, 'getWorkspaceFolders');
        getWorkspaceFoldersStub.returns([workspace1]);

        registerCommandStub.callsFake((_command: string, _callback: (...args: any[]) => any) => ({
            dispose: () => {
                // Do nothing
            },
        }));
        pathUtils.setup((p) => p.getDisplayName(typemoq.It.isAny())).returns(() => 'test');

        await registerCreateEnvironmentFeatures(
            disposables,
            interpreterQuickPick.object,
            interpreterPathService.object,
            pathUtils.object,
            pythonRuntimeManager.object,
        );
    });

    teardown(() => {
        disposables.forEach((d) => d.dispose());
        sinon.restore();
        sessionCreated.dispose();
        assert.isFalse(isCreatingEnvironment(), 'a test leaked the creation hold');
    });

    Object.entries(envOptionsWithInfo).forEach(([optionsName, options]) => {
        test(`Environment creation succeeds when required options specified: ${optionsName}`, async () => {
            const resultPath = '/path/to/created/env';
            pythonRuntimeManager
                .setup((p) => p.registerLanguageRuntimeFromPath(resultPath))
                .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object))
                .verifiable(typemoq.Times.once());
            handleCreateEnvironmentCommandStub.returns(Promise.resolve({ path: resultPath }));

            const result = await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, options);

            assert.isDefined(result);
            assert.isDefined(result?.path);
            assert.isDefined(result?.metadata);
            assert.isUndefined(result?.error);
            assert.isTrue(handleCreateEnvironmentCommandStub.calledOnce);
            pythonRuntimeManager.verifyAll();
        });
    });

    Object.entries(envOptionsMissingInfo).forEach(([optionsName, options]) => {
        test(`Environment creation rejects when options are missing: ${optionsName} `, async () => {
            pythonRuntimeManager
                .setup((p) => p.registerLanguageRuntimeFromPath(typemoq.It.isAny()))
                .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object))
                .verifiable(typemoq.Times.never());

            await assert.isRejected(createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, options));

            assert.isTrue(handleCreateEnvironmentCommandStub.notCalled);
            pythonRuntimeManager.verifyAll();
        });
    });

    test('Environment creation rejects when no workspace folder is passed or open', async () => {
        getWorkspaceFoldersStub.returns([]);
        pythonRuntimeManager
            .setup((p) => p.registerLanguageRuntimeFromPath(typemoq.It.isAny()))
            .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object))
            .verifiable(typemoq.Times.never());

        await assert.isRejected(
            createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                workspaceFolder: undefined,
            }),
        );

        assert.isTrue(handleCreateEnvironmentCommandStub.notCalled);
        pythonRuntimeManager.verifyAll();
    });

    test('Rehydrates workspaceFolder URI string to a WorkspaceFolder before dispatching', async () => {
        const resultPath = '/path/to/created/env';
        pythonRuntimeManager
            .setup((p) => p.registerLanguageRuntimeFromPath(resultPath))
            .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object));
        handleCreateEnvironmentCommandStub.returns(Promise.resolve({ path: resultPath }));

        await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, { ...envOptions });

        const dispatched = handleCreateEnvironmentCommandStub.firstCall.args[1];
        assert.strictEqual(dispatched.workspaceFolder, workspace1);
    });

    test('Leaves workspaceFolder undefined when not provided', async () => {
        const resultPath = '/path/to/created/env';
        pythonRuntimeManager
            .setup((p) => p.registerLanguageRuntimeFromPath(resultPath))
            .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object));
        handleCreateEnvironmentCommandStub.returns(Promise.resolve({ path: resultPath }));

        await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
            ...envOptions,
            workspaceFolder: undefined,
        });

        const dispatched = handleCreateEnvironmentCommandStub.firstCall.args[1];
        assert.isUndefined(dispatched.workspaceFolder);
    });

    test('Matches by path when the URI scheme differs (remote ext host sees file://, caller sent vscode-remote://)', async () => {
        const resultPath = '/path/to/created/env';
        pythonRuntimeManager
            .setup((p) => p.registerLanguageRuntimeFromPath(resultPath))
            .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object));
        handleCreateEnvironmentCommandStub.returns(Promise.resolve({ path: resultPath }));

        // The real remote case: the folder lives on a remote (POSIX) host. The caller sends
        // the workbench/main-thread URI (vscode-remote://), but this extension host sees the
        // same folder as file://, with an identical path. Exact-URI lookup misses on the
        // scheme; the path-based fallback against getWorkspaceFolders() should resolve it.
        const remoteFolderPath = '/home/user/new-uv_736628';
        const extHostFolder = { uri: Uri.file(remoteFolderPath), name: 'new-uv_736628', index: 0 };
        const callerUri = Uri.from({ scheme: 'vscode-remote', authority: 'localhost:9000', path: remoteFolderPath });
        getWorkspaceFolderStub.callsFake(() => undefined);
        getWorkspaceFoldersStub.returns([extHostFolder]);

        await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
            ...envOptions,
            workspaceFolder: callerUri.toString(),
        });

        const dispatched = handleCreateEnvironmentCommandStub.firstCall.args[1];
        assert.strictEqual(dispatched.workspaceFolder, extHostFolder);
    });

    test('Throws when no workspace folder matches by exact URI or by path', async () => {
        getWorkspaceFolderStub.callsFake(() => undefined);
        getWorkspaceFoldersStub.returns([workspace1]);
        const unknownUri = Uri.file('/no/such/workspace').toString();

        await assert.isRejected(
            createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                workspaceFolder: unknownUri,
            }),
            /Workspace folder not found/,
        );
        assert.isTrue(handleCreateEnvironmentCommandStub.notCalled);
    });

    suite('sessionWillStart', () => {
        const resultPath = '/path/to/created/env/bin/python';

        function fakeSession(pythonPath: string): {
            session: PythonRuntimeSession;
            setState: (state: positron.RuntimeState) => void;
        } {
            let state = positron.RuntimeState.Uninitialized;
            const stateChanged = new EventEmitter<positron.RuntimeState>();
            const session = {
                runtimeMetadata: { extraRuntimeData: { pythonPath } },
                getRuntimeState: () => state,
                onDidChangeRuntimeState: stateChanged.event,
            };
            return {
                session: session as unknown as PythonRuntimeSession,
                setState: (newState) => {
                    state = newState;
                    stateChanged.fire(newState);
                },
            };
        }

        /** Lets the promise chain that ends the hold run to completion. */
        function settle(): Promise<void> {
            return new Promise((resolve) => setImmediate(resolve));
        }

        /** Ends a hold that a test left up, by starting a session for the new environment. */
        function startMatchingSession(): void {
            const { session, setState } = fakeSession(resultPath);
            sessionCreated.fire(session);
            setState(positron.RuntimeState.Starting);
        }

        setup(() => {
            pythonRuntimeManager
                .setup((p) => p.registerLanguageRuntimeFromPath(resultPath))
                .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object));
        });

        test('holds the flag from creation until a session for the new environment starts', async () => {
            let busyWhileCreating = false;
            handleCreateEnvironmentCommandStub.callsFake(async () => {
                busyWhileCreating = isCreatingEnvironment();
                return { path: resultPath };
            });
            await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                sessionWillStart: true,
            });
            const busyAfterReturn = isCreatingEnvironment();
            startMatchingSession();
            await settle();
            assert.deepStrictEqual(
                { busyWhileCreating, busyAfterReturn, busyAfterStart: isCreatingEnvironment() },
                { busyWhileCreating: true, busyAfterReturn: true, busyAfterStart: false },
            );
        });

        test('keeps the flag up while the new session is still uninitialized', async () => {
            handleCreateEnvironmentCommandStub.resolves({ path: resultPath });
            await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                sessionWillStart: true,
            });
            const { session, setState } = fakeSession(resultPath);
            sessionCreated.fire(session);
            await settle();
            const busyWhileUninitialized = isCreatingEnvironment();
            setState(positron.RuntimeState.Starting);
            await settle();
            assert.deepStrictEqual(
                { busyWhileUninitialized, busyAfterStart: isCreatingEnvironment() },
                { busyWhileUninitialized: true, busyAfterStart: false },
            );
        });

        test('releases the flag at once for a session that already left uninitialized', async () => {
            handleCreateEnvironmentCommandStub.resolves({ path: resultPath });
            await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                sessionWillStart: true,
            });
            const { session, setState } = fakeSession(resultPath);
            setState(positron.RuntimeState.Ready);
            sessionCreated.fire(session);
            await settle();
            assert.isFalse(isCreatingEnvironment());
        });

        test('ends the hold for a session on the registered interpreter path', async () => {
            const registeredPath = '/resolved/env/bin/python';
            const metadata = { extraRuntimeData: { pythonPath: registeredPath } };
            pythonRuntimeManager.reset();
            pythonRuntimeManager.setup((m) => m.onDidCreateSession).returns(() => sessionCreated.event);
            pythonRuntimeManager
                .setup((p) => p.registerLanguageRuntimeFromPath(resultPath))
                .returns(() => Promise.resolve(metadata as unknown as positron.LanguageRuntimeMetadata));
            handleCreateEnvironmentCommandStub.resolves({ path: resultPath });
            await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                sessionWillStart: true,
            });
            const { session, setState } = fakeSession(registeredPath);
            sessionCreated.fire(session);
            setState(positron.RuntimeState.Starting);
            await settle();
            assert.isFalse(isCreatingEnvironment());
        });

        test('ignores sessions for other interpreters', async () => {
            handleCreateEnvironmentCommandStub.resolves({ path: resultPath });
            await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                sessionWillStart: true,
            });
            const other = fakeSession('/other/bin/python');
            sessionCreated.fire(other.session);
            other.setState(positron.RuntimeState.Starting);
            await settle();
            const busyAfterOtherStart = isCreatingEnvironment();
            startMatchingSession();
            await settle();
            assert.deepStrictEqual(
                { busyAfterOtherStart, busyAfterMatchingStart: isCreatingEnvironment() },
                { busyAfterOtherStart: true, busyAfterMatchingStart: false },
            );
        });

        test('releases the flag at the time limit when no session starts', async () => {
            const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            try {
                handleCreateEnvironmentCommandStub.resolves({ path: resultPath });
                await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                    ...envOptions,
                    sessionWillStart: true,
                });
                clock.tick(SESSION_START_HOLD_MS - 1);
                await settle();
                const busyBeforeLimit = isCreatingEnvironment();
                clock.tick(1);
                await settle();
                assert.deepStrictEqual(
                    { busyBeforeLimit, busyAtLimit: isCreatingEnvironment() },
                    { busyBeforeLimit: true, busyAtLimit: false },
                );
            } finally {
                clock.restore();
            }
        });

        test('releases the flag when creation throws', async () => {
            handleCreateEnvironmentCommandStub.rejects(new Error('creation failed'));
            await assert.isRejected(
                createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                    ...envOptions,
                    sessionWillStart: true,
                }),
                /creation failed/,
            );
            await settle();
            assert.isFalse(isCreatingEnvironment());
        });

        test('releases the flag when creation returns no path', async () => {
            handleCreateEnvironmentCommandStub.resolves({
                path: undefined,
                workspaceFolder: undefined,
                action: undefined,
                error: new Error('x'),
            });
            await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                sessionWillStart: true,
            });
            await settle();
            assert.isFalse(isCreatingEnvironment());
        });

        test('does not hold the flag without sessionWillStart', async () => {
            let busyWhileCreating = false;
            handleCreateEnvironmentCommandStub.callsFake(async () => {
                busyWhileCreating = isCreatingEnvironment();
                return { path: resultPath };
            });
            await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, { ...envOptions });
            assert.deepStrictEqual(
                { busyWhileCreating, busyAfter: isCreatingEnvironment() },
                { busyWhileCreating: false, busyAfter: false },
            );
        });

        test('does not pass sessionWillStart to the providers', async () => {
            handleCreateEnvironmentCommandStub.resolves({ path: resultPath });
            await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, {
                ...envOptions,
                sessionWillStart: true,
            });
            startMatchingSession();
            await settle();
            assert.notProperty(handleCreateEnvironmentCommandStub.firstCall.args[1], 'sessionWillStart');
        });
    });
});
