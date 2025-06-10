/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Uri, workspace, WorkspaceFolder } from 'vscode';
import * as sinon from 'sinon';
import { Commands } from '../../../../client/common/constants';
import { CommandManager } from '../../../../client/common/application/commandManager';
import { ICommandManager, IWorkspaceService } from '../../../../client/common/application/types';
import { WorkspaceService } from '../../../../client/common/application/workspace';
import { CreatePyprojectTomlCommandHandler } from '../../../../client/common/application/commands/createPyprojectToml';

suite('Create pyproject.toml Command', () => {
    let createPyprojectTomlCommandHandler: CreatePyprojectTomlCommandHandler;
    let cmdManager: ICommandManager;
    let workspaceService: IWorkspaceService;
    let workspaceStatStub: sinon.SinonStub;
    let workspaceWriteFileStub: sinon.SinonStub;

    setup(async () => {
        cmdManager = mock(CommandManager);
        workspaceService = mock(WorkspaceService);

        // Create a mock workspace.fs object with proper methods
        const mockFs = {
            stat: sinon.stub(),
            writeFile: sinon.stub(),
        };

        // Replace workspace.fs with our mock
        (workspace as any).fs = mockFs;

        // Store references to the stubs for test use
        workspaceStatStub = mockFs.stat;
        workspaceWriteFileStub = mockFs.writeFile;

        createPyprojectTomlCommandHandler = new CreatePyprojectTomlCommandHandler(
            instance(cmdManager),
            instance(workspaceService),
            [],
        );

        await createPyprojectTomlCommandHandler.activate();
    });

    teardown(() => {
        sinon.restore();
    });

    test('Create pyproject.toml command is registered', async () => {
        verify(cmdManager.registerCommand(Commands.Create_Pyproject_Toml, anything(), anything())).once();
    });

    test('Returns error when no workspace folder found', async () => {
        when(workspaceService.workspaceFolders).thenReturn(undefined);

        const result = await createPyprojectTomlCommandHandler.createPyprojectToml();

        assert.equal(result.success, false);
        if (!result.success) {
            assert.equal(result.error, 'No workspace folder found');
        }
    });

    test('Successfully creates pyproject.toml file when it does not exist', async () => {
        const mockWorkspaceFolder: WorkspaceFolder = {
            uri: Uri.file('/test/workspace'),
            name: 'test-workspace',
            index: 0,
        };
        when(workspaceService.workspaceFolders).thenReturn([mockWorkspaceFolder]);

        // Mock file does not exist (stat throws)
        workspaceStatStub.rejects(new Error('File not found'));
        // Mock successful file write
        workspaceWriteFileStub.resolves();

        const result = await createPyprojectTomlCommandHandler.createPyprojectToml();

        assert.equal(result.success, true);
        if (result.success) {
            assert.include(result.path, 'pyproject.toml');
        }
        assert.isTrue(workspaceWriteFileStub.calledOnce, 'writeFile should be called once');
    });

    test('Returns success when pyproject.toml file already exists', async () => {
        const mockWorkspaceFolder: WorkspaceFolder = {
            uri: Uri.file('/test/workspace'),
            name: 'test-workspace',
            index: 0,
        };
        when(workspaceService.workspaceFolders).thenReturn([mockWorkspaceFolder]);

        // Mock file exists (stat succeeds)
        workspaceStatStub.resolves({ type: 1, ctime: 0, mtime: 0, size: 100 });

        const result = await createPyprojectTomlCommandHandler.createPyprojectToml();

        assert.equal(result.success, true);
        if (result.success) {
            assert.include(result.path, 'pyproject.toml');
        }
        assert.isFalse(workspaceWriteFileStub.called, 'writeFile should not be called when file exists');
    });

    test('Returns error when file write operation fails', async () => {
        const mockWorkspaceFolder: WorkspaceFolder = {
            uri: Uri.file('/test/workspace'),
            name: 'test-workspace',
            index: 0,
        };
        when(workspaceService.workspaceFolders).thenReturn([mockWorkspaceFolder]);

        // Mock file does not exist (stat throws)
        workspaceStatStub.rejects(new Error('File not found'));
        // Mock file write failure
        const writeError = new Error('Permission denied');
        workspaceWriteFileStub.rejects(writeError);

        const result = await createPyprojectTomlCommandHandler.createPyprojectToml();

        assert.equal(result.success, false);
        if (!result.success) {
            assert.include(result.error, 'Failed to create pyproject.toml');
            assert.include(result.error, 'Permission denied');
        }
        assert.isTrue(workspaceWriteFileStub.calledOnce, 'writeFile should be called once');
    });
});
