/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { WorkspaceFolder } from 'vscode';
import { IWorkspaceService } from '../../client/common/application/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import {
    getActiveInterpreterConfigTarget,
    resolveInterpreterWithRetry,
    RESOLVE_TIMEOUT_MS,
} from '../../client/positron/util';
import { mock } from './utils';

suite('getActiveInterpreterConfigTarget', () => {
    [undefined, []].forEach((workspaceFolders) => {
        const suffix = workspaceFolders === undefined ? 'no workspace folders' : 'empty workspace folders';
        test(`Global target with no resource when there are ${suffix}`, () => {
            const workspaceService = mock<IWorkspaceService>({
                workspaceFolders,
                workspaceFile: undefined,
            });

            assert.deepStrictEqual(getActiveInterpreterConfigTarget(workspaceService), {
                configTarget: vscode.ConfigurationTarget.Global,
                folderUri: undefined,
            });
        });
    });

    test('Workspace target with the workspace file uri for a multi-folder (.code-workspace) workspace', () => {
        const workspaceFile = vscode.Uri.file('/path/to/my.code-workspace');
        const workspaceService = mock<IWorkspaceService>({
            workspaceFolders: [{ uri: vscode.Uri.file('/path/to/folder'), name: 'folder', index: 0 }],
            workspaceFile,
        });

        assert.deepStrictEqual(getActiveInterpreterConfigTarget(workspaceService), {
            configTarget: vscode.ConfigurationTarget.Workspace,
            folderUri: workspaceFile,
        });
    });

    test('WorkspaceFolder target with the folder uri for a single-folder workspace', () => {
        const folderUri = vscode.Uri.file('/path/to/folder');
        const workspaceFolders: WorkspaceFolder[] = [{ uri: folderUri, name: 'folder', index: 0 }];
        const workspaceService = mock<IWorkspaceService>({
            workspaceFolders,
            workspaceFile: undefined,
        });

        assert.deepStrictEqual(getActiveInterpreterConfigTarget(workspaceService), {
            configTarget: vscode.ConfigurationTarget.WorkspaceFolder,
            folderUri,
        });
    });
});

suite('resolveInterpreterWithRetry', () => {
    const pythonPath = '/path/to/python';
    let interpreter: PythonEnvironment;

    setup(() => {
        interpreter = mock<PythonEnvironment>({ path: pythonPath });
    });

    teardown(() => {
        sinon.restore();
    });

    test('returns the interpreter without refreshing when the first resolve succeeds', async () => {
        const getDetails = sinon.stub().resolves(interpreter);
        const triggerRefresh = sinon.stub().resolves();
        const interpreterService = mock<IInterpreterService>({
            getInterpreterDetails: getDetails,
            triggerRefresh,
        });

        const result = await resolveInterpreterWithRetry(interpreterService, pythonPath);

        assert.strictEqual(result, interpreter);
        sinon.assert.calledOnce(getDetails);
        sinon.assert.notCalled(triggerRefresh);
    });

    test('refreshes and retries when the first resolve returns undefined', async () => {
        const getDetails = sinon.stub();
        getDetails.onFirstCall().resolves(undefined);
        getDetails.onSecondCall().resolves(interpreter);
        const triggerRefresh = sinon.stub().resolves();
        const interpreterService = mock<IInterpreterService>({
            getInterpreterDetails: getDetails,
            triggerRefresh,
        });

        const result = await resolveInterpreterWithRetry(interpreterService, pythonPath);

        assert.strictEqual(result, interpreter);
        sinon.assert.calledTwice(getDetails);
        sinon.assert.calledOnce(triggerRefresh);
    });

    test('returns undefined when the resolve still fails after a refresh', async () => {
        const getDetails = sinon.stub().resolves(undefined);
        const triggerRefresh = sinon.stub().resolves();
        const interpreterService = mock<IInterpreterService>({
            getInterpreterDetails: getDetails,
            triggerRefresh,
        });

        const result = await resolveInterpreterWithRetry(interpreterService, pythonPath);

        assert.strictEqual(result, undefined);
        sinon.assert.calledTwice(getDetails);
        sinon.assert.calledOnce(triggerRefresh);
    });

    test('treats a rejected resolve as unresolved and retries', async () => {
        const getDetails = sinon.stub();
        getDetails.onFirstCall().rejects(new Error('PET hiccup'));
        getDetails.onSecondCall().resolves(interpreter);
        const triggerRefresh = sinon.stub().resolves();
        const interpreterService = mock<IInterpreterService>({
            getInterpreterDetails: getDetails,
            triggerRefresh,
        });

        const result = await resolveInterpreterWithRetry(interpreterService, pythonPath);

        assert.strictEqual(result, interpreter);
        sinon.assert.calledOnce(triggerRefresh);
    });

    test('ignores a rejected refresh and still retries the resolve', async () => {
        const getDetails = sinon.stub();
        getDetails.onFirstCall().resolves(undefined);
        getDetails.onSecondCall().resolves(interpreter);
        const triggerRefresh = sinon.stub().rejects(new Error('refresh failed'));
        const interpreterService = mock<IInterpreterService>({
            getInterpreterDetails: getDetails,
            triggerRefresh,
        });

        const result = await resolveInterpreterWithRetry(interpreterService, pythonPath);

        assert.strictEqual(result, interpreter);
    });

    test('times out a hung resolve and falls through to refresh and retry', async () => {
        const clock = sinon.useFakeTimers();
        try {
            const getDetails = sinon.stub();
            getDetails.onFirstCall().returns(new Promise(() => {})); // never settles
            getDetails.onSecondCall().resolves(interpreter);
            const triggerRefresh = sinon.stub().resolves();
            const interpreterService = mock<IInterpreterService>({
                getInterpreterDetails: getDetails,
                triggerRefresh,
            });

            const resultPromise = resolveInterpreterWithRetry(interpreterService, pythonPath);
            await clock.tickAsync(RESOLVE_TIMEOUT_MS);
            const result = await resultPromise;

            assert.strictEqual(result, interpreter);
            sinon.assert.calledOnce(triggerRefresh);
        } finally {
            clock.restore();
        }
    });
});
