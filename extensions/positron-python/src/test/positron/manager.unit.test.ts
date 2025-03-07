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
import { WorkspaceConfiguration } from 'vscode';
import * as fs from '../../client/common/platform/fs-paths';
import * as runtime from '../../client/positron/runtime';
import * as session from '../../client/positron/session';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import * as interpreterSettings from '../../client/positron/interpreterSettings';
import { IEnvironmentVariablesProvider } from '../../client/common/variables/types';
import { IConfigurationService, IDisposable } from '../../client/common/types';
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

        runtimeMetadata.setup((r) => r.runtimeId).returns(() => 'runtimeId');
        runtimeMetadata.setup((r) => r.extraRuntimeData).returns(() => ({ pythonPath }));

        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(interpreter.object));

        serviceContainer.setup((s) => s.get(IConfigurationService)).returns(() => configService.object);
        serviceContainer.setup((s) => s.get(IEnvironmentVariablesProvider)).returns(() => envVarsProvider.object);
        serviceContainer.setup((s) => s.get(IInterpreterService)).returns(() => interpreterService.object);

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake((section?: string, _scope?: any) => {
            if (section === 'python') {
                return workspaceConfig.object;
            }
            return undefined;
        });

        isVersionSupportedStub = sinon.stub(interpreterSettings, 'isVersionSupported');
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

    test('restoreSession: creates and returns a Python runtime session', async () => {
        const sessionMetadata = createTypeMoq<positron.RuntimeSessionMetadata>();
        const pythonRuntimeSession = sinon.stub(session, 'PythonRuntimeSession');

        const result = await pythonRuntimeManager.restoreSession(runtimeMetadata.object, sessionMetadata.object);

        assert.strictEqual(result, pythonRuntimeSession.returnValues[0]);
        sinon.assert.calledOnceWithExactly(
            pythonRuntimeSession,
            runtimeMetadata.object,
            sessionMetadata.object,
            serviceContainer.object,
        );
    });

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
