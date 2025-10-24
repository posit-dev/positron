/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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

    // TODO: Test createSession
    // test('createSession', async () => {
    // });

    // TODO: Test discoverRuntimes
    // test('discoverRuntimes', async () => {
    // });

    test('validateMetadata: returns the validated metadata', async () => {
        sinon.stub(fs, 'pathExists').resolves(true);

        const validated = await pythonRuntimeManager.validateMetadata(runtimeMetadata.object);

        assert.deepStrictEqual(validated, runtimeMetadata.object);
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
    });

    test('validateMetadata: throws if extra data is missing', async () => {
        const invalidRuntimeMetadata = createTypeMoq<positron.LanguageRuntimeMetadata>();
        assert.rejects(() => pythonRuntimeManager.validateMetadata(invalidRuntimeMetadata.object));
    });

    test('validateMetadata: throws if interpreter path does not exist', async () => {
        sinon.stub(fs, 'pathExists').resolves(false);
        assert.rejects(() => pythonRuntimeManager.validateMetadata(runtimeMetadata.object));
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
        pythonRuntimeManager.registeredPythonRuntimes.set(pythonPath, runtimeMetadata.object);

        await pythonRuntimeManager.selectLanguageRuntimeFromPath(pythonPath);

        verify(mockedPositronNamespaces.runtime!.selectLanguageRuntime(runtimeMetadata.object.runtimeId)).once();
    });
});

suite('Python runtime manager - recommendedWorkspaceRuntime', () => {
    let pythonRuntimeManager: PythonRuntimeManager;
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let interpreter: TypeMoq.IMock<PythonEnvironment>;
    let runtimeMetadata: positron.LanguageRuntimeMetadata;
    let disposableRegistry: TypeMoq.IMock<IDisposableRegistry>;

    let getUserDefaultInterpreterStub: sinon.SinonStub;
    let hasFilesStub: sinon.SinonStub;
    let createPythonRuntimeMetadataStub: sinon.SinonStub;

    setup(() => {
        // Create mocks
        serviceContainer = createTypeMoq<IServiceContainer>();
        interpreterService = createTypeMoq<IInterpreterService>();
        interpreter = createTypeMoq<PythonEnvironment>();
        disposableRegistry = createTypeMoq<IDisposableRegistry>();

        // Setup interpreter service
        serviceContainer.setup((s) => s.get(IInterpreterService)).returns(() => interpreterService.object);
        serviceContainer.setup((s) => s.get(IDisposableRegistry)).returns(() => disposableRegistry.object);

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
        hasFilesStub.withArgs(['*/bin/python']).resolves(false);

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
        hasFilesStub.withArgs(['*/bin/python']).resolves(false);

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
        hasFilesStub.withArgs(['*/bin/python']).resolves(false);

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
});
