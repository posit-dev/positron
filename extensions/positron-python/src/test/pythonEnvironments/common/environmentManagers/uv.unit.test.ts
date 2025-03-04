/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import * as fileUtils from '../../../../client/pythonEnvironments/common/externalDependencies';
import { isUvEnvironment } from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import * as platformUtils from '../../../../client/common/utils/platform';

suite('UV Environment Tests', () => {
    let fileExistsStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;
    const envRoot = path.join('path', 'to', 'env');

    setup(() => {
        fileExistsStub = sinon.stub(fileUtils, 'pathExists');
        readFileStub = sinon.stub(fileUtils, 'readFile');
    });

    teardown(() => {
        sinon.restore();
    });

    test('pyvenv.cfg does not exist', async () => {
        const interpreter = path.join(envRoot, 'python');
        fileExistsStub.resolves(false);

        assert.strictEqual(await isUvEnvironment(interpreter), false);
    });

    test('pyvenv.cfg exists but has no uv marker', async () => {
        const interpreter = path.join(envRoot, 'python');
        fileExistsStub.resolves(true);
        readFileStub.resolves('home = /usr/local/python\nversion = 3.8.0\ninclude-system-site-packages = false');

        assert.strictEqual(await isUvEnvironment(interpreter), false);
    });

    test('pyvenv.cfg exists with uv marker in current folder', async () => {
        const interpreter = path.join(envRoot, 'python');
        fileExistsStub.resolves(true);
        readFileStub.resolves('home = /usr/local/python\nversion = 3.8.0\nuv = true');

        assert.ok(await isUvEnvironment(interpreter));
    });

    test('pyvenv.cfg exists with uv marker in parent folder', async () => {
        const interpreter = path.join(envRoot, 'bin', 'python');
        fileExistsStub.resolves(true);
        readFileStub.resolves('home = /usr/local/python\nversion = 3.8.0\nuv = true');

        assert.ok(await isUvEnvironment(interpreter));
    });

    test('pyvenv.cfg read fails', async () => {
        const interpreter = path.join(envRoot, 'python');
        fileExistsStub.resolves(true);
        readFileStub.rejects(new Error('Failed to read file'));

        assert.strictEqual(await isUvEnvironment(interpreter), false);
    });

    test('uv marker with different casing', async () => {
        const interpreter = path.join(envRoot, 'python');
        fileExistsStub.resolves(true);
        readFileStub.resolves('home = /usr/local/python\nversion = 3.8.0\nUV = true');

        assert.ok(await isUvEnvironment(interpreter));
    });

    test('uv marker with spaces', async () => {
        const interpreter = path.join(envRoot, 'python');
        fileExistsStub.resolves(true);
        readFileStub.resolves('home = /usr/local/python\nversion = 3.8.0\n  uv  =  true  ');

        assert.ok(await isUvEnvironment(interpreter));
    });

    suite('UV directory tests', () => {
        let getUserHomeDirStub: sinon.SinonStub;
        let resolveSymbolicLinkStub: sinon.SinonStub;

        setup(() => {
            getUserHomeDirStub = sinon.stub(platformUtils, 'getUserHomeDir');
            resolveSymbolicLinkStub = sinon.stub(fileUtils, 'resolveSymbolicLink');
            getUserHomeDirStub.returns('/home/user');
        });

        test('interpreter directly in ~/.local/share/uv', async () => {
            const interpreter = '/home/user/.local/share/uv/env/bin/python';
            assert.ok(await isUvEnvironment(interpreter));
        });

        test('interpreter is symlink to ~/.local/share/uv', async () => {
            const interpreter = '/path/to/venv/bin/python';
            const resolvedPath = '/home/user/.local/share/uv/env/bin/python';
            resolveSymbolicLinkStub.withArgs(interpreter).resolves(resolvedPath);

            assert.ok(await isUvEnvironment(interpreter));
        });

        test('symlink resolution fails', async () => {
            const interpreter = '/path/to/venv/bin/python';
            resolveSymbolicLinkStub.withArgs(interpreter).rejects(new Error('Failed to resolve symlink'));

            // Should fall back to checking pyvenv.cfg
            fileExistsStub.resolves(false);
            assert.strictEqual(await isUvEnvironment(interpreter), false);
        });

        test('no home directory available', async () => {
            getUserHomeDirStub.returns(undefined);
            const interpreter = '/path/to/venv/bin/python';
            assert.strictEqual(await isUvEnvironment(interpreter), false);
        });

        test('symlink resolves but not to uv directory', async () => {
            const interpreter = '/path/to/venv/bin/python';
            const resolvedPath = '/path/to/other/venv/bin/python';
            resolveSymbolicLinkStub.withArgs(interpreter).resolves(resolvedPath);

            // Should fall back to checking pyvenv.cfg
            fileExistsStub.resolves(false);
            assert.strictEqual(await isUvEnvironment(interpreter), false);
        });
    });
});
