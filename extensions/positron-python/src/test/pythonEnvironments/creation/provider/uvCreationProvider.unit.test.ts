/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import { assert, use as chaiUse } from 'chai';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { CancellationToken, ProgressOptions, Uri } from 'vscode';
import { CreateEnvironmentProgress } from '../../../../client/pythonEnvironments/creation/types';
import { UvCreationProvider } from '../../../../client/pythonEnvironments/creation/provider/uvCreationProvider';
import * as wsSelect from '../../../../client/pythonEnvironments/creation/common/workspaceSelection';
import * as windowApis from '../../../../client/common/vscodeApis/windowApis';
import * as uvUtils from '../../../../client/pythonEnvironments/creation/provider/uvUtils';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../constants';
import * as rawProcessApis from '../../../../client/common/process/rawProcessApis';
import { Output } from '../../../../client/common/process/types';
import { createDeferred } from '../../../../client/common/utils/async';
import * as commonUtils from '../../../../client/pythonEnvironments/creation/common/commonUtils';
import { CreateEnv } from '../../../../client/common/utils/localize';
import { UvUtils } from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import * as venvUtils from '../../../../client/pythonEnvironments/creation/provider/venvUtils';
import {
    CreateEnvironmentProvider,
    CreateEnvironmentResult,
} from '../../../../client/pythonEnvironments/creation/proposed.createEnvApis';

chaiUse(chaiAsPromised.default);

suite('UV Creation provider tests', () => {
    let uvProvider: CreateEnvironmentProvider;
    let progressMock: typemoq.IMock<CreateEnvironmentProgress>;
    let getUvUtilsStub: sinon.SinonStub;
    let pickPythonVersionStub: sinon.SinonStub;
    let pickWorkspaceFolderStub: sinon.SinonStub;
    let execObservableStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;
    let showErrorMessageWithLogsStub: sinon.SinonStub;
    let pickExistingVenvActionStub: sinon.SinonStub;
    let getVenvExecutableStub: sinon.SinonStub;

    setup(() => {
        pickWorkspaceFolderStub = sinon.stub(wsSelect, 'pickWorkspaceFolder');
        getUvUtilsStub = sinon.stub(UvUtils, 'getUvUtils');
        pickPythonVersionStub = sinon.stub(uvUtils, 'pickPythonVersion');
        execObservableStub = sinon.stub(rawProcessApis, 'execObservable');
        withProgressStub = sinon.stub(windowApis, 'withProgress');

        showErrorMessageWithLogsStub = sinon.stub(commonUtils, 'showPositronErrorMessageWithLogs');
        showErrorMessageWithLogsStub.resolves();

        pickExistingVenvActionStub = sinon.stub(venvUtils, 'pickExistingVenvAction');
        pickExistingVenvActionStub.resolves(venvUtils.ExistingVenvAction.Create);

        getVenvExecutableStub = sinon.stub(commonUtils, 'getVenvExecutable');

        progressMock = typemoq.Mock.ofType<CreateEnvironmentProgress>();
        uvProvider = new UvCreationProvider();
    });

    teardown(() => {
        sinon.restore();
    });

    test('No uv installed', async () => {
        getUvUtilsStub.resolves(undefined);

        assert.isUndefined(await uvProvider.createEnvironment());
    });

    test('No workspace selected', async () => {
        getUvUtilsStub.resolves({});
        pickWorkspaceFolderStub.resolves(undefined);

        await assert.isRejected(uvProvider.createEnvironment());
    });

    test('No python version picked selected', async () => {
        getUvUtilsStub.resolves({});
        pickWorkspaceFolderStub.resolves({
            uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
            name: 'workspace1',
            index: 0,
        });
        pickPythonVersionStub.resolves(undefined);

        await assert.isRejected(uvProvider.createEnvironment());
        assert.isTrue(pickExistingVenvActionStub.calledOnce);
    });

    test('Create uv environment', async () => {
        getUvUtilsStub.resolves({});
        const workspace1 = {
            uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
            name: 'workspace1',
            index: 0,
        };
        pickWorkspaceFolderStub.resolves(workspace1);
        pickPythonVersionStub.resolves('3.12');

        const deferred = createDeferred();
        let _next: undefined | ((value: Output<string>) => void);
        let _complete: undefined | (() => void);
        execObservableStub.callsFake(() => {
            deferred.resolve();
            return {
                proc: {
                    exitCode: 0,
                },
                out: {
                    subscribe: (
                        next?: (value: Output<string>) => void,
                        _error?: (error: unknown) => void,
                        complete?: () => void,
                    ) => {
                        _next = next;
                        _complete = complete;
                    },
                },
                dispose: () => undefined,
            };
        });

        progressMock.setup((p) => p.report({ message: CreateEnv.statusStarting })).verifiable(typemoq.Times.once());

        withProgressStub.callsFake(
            (
                _options: ProgressOptions,
                task: (
                    progress: CreateEnvironmentProgress,
                    token?: CancellationToken,
                ) => Thenable<CreateEnvironmentResult>,
            ) => task(progressMock.object),
        );

        const promise = uvProvider.createEnvironment();
        await deferred.promise;
        assert.isDefined(_next);
        assert.isDefined(_complete);

        _next!({ out: 'Created virtual environment', source: 'stdout' });
        _complete!();

        const expectedPath = path.join(
            workspace1.uri.fsPath,
            process.platform === 'win32' ? '\\.venv\\Scripts\\python.exe' : '/.venv/bin/python',
        );
        const result = await promise;
        assert.deepStrictEqual(result, {
            path: expectedPath,
            workspaceFolder: workspace1,
        });
        assert.isTrue(showErrorMessageWithLogsStub.notCalled);
        assert.isTrue(pickExistingVenvActionStub.calledOnce);
    });

    test('Create uv environment failed', async () => {
        getUvUtilsStub.resolves({});
        pickWorkspaceFolderStub.resolves({
            uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
            name: 'workspace1',
            index: 0,
        });
        pickPythonVersionStub.resolves('3.12');

        const deferred = createDeferred();
        let _error: undefined | ((error: unknown) => void);
        let _complete: undefined | (() => void);
        execObservableStub.callsFake(() => {
            deferred.resolve();
            return {
                proc: undefined,
                out: {
                    subscribe: (
                        _next?: (value: Output<string>) => void,
                        error?: (error: unknown) => void,
                        complete?: () => void,
                    ) => {
                        _error = error;
                        _complete = complete;
                    },
                },
                dispose: () => undefined,
            };
        });

        progressMock.setup((p) => p.report({ message: CreateEnv.statusStarting })).verifiable(typemoq.Times.once());

        withProgressStub.callsFake(
            (
                _options: ProgressOptions,
                task: (
                    progress: CreateEnvironmentProgress,
                    token?: CancellationToken,
                ) => Thenable<CreateEnvironmentResult>,
            ) => task(progressMock.object),
        );

        const promise = uvProvider.createEnvironment();
        await deferred.promise;
        assert.isDefined(_error);
        _error!('bad arguments');
        _complete!();
        const result = await promise;
        assert.ok(result?.error);
        assert.isTrue(showErrorMessageWithLogsStub.calledOnce);
        assert.isTrue(pickExistingVenvActionStub.calledOnce);
    });

    test('Create uv environment failed (non-zero exit code)', async () => {
        getUvUtilsStub.resolves({});
        const workspace1 = {
            uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
            name: 'workspace1',
            index: 0,
        };
        pickWorkspaceFolderStub.resolves(workspace1);
        pickPythonVersionStub.resolves('3.12');

        const deferred = createDeferred();
        let _next: undefined | ((value: Output<string>) => void);
        let _complete: undefined | (() => void);
        execObservableStub.callsFake(() => {
            deferred.resolve();
            return {
                proc: {
                    exitCode: 1,
                },
                out: {
                    subscribe: (
                        next?: (value: Output<string>) => void,
                        _error?: (error: unknown) => void,
                        complete?: () => void,
                    ) => {
                        _next = next;
                        _complete = complete;
                    },
                },
                dispose: () => undefined,
            };
        });

        progressMock.setup((p) => p.report({ message: CreateEnv.statusStarting })).verifiable(typemoq.Times.once());

        withProgressStub.callsFake(
            (
                _options: ProgressOptions,
                task: (
                    progress: CreateEnvironmentProgress,
                    token?: CancellationToken,
                ) => Thenable<CreateEnvironmentResult>,
            ) => task(progressMock.object),
        );

        const promise = uvProvider.createEnvironment();
        await deferred.promise;
        assert.isDefined(_next);
        assert.isDefined(_complete);

        _next!({ out: 'Failed to create virtual environment', source: 'stdout' });
        _complete!();
        const result = await promise;
        assert.ok(result?.error);
        assert.isTrue(showErrorMessageWithLogsStub.calledOnce);
        assert.isTrue(pickExistingVenvActionStub.calledOnce);
    });

    test('Use existing uv environment', async () => {
        getUvUtilsStub.resolves({});
        const workspace1 = {
            uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
            name: 'workspace1',
            index: 0,
        };
        pickWorkspaceFolderStub.resolves(workspace1);
        pickExistingVenvActionStub.resolves(venvUtils.ExistingVenvAction.UseExisting);
        getVenvExecutableStub.returns('/path/to/existing/venv/bin/python');

        const result = await uvProvider.createEnvironment();
        assert.isTrue(showErrorMessageWithLogsStub.notCalled);
        assert.isTrue(pickPythonVersionStub.notCalled);
        assert.isTrue(execObservableStub.notCalled);
        assert.isTrue(withProgressStub.notCalled);

        assert.deepStrictEqual(result, { path: '/path/to/existing/venv/bin/python', workspaceFolder: workspace1 });
    });

    test('Create uv environment with options and pre-selected python version', async () => {
        getUvUtilsStub.resolves({});
        const newProjectWorkspace = {
            uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'newProjectWorkspace')),
            name: 'newProjectWorkspace',
            index: 0,
        };
        pickWorkspaceFolderStub.resolves(newProjectWorkspace);
        pickPythonVersionStub.resolves('3.12');

        const deferred = createDeferred();
        let _next: undefined | ((value: Output<string>) => void);
        let _complete: undefined | (() => void);
        execObservableStub.callsFake(() => {
            deferred.resolve();
            return {
                proc: {
                    exitCode: 0,
                },
                out: {
                    subscribe: (
                        next?: (value: Output<string>) => void,
                        _error?: (error: unknown) => void,
                        complete?: () => void,
                    ) => {
                        _next = next;
                        _complete = complete;
                    },
                },
                dispose: () => undefined,
            };
        });

        progressMock.setup((p) => p.report({ message: CreateEnv.statusStarting })).verifiable(typemoq.Times.once());

        withProgressStub.callsFake(
            (
                _options: ProgressOptions,
                task: (
                    progress: CreateEnvironmentProgress,
                    token?: CancellationToken,
                ) => Thenable<CreateEnvironmentResult>,
            ) => task(progressMock.object),
        );

        // Options for createEnvironment
        const options = {
            workspaceFolder: newProjectWorkspace,
            uvPythonVersion: '3.12',
        };

        const promise = uvProvider.createEnvironment(options);
        await deferred.promise;
        assert.isDefined(_next);
        assert.isDefined(_complete);

        _next!({ out: 'Created virtual environment', source: 'stdout' });
        _complete!();

        const expectedPath = path.join(
            newProjectWorkspace.uri.fsPath,
            process.platform === 'win32' ? '\\.venv\\Scripts\\python.exe' : '/.venv/bin/python',
        );
        assert.deepStrictEqual(await promise, {
            path: expectedPath,
            workspaceFolder: newProjectWorkspace,
        });
        assert.isTrue(showErrorMessageWithLogsStub.notCalled);
        assert.isTrue(pickExistingVenvActionStub.calledOnce);
    });
});
