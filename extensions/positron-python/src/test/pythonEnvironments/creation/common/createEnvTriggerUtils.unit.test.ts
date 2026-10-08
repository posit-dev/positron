/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { assert } from 'chai';
import { Uri } from 'vscode';
import * as fsapi from '../../../../client/common/platform/fs-paths';
import { ResolvedEnvironment } from '../../../../client/api/types';
import { isGlobalEnvironment } from '../../../../client/pythonEnvironments/creation/common/createEnvTriggerUtils';

suite('Create Environment Trigger - isGlobalEnvironment', () => {
    let pathExistsStub: sinon.SinonStub;

    setup(() => {
        pathExistsStub = sinon.stub(fsapi, 'pathExists').resolves(false);
    });

    teardown(() => {
        sinon.restore();
    });

    function env(execPath: string, folder?: string, tools: string[] = []): ResolvedEnvironment {
        return {
            path: execPath,
            tools,
            executable: { uri: Uri.file(execPath) },
            environment: folder === undefined ? undefined : { type: 'VirtualEnvironment', folderUri: Uri.file(folder) },
        } as unknown as ResolvedEnvironment;
    }

    test('an interpreter outside any environment is global', async () => {
        assert.isTrue(await isGlobalEnvironment(env('/usr/bin/python3')));
    });

    test('a venv is not global', async () => {
        assert.isFalse(await isGlobalEnvironment(env('/project/.venv/bin/python', '/project/.venv', ['Venv'])));
    });

    test('a conda environment is not global', async () => {
        assert.isFalse(await isGlobalEnvironment(env('/opt/conda/envs/x/bin/python', '/opt/conda/envs/x', ['Conda'])));
    });

    test('a uv environment is not global', async () => {
        assert.isFalse(await isGlobalEnvironment(env('/project/.venv/bin/python', '/project/.venv', ['Uv'])));
    });

    test('a ~/.local install is global even when reported as an environment', async () => {
        const local = path.join(os.homedir(), '.local');
        assert.isTrue(await isGlobalEnvironment(env(path.join(local, 'bin', 'python'), local, ['Venv'])));
    });

    test('a plain pyenv version is global', async () => {
        const folder = '/home/u/.pyenv/versions/3.12.3';
        assert.isTrue(await isGlobalEnvironment(env(path.join(folder, 'bin', 'python'), folder, ['Pyenv'])));
        sinon.assert.calledOnceWithExactly(pathExistsStub, path.join(folder, 'pyvenv.cfg'));
    });

    test('a pyenv virtualenv is not global', async () => {
        const folder = '/home/u/.pyenv/versions/myproj';
        pathExistsStub.withArgs(path.join(folder, 'pyvenv.cfg')).resolves(true);
        assert.isFalse(await isGlobalEnvironment(env(path.join(folder, 'bin', 'python'), folder, ['Pyenv'])));
    });
});
