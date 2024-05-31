/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import * as fs from 'fs-extra';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import { verify } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import * as runtime from '../../client/positron/runtime';
import * as session from '../../client/positron/session';
import { IEnvironmentVariablesProvider } from '../../client/common/variables/types';
import { IConfigurationService, IDisposable } from '../../client/common/types';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonRuntimeManager } from '../../client/positron/manager';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { mockedPositronNamespaces } from '../vscode-mock';

suite('Python runtime manager', () => {
    const pythonPath = 'pythonPath';

    let runtimeMetadata: TypeMoq.IMock<positron.LanguageRuntimeMetadata>;
    let interpreter: TypeMoq.IMock<PythonEnvironment>;
    let configService: TypeMoq.IMock<IConfigurationService>;
    let envVarsProvider: TypeMoq.IMock<IEnvironmentVariablesProvider>;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let pythonRuntimeManager: PythonRuntimeManager;
    let disposables: IDisposable[];

    setup(() => {
        runtimeMetadata = TypeMoq.Mock.ofType<positron.LanguageRuntimeMetadata>();
        interpreter = TypeMoq.Mock.ofType<PythonEnvironment>();
        configService = TypeMoq.Mock.ofType<IConfigurationService>();
        envVarsProvider = TypeMoq.Mock.ofType<IEnvironmentVariablesProvider>();
        interpreterService = TypeMoq.Mock.ofType<IInterpreterService>();
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();

        runtimeMetadata.setup((r) => r.runtimeId).returns(() => 'runtimeId');
        runtimeMetadata
            .setup((r) => r.extraRuntimeData)
            .returns(() => ({ pythonPath, pythonEnvironmentId: 'pythonEnvironmentId' }));

        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(interpreter.object));

        serviceContainer.setup((s) => s.get(IConfigurationService)).returns(() => configService.object);
        serviceContainer.setup((s) => s.get(IEnvironmentVariablesProvider)).returns(() => envVarsProvider.object);
        serviceContainer.setup((s) => s.get(IInterpreterService)).returns(() => interpreterService.object);

        pythonRuntimeManager = new PythonRuntimeManager(serviceContainer.object, interpreterService.object);
        disposables = [];
    });

    teardown(() => {
        sinon.restore();
        disposables.forEach((d) => d.dispose());
    });

    test('constructor', () => {
        verify(mockedPositronNamespaces.runtime!.registerLanguageRuntimeManager(pythonRuntimeManager)).once();
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
        const sessionMetadata = TypeMoq.Mock.ofType<positron.RuntimeSessionMetadata>();
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

    test('validateMetadata: throws if extra data is missing', async () => {
        const invalidRuntimeMetadata = TypeMoq.Mock.ofType<positron.LanguageRuntimeMetadata>();
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
            await pythonRuntimeManager.registerLanguageRuntimeFromPath(pythonPath);
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
