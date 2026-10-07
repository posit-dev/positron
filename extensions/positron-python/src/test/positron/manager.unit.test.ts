/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import { verify } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import * as vscode from 'vscode';
import { WorkspaceConfiguration } from 'vscode';
import * as path from 'path';
import * as fs from '../../client/common/platform/fs-paths';
import * as runtime from '../../client/positron/runtime';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import * as interpreterSettings from '../../client/positron/interpreterSettings';
import * as environmentTypeComparer from '../../client/interpreter/configuration/environmentTypeComparer';
import * as util from '../../client/positron/util';
import { IEnvironmentVariablesProvider } from '../../client/common/variables/types';
import {
    IConfigurationService,
    IDisposable,
    IDisposableRegistry,
    InspectInterpreterSettingType,
} from '../../client/common/types';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonRuntimeManager } from '../../client/positron/manager';
import * as createVirtualEnvironmentPrompt from '../../client/positron/createVirtualEnvironmentPrompt';
import { CreateVirtualEnvironmentPromptOutcome } from '../../client/positron/createVirtualEnvironmentPrompt';
import * as sessionModule from '../../client/positron/session';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { mockedPositronNamespaces } from '../vscode-mock';
import { createTypeMoq } from '../mocks/helper';

suite('Python runtime manager', () => {
    const pythonPath = 'pythonPath';

    let runtimeMetadata: TypeMoq.IMock<positron.LanguageRuntimeMetadata>;
    let interpreter: TypeMoq.IMock<PythonEnvironment>;
    let configService: TypeMoq.IMock<IConfigurationService>;
    let envVarsProvider: TypeMoq.IMock<IEnvironmentVariablesProvider>;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let workspaceConfig: TypeMoq.IMock<WorkspaceConfiguration>;
    let disposableRegistry: TypeMoq.IMock<IDisposableRegistry>;

    let getConfigurationStub: sinon.SinonStub;
    let isVersionSupportedStub: sinon.SinonStub;
    let promptToCreateVirtualEnvironmentStub: sinon.SinonStub;

    let pythonRuntimeManager: PythonRuntimeManager;
    let disposables: IDisposable[];

    setup(() => {
        runtimeMetadata = createTypeMoq<positron.LanguageRuntimeMetadata>();
        interpreter = createTypeMoq<PythonEnvironment>();
        configService = createTypeMoq<IConfigurationService>();
        envVarsProvider = createTypeMoq<IEnvironmentVariablesProvider>();
        interpreterService = createTypeMoq<IInterpreterService>();
        serviceContainer = createTypeMoq<IServiceContainer>();
        workspaceConfig = createTypeMoq<WorkspaceConfiguration>();
        disposableRegistry = createTypeMoq<IDisposableRegistry>();

        runtimeMetadata.setup((r) => r.runtimeId).returns(() => 'runtimeId');
        runtimeMetadata.setup((r) => r.extraRuntimeData).returns(() => ({ pythonPath }));

        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(interpreter.object));
        // resolveInterpreterWithRetry passes a resource argument, so the two-argument
        // call needs its own setup for TypeMoq to match it.
        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(interpreter.object));

        serviceContainer.setup((s) => s.get(IConfigurationService)).returns(() => configService.object);
        serviceContainer.setup((s) => s.get(IEnvironmentVariablesProvider)).returns(() => envVarsProvider.object);
        serviceContainer.setup((s) => s.get(IInterpreterService)).returns(() => interpreterService.object);
        serviceContainer.setup((s) => s.get(IDisposableRegistry)).returns(() => disposableRegistry.object);

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake((section?: string, _scope?: any) => {
            if (section === 'python') {
                return workspaceConfig.object;
            }
            return undefined;
        });

        isVersionSupportedStub = sinon.stub(environmentTypeComparer, 'isVersionSupported');
        isVersionSupportedStub.returns(true);

        promptToCreateVirtualEnvironmentStub = sinon
            .stub(createVirtualEnvironmentPrompt, 'promptToCreateVirtualEnvironment')
            .resolves(CreateVirtualEnvironmentPromptOutcome.Proceed);

        pythonRuntimeManager = new PythonRuntimeManager(serviceContainer.object, interpreterService.object);
        disposables = [];
    });

    teardown(() => {
        sinon.restore();
        disposables.forEach((d) => d.dispose());
    });

    test('constructor', () => {
        verify(mockedPositronNamespaces.runtime!.registerLanguageRuntimeManager('python', pythonRuntimeManager)).once();
    });

    /** Helper function to assert that a language runtime is registered. */
    async function assertRegisterLanguageRuntime(fn: () => Promise<void>) {
        // Setup a listener to verify the onDidDiscoverRuntime event.
        let didDiscoverRuntimeEvent: positron.LanguageRuntimeMetadata | undefined;
        disposables.push(
            pythonRuntimeManager.onDidDiscoverRuntime((e) => {
                assert.strictEqual(didDiscoverRuntimeEvent, undefined, 'onDidDiscoverRuntime fired more than once');
                didDiscoverRuntimeEvent = e;
            }),
        );

        // Call the function.
        await fn();

        // Check that the runtime was registered.
        assert.strictEqual(pythonRuntimeManager.registeredPythonRuntimes.get(pythonPath), runtimeMetadata.object);

        // Check that the onDidDiscoverRuntime event was fired with the runtime metadata.
        assert.strictEqual(didDiscoverRuntimeEvent, runtimeMetadata.object);
    }

    test('registerLanguageRuntime: registers a language runtime with Positron', async () => {
        await assertRegisterLanguageRuntime(async () => {
            pythonRuntimeManager.registerLanguageRuntime(runtimeMetadata.object);
        });
    });

    test('createSession rejects with a cancellation error when the prompt aborts', async () => {
        promptToCreateVirtualEnvironmentStub.resolves(CreateVirtualEnvironmentPromptOutcome.Abort);

        const sessionMetadata = {
            sessionId: 'session-id',
            sessionMode: positron.LanguageRuntimeSessionMode.Console,
            userSelected: true,
        } as unknown as positron.RuntimeSessionMetadata;

        await assert.rejects(
            pythonRuntimeManager.createSession(runtimeMetadata.object, sessionMetadata),
            (error: unknown) => error instanceof vscode.CancellationError,
        );
    });

    test('createSession passes the interpreter path and session metadata to the prompt', async () => {
        const sessionMetadata = {
            sessionId: 'session-id',
            sessionMode: positron.LanguageRuntimeSessionMode.Console,
            userSelected: true,
        } as unknown as positron.RuntimeSessionMetadata;

        promptToCreateVirtualEnvironmentStub.resolves(CreateVirtualEnvironmentPromptOutcome.Abort);
        await pythonRuntimeManager.createSession(runtimeMetadata.object, sessionMetadata).catch(() => undefined);

        assert.deepStrictEqual(
            {
                runtimeManager: promptToCreateVirtualEnvironmentStub.firstCall.args[2],
                interpreterPath: promptToCreateVirtualEnvironmentStub.firstCall.args[3],
                metadata: promptToCreateVirtualEnvironmentStub.firstCall.args[4],
            },
            { runtimeManager: pythonRuntimeManager, interpreterPath: pythonPath, metadata: sessionMetadata },
        );
    });

    // TODO: Test discoverRuntimes
    // test('discoverRuntimes', async () => {
    // });

    test('validateMetadata: rehydrates metadata for an unregistered but resolvable interpreter', async () => {
        sinon.stub(fs, 'pathExists').resolves(true);
        const rehydrated = createTypeMoq<positron.LanguageRuntimeMetadata>();
        const createStub = sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(rehydrated.object);

        const validated = await pythonRuntimeManager.validateMetadata(runtimeMetadata.object);

        assert.strictEqual(validated, rehydrated.object);
        sinon.assert.calledOnceWithExactly(createStub, interpreter.object, serviceContainer.object, false);
        interpreterService.verify((i) => i.triggerRefresh(), TypeMoq.Times.never());
    });

    test('validateMetadata: returns the full metadata when a metadata fragment is provided', async () => {
        // Set the full runtime metadata in the manager.
        pythonRuntimeManager.registeredPythonRuntimes.set(pythonPath, runtimeMetadata.object);

        // Create a metadata fragment (only contains extra data python path).
        const runtimeMetadataFragment = createTypeMoq<positron.LanguageRuntimeMetadata>();
        runtimeMetadataFragment.setup((r) => r.extraRuntimeData).returns(() => ({ pythonPath }));

        // Override the pathExists stub to return true and validate the metadata.
        sinon.stub(fs, 'pathExists').resolves(true);
        const validated = await pythonRuntimeManager.validateMetadata(runtimeMetadataFragment.object);

        // The validated metadata should be the full metadata.
        assert.deepStrictEqual(validated, runtimeMetadata.object);

        // A registered runtime takes the fast path: no PET resolve.
        interpreterService.verify(
            (i) => i.getInterpreterDetails(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );
    });

    test('validateMetadata: throws if extra data is missing', async () => {
        const invalidRuntimeMetadata = createTypeMoq<positron.LanguageRuntimeMetadata>();
        assert.rejects(() => pythonRuntimeManager.validateMetadata(invalidRuntimeMetadata.object));
    });

    test('validateMetadata: throws if interpreter path does not exist', async () => {
        sinon.stub(fs, 'pathExists').resolves(false);
        assert.rejects(() => pythonRuntimeManager.validateMetadata(runtimeMetadata.object));
    });

    test('validateMetadata: refreshes and retries when the interpreter does not resolve at first', async () => {
        sinon.stub(fs, 'pathExists').resolves(true);
        const rehydrated = createTypeMoq<positron.LanguageRuntimeMetadata>();
        sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(rehydrated.object);

        let resolveCalls = 0;
        interpreterService.reset();
        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                resolveCalls += 1;
                return Promise.resolve(resolveCalls === 1 ? undefined : interpreter.object);
            });
        interpreterService.setup((i) => i.triggerRefresh()).returns(() => Promise.resolve());

        const validated = await pythonRuntimeManager.validateMetadata(runtimeMetadata.object);

        assert.strictEqual(validated, rehydrated.object);
        interpreterService.verify((i) => i.triggerRefresh(), TypeMoq.Times.once());
    });

    test('validateMetadata: throws when the interpreter cannot be resolved after a refresh', async () => {
        sinon.stub(fs, 'pathExists').resolves(true);
        interpreterService.reset();
        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        interpreterService.setup((i) => i.triggerRefresh()).returns(() => Promise.resolve());

        await assert.rejects(
            () => pythonRuntimeManager.validateMetadata(runtimeMetadata.object),
            /Failed to resolve interpreter/,
        );
    });

    test('registerLanguageRuntimeFromPath: registers a runtime with the corresponding runtime metadata', async () => {
        const createPythonRuntimeMetadata = sinon
            .stub(runtime, 'createPythonRuntimeMetadata')
            .resolves(runtimeMetadata.object);

        await assertRegisterLanguageRuntime(async () => {
            const registeredRuntime = await pythonRuntimeManager.registerLanguageRuntimeFromPath(pythonPath);
            assert.equal(registeredRuntime?.extraRuntimeData.pythonPath, pythonPath);
        });

        sinon.assert.calledOnceWithExactly(
            createPythonRuntimeMetadata,
            interpreter.object,
            serviceContainer.object,
            false,
        );
    });

    test('selectLanguageRuntimeFromPath: calls positron.runtime.selectLanguageRuntime with the corresponding runtime ID', async () => {
        // An already-registered path is re-resolved (createPythonRuntimeMetadata)
        // to catch stale versions; the cached runtime is kept when the resolved
        // runtimeId matches.
        sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(runtimeMetadata.object);
        pythonRuntimeManager.registeredPythonRuntimes.set(pythonPath, runtimeMetadata.object);

        await pythonRuntimeManager.selectLanguageRuntimeFromPath(pythonPath);

        verify(mockedPositronNamespaces.runtime!.selectLanguageRuntime(runtimeMetadata.object.runtimeId)).once();
    });

    /** A console session for `runtimeId` in the given state. */
    function fakeConsoleSession(runtimeId: string, state: positron.RuntimeState): sessionModule.PythonRuntimeSession {
        return Object.assign(Object.create(sessionModule.PythonRuntimeSession.prototype), {
            runtimeMetadata: { runtimeId, extraRuntimeData: { pythonPath } },
            metadata: { sessionId: `${runtimeId}-session`, sessionMode: positron.LanguageRuntimeSessionMode.Console },
            getRuntimeState: () => state,
            shutdown: sinon.stub().resolves(),
            onDidEndSession: new vscode.EventEmitter<positron.LanguageRuntimeExit>().event,
        });
    }

    test('selectLanguageRuntimeFromPath: recreating a runtime whose console exited starts a new session', async () => {
        // A venv recreated with the same Python keeps its runtime ID, and selecting
        // that runtime would bring the exited console back instead of starting one.
        const recreated = {
            runtimeId: 'recreated-runtime',
            runtimeName: 'Python 3.12 (venv)',
            extraRuntimeData: { pythonPath },
        } as positron.LanguageRuntimeMetadata;
        sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(recreated);
        pythonRuntimeManager.registeredPythonRuntimes.set(pythonPath, recreated);
        sinon
            .stub(sessionModule, 'getActivePythonSessions')
            .resolves([fakeConsoleSession('recreated-runtime', positron.RuntimeState.Exited)]);

        await pythonRuntimeManager.selectLanguageRuntimeFromPath(pythonPath, true);

        verify(
            mockedPositronNamespaces.runtime!.startLanguageRuntime('recreated-runtime', 'Python 3.12 (venv)'),
        ).once();
        verify(mockedPositronNamespaces.runtime!.selectLanguageRuntime('recreated-runtime')).never();
    });

    test('selectLanguageRuntimeFromPath: recreating starts a new session while the old console is still shutting down', async () => {
        // The recreate step shuts the old console down, and its state stays Idle until
        // the kernel exits, so it must not count as running.
        const recreated = {
            runtimeId: 'shutting-down-runtime',
            runtimeName: 'Python 3.12 (venv)',
            extraRuntimeData: { pythonPath },
        } as positron.LanguageRuntimeMetadata;
        sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(recreated);
        pythonRuntimeManager.registeredPythonRuntimes.set(pythonPath, recreated);
        const oldConsole = fakeConsoleSession('shutting-down-runtime', positron.RuntimeState.Idle);
        sinon.stub(sessionModule, 'getActivePythonSessions').resolves([oldConsole]);

        await pythonRuntimeManager.selectLanguageRuntimeFromPath(pythonPath, true);

        sinon.assert.calledOnce(oldConsole.shutdown as sinon.SinonStub);
        verify(
            mockedPositronNamespaces.runtime!.startLanguageRuntime('shutting-down-runtime', 'Python 3.12 (venv)'),
        ).once();
        verify(mockedPositronNamespaces.runtime!.selectLanguageRuntime('shutting-down-runtime')).never();
    });

    test('selectLanguageRuntimeFromPath: recreating a runtime whose console is still running selects it', async () => {
        // Nothing is registered for the path, as when the session's runtime came
        // from the workspace recommendation, so its session is not shut down.
        const live = {
            runtimeId: 'live-runtime',
            runtimeName: 'Python 3.12 (venv)',
            extraRuntimeData: { pythonPath },
        } as positron.LanguageRuntimeMetadata;
        sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(live);
        sinon
            .stub(sessionModule, 'getActivePythonSessions')
            .resolves([fakeConsoleSession('live-runtime', positron.RuntimeState.Idle)]);

        await pythonRuntimeManager.selectLanguageRuntimeFromPath(pythonPath, true);

        verify(mockedPositronNamespaces.runtime!.selectLanguageRuntime('live-runtime')).once();
        verify(mockedPositronNamespaces.runtime!.startLanguageRuntime('live-runtime', 'Python 3.12 (venv)')).never();
    });

    test('selectLanguageRuntimeFromPath: creating an environment with no sessions starts one session', async () => {
        // A first-time create (the uv.lock and pixi.lock prompts, the global environment)
        // has no console for the runtime yet.
        const created = {
            runtimeId: 'created-runtime',
            runtimeName: 'Python 3.12 (venv)',
            extraRuntimeData: { pythonPath },
        } as positron.LanguageRuntimeMetadata;
        sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(created);
        sinon.stub(sessionModule, 'getActivePythonSessions').resolves([]);

        await pythonRuntimeManager.selectLanguageRuntimeFromPath(pythonPath, true);

        verify(mockedPositronNamespaces.runtime!.startLanguageRuntime('created-runtime', 'Python 3.12 (venv)')).once();
        verify(mockedPositronNamespaces.runtime!.selectLanguageRuntime('created-runtime')).never();
    });

    test('selectLanguageRuntimeFromPath: a console on another interpreter does not count as running', async () => {
        // e.g. a global Python console is open when the uv.lock prompt creates `.venv`.
        const created = {
            runtimeId: 'venv-runtime',
            runtimeName: 'Python 3.12 (venv)',
            extraRuntimeData: { pythonPath },
        } as positron.LanguageRuntimeMetadata;
        sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(created);
        sinon
            .stub(sessionModule, 'getActivePythonSessions')
            .resolves([fakeConsoleSession('global-runtime', positron.RuntimeState.Idle)]);

        await pythonRuntimeManager.selectLanguageRuntimeFromPath(pythonPath, true);

        verify(mockedPositronNamespaces.runtime!.startLanguageRuntime('venv-runtime', 'Python 3.12 (venv)')).once();
    });

    test('resolveRuntimeMetadataFromPath refreshes once before retrying', async () => {
        sinon.stub(runtime, 'createPythonRuntimeMetadata').resolves(runtimeMetadata.object);

        let resolveCalls = 0;
        interpreterService.reset();
        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny()))
            .returns(() => {
                resolveCalls += 1;
                return Promise.resolve(resolveCalls === 1 ? undefined : interpreter.object);
            });
        interpreterService.setup((i) => i.triggerRefresh()).returns(() => Promise.resolve());

        const metadata = await pythonRuntimeManager.resolveRuntimeMetadataFromPath(pythonPath);

        assert.strictEqual(metadata, runtimeMetadata.object);
        interpreterService.verify((i) => i.triggerRefresh(), TypeMoq.Times.once());
    });
});

suite('Python runtime manager - recommendedWorkspaceRuntime', () => {
    let pythonRuntimeManager: PythonRuntimeManager;
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let interpreter: TypeMoq.IMock<PythonEnvironment>;
    let runtimeMetadata: positron.LanguageRuntimeMetadata;
    let disposableRegistry: TypeMoq.IMock<IDisposableRegistry>;
    let interpretersConfig: TypeMoq.IMock<WorkspaceConfiguration>;

    let getUserDefaultInterpreterStub: sinon.SinonStub;
    let hasFilesStub: sinon.SinonStub;
    let createPythonRuntimeMetadataStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;

    setup(() => {
        // Create mocks
        serviceContainer = createTypeMoq<IServiceContainer>();
        interpreterService = createTypeMoq<IInterpreterService>();
        interpreter = createTypeMoq<PythonEnvironment>();
        disposableRegistry = createTypeMoq<IDisposableRegistry>();
        interpretersConfig = createTypeMoq<WorkspaceConfiguration>();

        // Setup interpreter service
        serviceContainer.setup((s) => s.get(IInterpreterService)).returns(() => interpreterService.object);
        serviceContainer.setup((s) => s.get(IDisposableRegistry)).returns(() => disposableRegistry.object);

        // Setup interpreters config to return undefined for startupBehavior (default behavior)
        interpretersConfig.setup((c) => c.get<string>('startupBehavior')).returns(() => undefined);

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake((section?: string, _scope?: any) => {
            if (section === 'interpreters') {
                return interpretersConfig.object;
            }
            return undefined;
        });

        getUserDefaultInterpreterStub = sinon.stub(interpreterSettings, 'getUserDefaultInterpreter');
        hasFilesStub = sinon.stub(util, 'hasFiles');

        createPythonRuntimeMetadataStub = sinon.stub(runtime, 'createPythonRuntimeMetadata');
        createPythonRuntimeMetadataStub.callsFake((interpreter, _serviceContainer, isImmediate) => {
            const pythonPath = (interpreter as any).path;

            runtimeMetadata = {
                runtimeId: 'python-runtime-id',
                runtimeName: 'Python',
                runtimeShortName: 'Python',
                runtimePath: pythonPath,
                runtimeVersion: '1.0.0',
                runtimeSource: 'test',
                languageId: 'python',
                languageName: 'python',
                languageVersion: '3.x',
                base64EncodedIconSvg: 'test-icon-data',
                startupBehavior: isImmediate ? ('immediate' as any) : ('implicit' as any),
                sessionLocation: 'workspace' as any,
                extraRuntimeData: { pythonPath },
            };

            return Promise.resolve(runtimeMetadata);
        });

        pythonRuntimeManager = new PythonRuntimeManager(serviceContainer.object, interpreterService.object);
    });

    teardown(() => {
        sinon.restore();
    });

    test('returns undefined when no workspace folder and no global interpreter setting', async () => {
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [],
            configurable: true,
        });
        getUserDefaultInterpreterStub.returns({
            globalValue: undefined,
            workspaceValue: undefined,
            workspaceFolderValue: undefined,
        } as InspectInterpreterSettingType);

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();
        assert.strictEqual(result, undefined);
        sinon.assert.notCalled(createPythonRuntimeMetadataStub);
    });

    test('uses global interpreter setting when no workspace folder', async () => {
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [],
            configurable: true,
        });
        const globalInterpreterPath = '/path/to/global/python';
        getUserDefaultInterpreterStub.returns({
            globalValue: globalInterpreterPath,
            workspaceValue: undefined,
            workspaceFolderValue: undefined,
        } as InspectInterpreterSettingType);

        // Setup the interpreter object with the expected path
        interpreter.setup((i) => i.path).returns(() => globalInterpreterPath);
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(TypeMoq.It.isValue(globalInterpreterPath), TypeMoq.It.isValue(undefined)),
            )
            .returns(() => Promise.resolve(interpreter.object));

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        // Verify createPythonRuntimeMetadata was called with the correct interpreter
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[0], interpreter.object);
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, globalInterpreterPath);
    });

    test('uses .venv interpreter when it exists', async () => {
        const workspaceUri = {
            fsPath: '/path/to/workspace',
            uri: { fsPath: '/path/to/workspace' },
        } as any;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceUri],
            configurable: true,
        });
        hasFilesStub.withArgs(['.venv/**/*']).resolves(true);

        const venvPythonPath =
            process.platform === 'win32'
                ? path.join(workspaceUri.fsPath, '.venv', 'Scripts', 'python.exe')
                : path.join(workspaceUri.fsPath, '.venv', 'bin', 'python');
        interpreter.setup((i) => i.path).returns(() => venvPythonPath);
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(TypeMoq.It.isValue(venvPythonPath), TypeMoq.It.isValue(workspaceUri.uri)),
            )
            .returns(() => Promise.resolve(interpreter.object));

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        // Verify createPythonRuntimeMetadata was called with the correct interpreter and isImmediate=true
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[0], interpreter.object);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[2], true);

        // Verify the result has the correct path
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, venvPythonPath);
    });

    test('uses .conda interpreter when it exists', async () => {
        // Setup: Workspace folder with .conda directory
        const workspaceUri = {
            fsPath: '/path/to/workspace',
            uri: { fsPath: '/path/to/workspace' },
        } as any;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceUri],
            configurable: true,
        });
        hasFilesStub.withArgs(['.venv/**/*']).resolves(false);
        hasFilesStub.withArgs(['.conda/**/*']).resolves(true);

        const condaPythonPath =
            process.platform === 'win32'
                ? path.join(workspaceUri.fsPath, '.conda', 'Scripts', 'python.exe')
                : path.join(workspaceUri.fsPath, '.conda', 'bin', 'python');
        interpreter.setup((i) => i.path).returns(() => condaPythonPath);
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(TypeMoq.It.isValue(condaPythonPath), TypeMoq.It.isValue(workspaceUri.uri)),
            )
            .returns(() => Promise.resolve(interpreter.object));

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        // Verify createPythonRuntimeMetadata was called with the correct interpreter and isImmediate=true
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[0], interpreter.object);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[2], true);

        // Verify the result has the correct path
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, condaPythonPath);
    });

    test('uses workspace interpreter setting when no .venv or .conda', async () => {
        const workspaceUri = {
            fsPath: '/path/to/workspace',
            uri: { fsPath: '/path/to/workspace' },
        } as any;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceUri],
            configurable: true,
        });
        hasFilesStub.withArgs(['.venv/**/*']).resolves(false);
        hasFilesStub.withArgs(['.conda/**/*']).resolves(false);
        hasFilesStub.withArgs(['*/bin/python', '*/Scripts/python.exe']).resolves(false);

        const workspaceInterpreterPath = '/path/to/workspace/python';
        getUserDefaultInterpreterStub.returns({
            globalValue: '/path/to/global/python',
            workspaceValue: workspaceInterpreterPath,
            workspaceFolderValue: undefined,
        } as InspectInterpreterSettingType);

        interpreter.setup((i) => i.path).returns(() => workspaceInterpreterPath);
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(
                    TypeMoq.It.isValue(workspaceInterpreterPath),
                    TypeMoq.It.isValue(workspaceUri.uri),
                ),
            )
            .returns(() => Promise.resolve(interpreter.object));

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        // Verify createPythonRuntimeMetadata was called with the correct interpreter
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[0], interpreter.object);

        // Verify the result has the correct path
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, workspaceInterpreterPath);
    });

    test('uses workspace folder interpreter setting when no .venv, .conda, or workspace setting', async () => {
        const workspaceUri = {
            fsPath: '/path/to/workspace',
            uri: { fsPath: '/path/to/workspace' },
        } as any;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceUri],
            configurable: true,
        });
        hasFilesStub.withArgs(['.venv/**/*']).resolves(false);
        hasFilesStub.withArgs(['.conda/**/*']).resolves(false);
        hasFilesStub.withArgs(['*/bin/python', '*/Scripts/python.exe']).resolves(false);

        const workspaceFolderInterpreterPath = '/path/to/workspace/folder/python';
        getUserDefaultInterpreterStub.returns({
            globalValue: '/path/to/global/python',
            workspaceValue: undefined,
            workspaceFolderValue: workspaceFolderInterpreterPath,
        } as InspectInterpreterSettingType);

        interpreter.setup((i) => i.path).returns(() => workspaceFolderInterpreterPath);
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(
                    TypeMoq.It.isValue(workspaceFolderInterpreterPath),
                    TypeMoq.It.isValue(workspaceUri.uri),
                ),
            )
            .returns(() => Promise.resolve(interpreter.object));

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        // Verify createPythonRuntimeMetadata was called with the correct interpreter
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[0], interpreter.object);

        // Verify the result has the correct path
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, workspaceFolderInterpreterPath);
    });

    test('uses global interpreter setting when no .venv, .conda, workspace, or workspace folder setting', async () => {
        const workspaceUri = {
            fsPath: '/path/to/workspace',
            uri: { fsPath: '/path/to/workspace' },
        } as any;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceUri],
            configurable: true,
        });
        hasFilesStub.withArgs(['.venv/**/*']).resolves(false);
        hasFilesStub.withArgs(['.conda/**/*']).resolves(false);
        hasFilesStub.withArgs(['*/bin/python', '*/Scripts/python.exe']).resolves(false);

        const globalInterpreterPath = '/path/to/global/python';
        getUserDefaultInterpreterStub.returns({
            globalValue: globalInterpreterPath,
            workspaceValue: undefined,
            workspaceFolderValue: undefined,
        } as InspectInterpreterSettingType);

        // Setup the interpreter object with the expected path
        interpreter.setup((i) => i.path).returns(() => globalInterpreterPath);
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(
                    TypeMoq.It.isValue(globalInterpreterPath),
                    TypeMoq.It.isValue(workspaceUri.uri),
                ),
            )
            .returns(() => Promise.resolve(interpreter.object));

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        // Verify createPythonRuntimeMetadata was called with the correct interpreter
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[0], interpreter.object);

        // Verify the result has the correct path
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, globalInterpreterPath);
    });

    test('sets isImmediate to false when general startupBehavior is manual', async () => {
        const workspaceUri = {
            fsPath: '/path/to/workspace',
            uri: { fsPath: '/path/to/workspace' },
        } as any;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceUri],
            configurable: true,
        });

        // Setup .venv to exist (which would normally set isImmediate to true)
        hasFilesStub.withArgs(['.venv/**/*']).resolves(true);

        // Set startupBehavior to 'manual'
        interpretersConfig.reset();
        interpretersConfig.setup((c) => c.get<string>('startupBehavior')).returns(() => 'manual');

        const venvPythonPath =
            process.platform === 'win32'
                ? path.join(workspaceUri.fsPath, '.venv', 'Scripts', 'python.exe')
                : path.join(workspaceUri.fsPath, '.venv', 'bin', 'python');
        interpreter.setup((i) => i.path).returns(() => venvPythonPath);
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(TypeMoq.It.isValue(venvPythonPath), TypeMoq.It.isValue(workspaceUri.uri)),
            )
            .returns(() => Promise.resolve(interpreter.object));

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        // Verify createPythonRuntimeMetadata was called with isImmediate=false despite .venv existing
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[2], false);
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, venvPythonPath);
    });

    test('sets isImmediate to false when Python-specific startupBehavior is manual', async () => {
        const workspaceUri = {
            fsPath: '/path/to/workspace',
            uri: { fsPath: '/path/to/workspace' },
        } as any;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [workspaceUri],
            configurable: true,
        });

        // Setup .venv to exist (which would normally set isImmediate to true)
        hasFilesStub.withArgs(['.venv/**/*']).resolves(true);

        // Setup config stub to return undefined for general config but 'manual' for Python-specific
        const pythonInterpretersConfig = createTypeMoq<WorkspaceConfiguration>();
        pythonInterpretersConfig.setup((c) => c.get<string>('startupBehavior')).returns(() => 'manual');

        getConfigurationStub.reset();
        getConfigurationStub.callsFake((section?: string, scope?: any) => {
            if (section === 'interpreters') {
                if (scope && scope.languageId === 'python') {
                    return pythonInterpretersConfig.object;
                }
                return interpretersConfig.object;
            }
            return undefined;
        });

        const venvPythonPath =
            process.platform === 'win32'
                ? path.join(workspaceUri.fsPath, '.venv', 'Scripts', 'python.exe')
                : path.join(workspaceUri.fsPath, '.venv', 'bin', 'python');
        interpreter.setup((i) => i.path).returns(() => venvPythonPath);
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(TypeMoq.It.isValue(venvPythonPath), TypeMoq.It.isValue(workspaceUri.uri)),
            )
            .returns(() => Promise.resolve(interpreter.object));

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        // Verify createPythonRuntimeMetadata was called with isImmediate=false despite .venv existing
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(createPythonRuntimeMetadataStub.firstCall.args[2], false);
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, venvPythonPath);
    });

    test('triggers a refresh and retries when the interpreter is not resolved yet (cold resolve)', async () => {
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [],
            configurable: true,
        });
        const globalInterpreterPath = '/path/to/global/python';
        getUserDefaultInterpreterStub.returns({
            globalValue: globalInterpreterPath,
            workspaceValue: undefined,
            workspaceFolderValue: undefined,
        } as InspectInterpreterSettingType);

        // First resolve is cold (undefined), the refresh warms it, the retry succeeds.
        interpreter.setup((i) => i.path).returns(() => globalInterpreterPath);
        let resolveCount = 0;
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(TypeMoq.It.isValue(globalInterpreterPath), TypeMoq.It.isValue(undefined)),
            )
            .returns(() => {
                resolveCount += 1;
                return Promise.resolve(resolveCount === 1 ? undefined : interpreter.object);
            });
        interpreterService.setup((i) => i.triggerRefresh()).returns(() => Promise.resolve());

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        assert.strictEqual(resolveCount, 2);
        interpreterService.verify((i) => i.triggerRefresh(), TypeMoq.Times.once());
        sinon.assert.calledOnce(createPythonRuntimeMetadataStub);
        assert.strictEqual(result?.extraRuntimeData?.pythonPath, globalInterpreterPath);
    });

    test('returns undefined when the interpreter stays unresolved after a refresh', async () => {
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [],
            configurable: true,
        });
        const globalInterpreterPath = '/path/to/global/python';
        getUserDefaultInterpreterStub.returns({
            globalValue: globalInterpreterPath,
            workspaceValue: undefined,
            workspaceFolderValue: undefined,
        } as InspectInterpreterSettingType);

        // Resolve stays cold even after the refresh: recommend gives up, does not loop.
        interpreterService
            .setup((i) =>
                i.getInterpreterDetails(TypeMoq.It.isValue(globalInterpreterPath), TypeMoq.It.isValue(undefined)),
            )
            .returns(() => Promise.resolve(undefined));
        interpreterService.setup((i) => i.triggerRefresh()).returns(() => Promise.resolve());

        const result = await pythonRuntimeManager.recommendedWorkspaceRuntime();

        assert.strictEqual(result, undefined);
        interpreterService.verify((i) => i.triggerRefresh(), TypeMoq.Times.once());
        sinon.assert.notCalled(createPythonRuntimeMetadataStub);
    });
});

suite('Python runtime manager - onDidChangeInterpreter filter', () => {
    // Storage-only fires must not spawn a console; user-intent fires must.

    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let disposableRegistry: TypeMoq.IMock<IDisposableRegistry>;
    let onDidChangeInterpreterEmitter: vscode.EventEmitter<
        import('../../client/interpreter/contracts').InterpreterChangeEvent
    >;
    let onDidChangeInterpretersEmitter: vscode.EventEmitter<
        import('../../client/interpreter/contracts').PythonEnvironmentsChangedEvent
    >;
    let pythonRuntimeManager: PythonRuntimeManager;
    let selectSpy: sinon.SinonStub;
    let getActiveSessionsImpl: () => Promise<positron.LanguageRuntimeSession[]>;
    let originalGetActiveSessions: unknown;

    setup(() => {
        serviceContainer = createTypeMoq<IServiceContainer>();
        interpreterService = createTypeMoq<IInterpreterService>();
        disposableRegistry = createTypeMoq<IDisposableRegistry>();

        const registryArray: IDisposable[] = [];
        disposableRegistry
            .setup((d) => d.push(TypeMoq.It.isAny()))
            .callback((item: IDisposable) => registryArray.push(item));
        serviceContainer.setup((s) => s.get(IDisposableRegistry)).returns(() => registryArray);

        onDidChangeInterpreterEmitter = new vscode.EventEmitter();
        onDidChangeInterpretersEmitter = new vscode.EventEmitter();
        interpreterService.setup((i) => i.onDidChangeInterpreter).returns(() => onDidChangeInterpreterEmitter.event);
        interpreterService.setup((i) => i.onDidChangeInterpreters).returns(() => onDidChangeInterpretersEmitter.event);

        // positron.runtime may have getActiveSessions replaced by Object.assign in a prior test
        // (e.g. languageServerManager). Assign directly so we read from our fixture regardless of
        // that prior state, and restore the prior value in teardown so this suite doesn't leak
        // into later ones. Each test overrides getActiveSessionsImpl.
        originalGetActiveSessions = (positron.runtime as { getActiveSessions?: unknown }).getActiveSessions;
        getActiveSessionsImpl = async () => [];
        Object.assign(positron.runtime, {
            getActiveSessions: () => getActiveSessionsImpl(),
        });

        pythonRuntimeManager = new PythonRuntimeManager(serviceContainer.object, interpreterService.object);
        selectSpy = sinon.stub(pythonRuntimeManager, 'selectLanguageRuntimeFromPath').resolves('runtime-id');
    });

    teardown(() => {
        sinon.restore();
        if (originalGetActiveSessions === undefined) {
            delete (positron.runtime as { getActiveSessions?: unknown }).getActiveSessions;
        } else {
            Object.assign(positron.runtime, { getActiveSessions: originalGetActiveSessions });
        }
        onDidChangeInterpreterEmitter.dispose();
        onDidChangeInterpretersEmitter.dispose();
    });

    test('storage-only fire (startSession: false) does not call selectLanguageRuntimeFromPath', async () => {
        onDidChangeInterpreterEmitter.fire({
            resource: undefined,
            startSession: false,
            source: 'install-complete',
        });
        // Give the async listener a tick to run.
        await new Promise((r) => setTimeout(r, 0));
        sinon.assert.notCalled(selectSpy);
    });

    test('session-intent fire (startSession: true) calls selectLanguageRuntimeFromPath', async () => {
        const interpreter = { path: '/path/to/python' } as PythonEnvironment;
        interpreterService
            .setup((i) => i.getActiveInterpreter(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(interpreter));

        onDidChangeInterpreterEmitter.fire({
            resource: undefined,
            startSession: true,
            source: 'quickpick',
        });
        await new Promise((r) => setTimeout(r, 0));
        sinon.assert.calledOnceWithExactly(selectSpy, '/path/to/python');
    });

    let fakeSessionCount = 0;

    /** Build a fake that passes the `instanceof PythonRuntimeSession` filter without invoking the constructor. */
    function createFakePythonSession(
        extraRuntimeData: unknown,
        shutdown: sinon.SinonStub,
        runtimeId?: string,
        state: positron.RuntimeState = positron.RuntimeState.Idle,
        ended = new vscode.EventEmitter<positron.LanguageRuntimeExit>(),
    ): sessionModule.PythonRuntimeSession {
        fakeSessionCount += 1;
        return Object.assign(Object.create(sessionModule.PythonRuntimeSession.prototype), {
            runtimeMetadata: { runtimeId, extraRuntimeData },
            metadata: { sessionId: `session-${fakeSessionCount}` },
            shutdown,
            getRuntimeState: () => state,
            onDidEndSession: ended.event,
        });
    }

    test('interpreter deletion: clears registry entry and shuts down matching sessions', async () => {
        const deletedPath = '/path/to/deleted/python';
        pythonRuntimeManager.registeredPythonRuntimes.set(deletedPath, {
            runtimeId: 'r',
            extraRuntimeData: { pythonPath: deletedPath },
        } as any);

        // Wait until matching session's shutdown is called (or time out).
        let shutdownResolver: () => void = () => undefined;
        const shutdownDone = new Promise<void>((resolve) => {
            shutdownResolver = resolve;
        });
        const matchingShutdown = sinon.stub().callsFake(async () => {
            shutdownResolver();
        });
        const matchingSession = createFakePythonSession({ pythonPath: deletedPath }, matchingShutdown);
        const otherShutdown = sinon.stub().resolves();
        const otherSession = createFakePythonSession({ pythonPath: '/other/python' }, otherShutdown);
        // A non-Python session (e.g. R) without extraRuntimeData must not abort the cleanup.
        const nonPythonShutdown = sinon.stub().resolves();
        const nonPythonSession = {
            runtimeMetadata: { extraRuntimeData: undefined },
            shutdown: nonPythonShutdown,
        };
        getActiveSessionsImpl = async () => [nonPythonSession as any, matchingSession, otherSession];

        onDidChangeInterpretersEmitter.fire({ old: { path: deletedPath } as any, new: undefined });
        await Promise.race([shutdownDone, new Promise((r) => setTimeout(r, 500))]);

        assert.strictEqual(pythonRuntimeManager.registeredPythonRuntimes.has(deletedPath), false);
        sinon.assert.calledOnce(matchingShutdown);
        sinon.assert.notCalled(otherShutdown);
        sinon.assert.notCalled(nonPythonShutdown);
        sinon.assert.notCalled(selectSpy);
    });

    test('interpreter deletion: a session asked to shut down is not asked again until it ends', async () => {
        // The shutdown request returns before the kernel exits, and the session's
        // state stays the same until then.
        const deletedPath = '/path/to/deleted/python';
        const shutdown = sinon.stub().resolves();
        const ended = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
        const session = createFakePythonSession(
            { pythonPath: deletedPath },
            shutdown,
            'r',
            positron.RuntimeState.Idle,
            ended,
        );
        getActiveSessionsImpl = async () => [session];
        const deleted = () =>
            onDidChangeInterpretersEmitter.fire({ old: { path: deletedPath } as any, new: undefined });

        deleted();
        deleted();
        await new Promise((r) => setTimeout(r, 0));
        const callsBeforeEnd = shutdown.callCount;
        ended.fire({} as positron.LanguageRuntimeExit);
        deleted();
        await new Promise((r) => setTimeout(r, 0));

        assert.deepStrictEqual(
            { callsBeforeEnd, callsAfterEnd: shutdown.callCount },
            { callsBeforeEnd: 1, callsAfterEnd: 2 },
        );
    });

    test('interpreter deletion: a delete reported after the env is back keeps sessions on its new runtime', async () => {
        // Delete and Recreate with another Python, with the delete delivered after the new
        // session started: only the session on the old runtime is shut down.
        const venvPath = '/path/to/.venv/bin/python';
        sinon.stub(fs, 'pathExists').withArgs(venvPath).resolves(true);
        const currentRuntime = { runtimeId: 'python-3.11', extraRuntimeData: { pythonPath: venvPath } } as any;
        pythonRuntimeManager.registeredPythonRuntimes.set(venvPath, currentRuntime);
        const registerStub = sinon
            .stub(pythonRuntimeManager, 'registerLanguageRuntimeFromPath')
            .resolves(currentRuntime);
        const staleShutdown = sinon.stub().resolves();
        const newShutdown = sinon.stub().resolves();
        getActiveSessionsImpl = async () => [
            createFakePythonSession({ pythonPath: venvPath }, staleShutdown, 'python-3.12'),
            createFakePythonSession({ pythonPath: venvPath }, newShutdown, 'python-3.11'),
        ];

        onDidChangeInterpretersEmitter.fire({ old: { path: venvPath } as any, new: undefined });
        await new Promise((r) => setTimeout(r, 0));

        sinon.assert.calledOnceWithExactly(registerStub, venvPath, false, true);
        assert.deepStrictEqual(
            {
                staleShutdowns: staleShutdown.callCount,
                newShutdowns: newShutdown.callCount,
                stillRegistered: pythonRuntimeManager.registeredPythonRuntimes.has(venvPath),
            },
            { staleShutdowns: 1, newShutdowns: 0, stillRegistered: true },
        );
    });

    test('interpreter deletion: a path that is back but cannot be resolved is treated as deleted', async () => {
        // A half-written venv: the executable exists but does not resolve yet.
        const venvPath = '/path/to/.venv/bin/python';
        sinon.stub(fs, 'pathExists').withArgs(venvPath).resolves(true);
        pythonRuntimeManager.registeredPythonRuntimes.set(venvPath, {
            runtimeId: 'python-3.12',
            extraRuntimeData: { pythonPath: venvPath },
        } as any);
        sinon.stub(pythonRuntimeManager, 'registerLanguageRuntimeFromPath').resolves(undefined);
        const shutdown = sinon.stub().resolves();
        getActiveSessionsImpl = async () => [
            createFakePythonSession({ pythonPath: venvPath }, shutdown, 'python-3.12'),
        ];

        onDidChangeInterpretersEmitter.fire({ old: { path: venvPath } as any, new: undefined });
        await new Promise((r) => setTimeout(r, 0));

        assert.deepStrictEqual(
            {
                shutdowns: shutdown.callCount,
                stillRegistered: pythonRuntimeManager.registeredPythonRuntimes.has(venvPath),
            },
            { shutdowns: 1, stillRegistered: false },
        );
    });

    test('interpreter deletion: skips sessions that have exited', async () => {
        // Create Environment > Delete and Recreate can shut down a session the
        // watcher already shut down; a shutdown sent to an exited kernel fails.
        const deletedPath = '/path/to/deleted/python';
        const exitedShutdown = sinon.stub().rejects(new Error('the kernel has exited'));
        getActiveSessionsImpl = async () => [
            createFakePythonSession({ pythonPath: deletedPath }, exitedShutdown, 'r', positron.RuntimeState.Exited),
        ];

        onDidChangeInterpretersEmitter.fire({ old: { path: deletedPath } as any, new: undefined });
        await new Promise((r) => setTimeout(r, 0));

        sinon.assert.notCalled(exitedShutdown);
    });

    test('interpreter replacement: retracts old alias and re-registers survivor with forceRefresh', async () => {
        // De-duplication collapsed a symlink alias into a shorter survivor path.
        // The survivor must be re-registered with forceRefresh so a stale cached
        // version for its path is re-resolved and superseded, not returned as is.
        const oldPath = '/path/to/long/symlink/python';
        const newPath = '/path/to/python';
        pythonRuntimeManager.registeredPythonRuntimes.set(oldPath, {
            runtimeId: 'old',
            extraRuntimeData: { pythonPath: oldPath },
        } as any);
        const registerStub = sinon.stub(pythonRuntimeManager, 'registerLanguageRuntimeFromPath').resolves(undefined);

        onDidChangeInterpretersEmitter.fire({ old: { path: oldPath } as any, new: { path: newPath } as any });
        await new Promise((r) => setTimeout(r, 0));

        assert.strictEqual(pythonRuntimeManager.registeredPythonRuntimes.has(oldPath), false);
        sinon.assert.calledOnceWithExactly(registerStub, newPath, false, true);
    });

    /** A same-path change event whose interpreter version went from `oldVersion` to `newVersion`. */
    function changedInPlace(pythonPath: string, oldVersion: string, newVersion: string) {
        const version = (raw: string) => {
            const [major, minor, patch] = raw.split('.').map(Number);
            return { raw, major, minor, patch };
        };
        return {
            old: { path: pythonPath, version: version(oldVersion) } as any,
            new: { path: pythonPath, version: version(newVersion) } as any,
        };
    }

    test('interpreter changed in place: a new minor version replaces the runtime and shuts down sessions on the old one', async () => {
        // A venv deleted and recreated with another Python can arrive as a
        // same-path update. Nothing is registered for the path here, as when the
        // session's runtime came from the workspace recommendation.
        const venvPath = '/path/to/.venv/bin/python';
        const registerStub = sinon
            .stub(pythonRuntimeManager, 'registerLanguageRuntimeFromPath')
            .resolves({ runtimeId: 'python-3.11', extraRuntimeData: { pythonPath: venvPath } } as any);
        const staleShutdown = sinon.stub().resolves();
        const staleSession = createFakePythonSession({ pythonPath: venvPath }, staleShutdown, 'python-3.12');
        const currentShutdown = sinon.stub().resolves();
        const currentSession = createFakePythonSession({ pythonPath: venvPath }, currentShutdown, 'python-3.11');
        getActiveSessionsImpl = async () => [staleSession, currentSession];

        onDidChangeInterpretersEmitter.fire(changedInPlace(venvPath, '3.12.14', '3.11.16'));
        await new Promise((r) => setTimeout(r, 0));

        sinon.assert.calledOnceWithExactly(registerStub, venvPath, false, true);
        sinon.assert.calledOnce(staleShutdown);
        sinon.assert.notCalled(currentShutdown);
    });

    test('interpreter changed in place: a patch-only change keeps the runtime and its sessions', async () => {
        // Discovery and a live resolve can disagree on the patch version of the
        // same interpreter; that must not shut down a working session.
        const venvPath = '/path/to/.venv/bin/python';
        pythonRuntimeManager.registeredPythonRuntimes.set(venvPath, {
            runtimeId: 'python-3.14.4',
            extraRuntimeData: { pythonPath: venvPath },
        } as any);
        const registerStub = sinon
            .stub(pythonRuntimeManager, 'registerLanguageRuntimeFromPath')
            .resolves({ runtimeId: 'python-3.14.6', extraRuntimeData: { pythonPath: venvPath } } as any);
        const shutdown = sinon.stub().resolves();
        getActiveSessionsImpl = async () => [
            createFakePythonSession({ pythonPath: venvPath }, shutdown, 'python-3.14.4'),
        ];

        onDidChangeInterpretersEmitter.fire(changedInPlace(venvPath, '3.14.4', '3.14.6'));
        await new Promise((r) => setTimeout(r, 0));

        sinon.assert.notCalled(registerStub);
        sinon.assert.notCalled(shutdown);
    });

    test('a rejected change handler does not poison the queue for later events', async () => {
        // If handling one event rejects (e.g. registration throws), the serialized
        // queue must stay resolved so later events are still handled -- otherwise a
        // single transient failure freezes interpreter syncing until reload.
        const registerStub = sinon
            .stub(pythonRuntimeManager, 'registerLanguageRuntimeFromPath')
            .rejects(new Error('transient failure'));

        const laterDeletedPath = '/path/to/later/python';
        pythonRuntimeManager.registeredPythonRuntimes.set(laterDeletedPath, {
            runtimeId: 'r',
            extraRuntimeData: { pythonPath: laterDeletedPath },
        } as any);

        // First event rejects while being handled; the second must still run.
        onDidChangeInterpretersEmitter.fire({ old: undefined, new: { path: '/path/to/added/python' } as any });
        onDidChangeInterpretersEmitter.fire({ old: { path: laterDeletedPath } as any, new: undefined });

        // Let the serialized queue drain.
        await new Promise((r) => setTimeout(r, 0));

        sinon.assert.called(registerStub);
        assert.strictEqual(pythonRuntimeManager.registeredPythonRuntimes.has(laterDeletedPath), false);
    });
});
