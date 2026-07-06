/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../../client/common/application/types';
import { IFileSystem } from '../../client/common/platform/types';
import { findWorkspaceRequirementsFile } from '../../client/positron/packages/workspaceRequirements';

suite('findWorkspaceRequirementsFile', () => {
    let workspaceService: IWorkspaceService;
    let fileSystem: IFileSystem;

    setup(() => {
        workspaceService = {
            get workspaceFolders() {
                return undefined;
            },
        } as any;
        fileSystem = { fileExists: sinon.stub().resolves(false) } as any;
    });

    teardown(() => sinon.restore());

    test('returns undefined when there is no workspace folder', async () => {
        const result = await findWorkspaceRequirementsFile(workspaceService, fileSystem);
        expect(result).to.equal(undefined);
        expect((fileSystem.fileExists as sinon.SinonStub).called).to.equal(false);
    });

    test('returns undefined when requirements.txt does not exist', async () => {
        const folder = { uri: Uri.file('/workspace'), name: 'ws', index: 0 };
        sinon.stub(workspaceService, 'workspaceFolders').value([folder]);
        const result = await findWorkspaceRequirementsFile(workspaceService, fileSystem);
        expect(result).to.equal(undefined);
    });

    test('returns the path when requirements.txt exists in the first workspace folder', async () => {
        const folder = { uri: Uri.file('/workspace'), name: 'ws', index: 0 };
        const expected = path.join(folder.uri.fsPath, 'requirements.txt');
        sinon.stub(workspaceService, 'workspaceFolders').value([folder]);
        (fileSystem.fileExists as sinon.SinonStub).withArgs(expected).resolves(true);

        const result = await findWorkspaceRequirementsFile(workspaceService, fileSystem);
        expect(result).to.equal(expected);
    });
});
