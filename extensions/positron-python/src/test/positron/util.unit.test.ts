/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkspaceFolder } from 'vscode';
import { IWorkspaceService } from '../../client/common/application/types';
import { getActiveInterpreterConfigTarget } from '../../client/positron/util';
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
