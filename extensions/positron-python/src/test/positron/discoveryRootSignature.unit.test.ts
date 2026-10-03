/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { Uri, WorkspaceConfiguration } from 'vscode';
import { anything, when } from 'ts-mockito';
import * as platformApis from '../../client/common/utils/platform';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import { getPythonDiscoveryRootSignature } from '../../client/positron/discoveryRootSignature';
import { mockedVSCodeNamespaces } from '../vscode-mock';

suite('Python discovery root signature', () => {
    // A home directory that does not exist on disk, so every entry is recorded
    // verbatim (an existing path would be replaced by its realpath).
    const homeDir = path.join('/', 'nonexistent-home-for-tests');
    let getEnvironmentVariableStub: sinon.SinonStub;
    let getUserHomeDirStub: sinon.SinonStub;
    let getWorkspaceFoldersStub: sinon.SinonStub;
    let include: string[] | undefined;

    setup(() => {
        include = undefined;
        getUserHomeDirStub = sinon.stub(platformApis, 'getUserHomeDir').returns(homeDir);
        getEnvironmentVariableStub = sinon.stub(platformApis, 'getEnvironmentVariable');
        getEnvironmentVariableStub.returns(undefined);

        const configMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        configMock.setup((c) => c.get(typemoq.It.isAnyString())).returns(() => undefined);
        configMock.setup((c) => c.get('interpreters.include')).returns(() => include);
        when(mockedVSCodeNamespaces.workspace!.getConfiguration(anything())).thenReturn(configMock.object);
        sinon.stub(workspaceApis, 'getConfiguration').returns(configMock.object);
        getWorkspaceFoldersStub = sinon.stub(workspaceApis, 'getWorkspaceFolders').returns(undefined);
    });

    teardown(() => {
        sinon.restore();
    });

    test('Includes ~/.virtualenvs so environments created there are noticed on a warm start', async () => {
        const signature = await getPythonDiscoveryRootSignature();

        const paths = signature.entries.map((e) => e.path);
        assert.ok(
            paths.includes(path.join(homeDir, '.virtualenvs')),
            `expected ~/.virtualenvs among roots, got ${JSON.stringify(paths)}`,
        );
    });

    test('Records both WORKON_HOME and ~/.virtualenvs when WORKON_HOME is set, matching the locator', async () => {
        const workonHome = path.join('/', 'nonexistent-workon-for-tests');
        getEnvironmentVariableStub.withArgs('WORKON_HOME').returns(workonHome);

        const signature = await getPythonDiscoveryRootSignature();

        const paths = signature.entries.map((e) => e.path);
        assert.ok(paths.includes(workonHome), `expected ${workonHome} among roots, got ${JSON.stringify(paths)}`);
        assert.ok(
            paths.includes(path.join(homeDir, '.virtualenvs')),
            `the locator scans ~/.virtualenvs even with WORKON_HOME set, got ${JSON.stringify(paths)}`,
        );
    });

    test('Signs no global environment parent when HOME and USERPROFILE are unset', async () => {
        // The global virtualenv locator skips ~/.virtualenvs entirely without a home
        // directory, and Positron creates no global environment there either, so there
        // is nothing to sign. Signing os.homedir() instead would track a directory
        // discovery never scans.
        getUserHomeDirStub.returns(undefined);

        const signature = await getPythonDiscoveryRootSignature();

        const paths = signature.entries.map((e) => e.path);
        assert.ok(
            !paths.some((p) => p.endsWith('.virtualenvs')),
            `expected no ~/.virtualenvs root without a home dir, got ${JSON.stringify(paths)}`,
        );
    });

    test('Records each root once', async () => {
        const signature = await getPythonDiscoveryRootSignature();

        const paths = signature.entries.map((e) => e.path);
        assert.strictEqual(new Set(paths).size, paths.length, `duplicate roots in ${JSON.stringify(paths)}`);
    });

    test('Gives a different digest for the same ${workspaceFolder} text in different folders', async () => {
        include = ['${workspaceFolder}/.venv'];
        const opaqueFor = async (folder: string) => {
            getWorkspaceFoldersStub.returns([{ uri: Uri.file(folder), name: path.basename(folder), index: 0 }]);
            return (await getPythonDiscoveryRootSignature()).opaque;
        };
        const first = await opaqueFor(path.join('/', 'work', 'first'));
        const second = await opaqueFor(path.join('/', 'work', 'second'));
        assert.notStrictEqual(first, second);
    });
});
