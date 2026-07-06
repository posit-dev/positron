// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// --- Start Positron ---
/* eslint-disable import/no-duplicates */
// --- End Positron ---

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { WorkspaceConfiguration } from 'vscode';
import {
    getNativePythonFinder,
    isNativeEnvInfo,
    NativeEnvInfo,
    NativePythonFinder,
} from '../../client/pythonEnvironments/base/locators/common/nativePythonFinder';
import * as windowsApis from '../../client/common/vscodeApis/windowApis';
import { MockOutputChannel } from '../mockClasses';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';

// --- Start Positron ---
import { EventEmitter } from 'vscode';
import { bufferedEvents } from '../../client/pythonEnvironments/base/locators/common/nativePythonFinder';
import { createDeferred } from '../../client/common/utils/async';

// TODO: add test for python.interpreters.include here once we switch to Native Finder
suite('Native Python Finder', () => {
    // --- End Positron ---
    let finder: NativePythonFinder;
    let createLogOutputChannelStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;
    let configMock: typemoq.IMock<WorkspaceConfiguration>;
    let getWorkspaceFolderPathsStub: sinon.SinonStub;

    setup(() => {
        createLogOutputChannelStub = sinon.stub(windowsApis, 'createLogOutputChannel');
        createLogOutputChannelStub.returns(new MockOutputChannel('locator'));

        getWorkspaceFolderPathsStub = sinon.stub(workspaceApis, 'getWorkspaceFolderPaths');
        getWorkspaceFolderPathsStub.returns([]);

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        configMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        configMock.setup((c) => c.get<string>('venvPath')).returns(() => undefined);
        configMock.setup((c) => c.get<string[]>('venvFolders')).returns(() => []);
        configMock.setup((c) => c.get<string>('condaPath')).returns(() => '');
        configMock.setup((c) => c.get<string>('poetryPath')).returns(() => '');
        getConfigurationStub.returns(configMock.object);

        finder = getNativePythonFinder();
    });

    teardown(() => {
        sinon.restore();
    });

    suiteTeardown(() => {
        finder.dispose();
    });

    test('Refresh should return python environments', async () => {
        const envs = [];
        for await (const env of finder.refresh()) {
            envs.push(env);
        }

        // typically all test envs should have at least one environment
        assert.isNotEmpty(envs);
    });

    test('Resolve should return python environments with version', async () => {
        const envs = [];
        for await (const env of finder.refresh()) {
            envs.push(env);
        }

        // typically all test envs should have at least one environment
        assert.isNotEmpty(envs);

        // pick and env without version
        const env: NativeEnvInfo | undefined = envs
            .filter((e) => isNativeEnvInfo(e))
            .find((e) => e.version && e.version.length > 0 && (e.executable || (e as NativeEnvInfo).prefix));

        if (env) {
            env.version = undefined;
        } else {
            assert.fail('Expected at least one env with valid version');
        }

        const envPath = env.executable ?? env.prefix;
        if (envPath) {
            const resolved = await finder.resolve(envPath);
            assert.isString(resolved.version, 'Version must be a string');
            assert.isTrue((resolved?.version?.length ?? 0) > 0, 'Version must not be empty');
        } else {
            assert.fail('Expected either executable or prefix to be defined');
        }
    });
});

// --- Start Positron ---
suite('bufferedEvents', () => {
    test('yields buffered events in order and stops once completion is signalled', async () => {
        const emitter = new EventEmitter<number>();
        const completed = createDeferred<void>();
        // Subscription happens eagerly, so events fired before iteration are buffered.
        const gen = bufferedEvents<number>(emitter.event, completed.promise);
        emitter.fire(1);
        emitter.fire(2);
        completed.resolve();

        const received: number[] = [];
        for await (const item of gen) {
            received.push(item);
        }

        assert.deepStrictEqual(received, [1, 2]);
    });

    test('drains events buffered while the consumer is busy, even after completion (#14483)', async () => {
        const emitter = new EventEmitter<number>();
        const completed = createDeferred<void>();
        const gen = bufferedEvents<number>(emitter.event, completed.promise);
        emitter.fire(1);

        const received: number[] = [];
        for await (const item of gen) {
            received.push(item);
            if (item === 1) {
                // While the consumer is busy handling item 1, more events arrive and
                // the producer signals completion. A naive loop that exits the moment
                // completion flips would drop these; they must still be yielded.
                emitter.fire(2);
                emitter.fire(3);
                completed.resolve();
                // Simulate slow per-item work so the burst lands during this yield.
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        assert.deepStrictEqual(received, [1, 2, 3]);
    });
});
// --- End Positron ---
