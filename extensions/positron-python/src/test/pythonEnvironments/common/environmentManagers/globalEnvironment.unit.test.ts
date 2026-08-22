/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as platformApis from '../../../../client/common/utils/platform';
import * as fsapi from '../../../../client/common/platform/fs-paths';
import * as externalDependencies from '../../../../client/pythonEnvironments/common/externalDependencies';
import * as logging from '../../../../client/logging';
import {
    getGlobalEnvironmentDir,
    getGlobalEnvironmentParent,
    getGlobalEnvironmentPython,
    createGlobalEnvironment,
} from '../../../../client/pythonEnvironments/common/environmentManagers/globalEnvironment';

suite('Global environment path', () => {
    const homeDir = path.join('/', 'home', 'testuser');
    let getEnvironmentVariableStub: sinon.SinonStub;
    let getUserHomeDirStub: sinon.SinonStub;

    setup(() => {
        getUserHomeDirStub = sinon.stub(platformApis, 'getUserHomeDir').returns(homeDir);
        getEnvironmentVariableStub = sinon.stub(platformApis, 'getEnvironmentVariable');
        getEnvironmentVariableStub.returns(undefined);
    });

    teardown(() => {
        sinon.restore();
    });

    test('Defaults the parent to ~/.virtualenvs when WORKON_HOME is unset', () => {
        assert.strictEqual(getGlobalEnvironmentParent(), path.join(homeDir, '.virtualenvs'));
    });

    test('Falls through to the default when WORKON_HOME is empty', () => {
        getEnvironmentVariableStub.withArgs('WORKON_HOME').returns('');

        assert.strictEqual(getGlobalEnvironmentParent(), path.join(homeDir, '.virtualenvs'));
    });

    test('Has no default parent when HOME and USERPROFILE are unset', () => {
        // The global virtualenv locator skips ~/.virtualenvs entirely without a home
        // directory. Falling back to os.homedir() here would create an environment
        // discovery could never find.
        getUserHomeDirStub.returns(undefined);

        assert.strictEqual(getGlobalEnvironmentParent(), undefined);
        assert.strictEqual(getGlobalEnvironmentDir(), undefined);
    });

    test('Still uses WORKON_HOME when there is no home directory', () => {
        getUserHomeDirStub.returns(undefined);
        getEnvironmentVariableStub.withArgs('WORKON_HOME').returns(path.join('/', 'custom', 'workon'));

        assert.strictEqual(getGlobalEnvironmentDir(), path.join('/', 'custom', 'workon', 'positron'));
    });

    test('Uses WORKON_HOME as the parent when it is set', () => {
        getEnvironmentVariableStub.withArgs('WORKON_HOME').returns(path.join('/', 'custom', 'workon'));

        assert.strictEqual(getGlobalEnvironmentParent(), path.join('/', 'custom', 'workon'));
    });

    test('Expands a leading tilde in WORKON_HOME, matching the global virtualenv locator', () => {
        getEnvironmentVariableStub.withArgs('WORKON_HOME').returns('~/workon');

        // untildify only swaps the leading ~ for the home directory and leaves the rest of
        // the string alone, so the separator the user typed survives even on Windows.
        assert.strictEqual(getGlobalEnvironmentParent(), `${os.homedir()}/workon`);
    });

    test('Places the environment directly under the parent, never in a nested .venv', () => {
        // Discovery scans only the children of the parent, so a nested layout would be
        // invisible to PET and to every other locator.
        assert.strictEqual(getGlobalEnvironmentDir(), path.join(homeDir, '.virtualenvs', 'positron'));
    });

    test('Resolves the venv Python executable for the current platform', () => {
        const venvDir = path.join(homeDir, '.virtualenvs', 'positron');
        const expected =
            process.platform === 'win32'
                ? path.join(venvDir, 'Scripts', 'python.exe')
                : path.join(venvDir, 'bin', 'python');

        assert.strictEqual(getGlobalEnvironmentPython(venvDir), expected);
    });
});

suite('createGlobalEnvironment', () => {
    const homeDir = path.join('/', 'home', 'testuser');
    const parentDir = path.join(homeDir, '.virtualenvs');
    const venvDir = path.join(parentDir, 'positron');
    const pythonPath = getGlobalEnvironmentPython(venvDir);

    let execStub: sinon.SinonStub;
    let pathExistsStub: sinon.SinonStub;
    let mkdirpStub: sinon.SinonStub;
    let getUserHomeDirStub: sinon.SinonStub;

    setup(() => {
        getUserHomeDirStub = sinon.stub(platformApis, 'getUserHomeDir').returns(homeDir);
        sinon.stub(platformApis, 'getEnvironmentVariable').returns(undefined);
        sinon.stub(logging, 'traceInfo');
        sinon.stub(logging, 'traceError');
        execStub = sinon.stub(externalDependencies, 'exec').resolves({ stdout: '' });
        // The venv path is free; uv leaves an interpreter behind.
        pathExistsStub = sinon.stub(fsapi, 'pathExists').resolves(false);
        pathExistsStub.withArgs(pythonPath).resolves(true);
        mkdirpStub = sinon.stub(fsapi, 'mkdirp').resolves();
    });

    teardown(() => {
        sinon.restore();
    });

    test('Creates the environment and returns its Python when the path is free', async () => {
        const result = await createGlobalEnvironment('3.13');

        assert.deepStrictEqual(result, { outcome: 'created', venvDir, pythonPath });
        assert.ok(
            execStub.calledWith('uv', ['--color', 'never', 'venv', venvDir, '--no-project', '--seed', '-p', '3.13'], {
                throwOnStdErr: false,
            }),
            'uv venv should be invoked with --seed and the requested base',
        );
    });

    test('Creates the parent directory first, since PET only scans directories that exist', async () => {
        await createGlobalEnvironment('3.13');

        assert.ok(mkdirpStub.calledOnceWithExactly(parentDir));
        assert.ok(mkdirpStub.calledBefore(execStub), 'the parent must exist before uv venv runs');
    });

    test('Accepts a base interpreter path as well as a version', async () => {
        await createGlobalEnvironment('/usr/local/bin/python3.13');

        assert.ok(
            execStub.calledWith(
                'uv',
                ['--color', 'never', 'venv', venvDir, '--no-project', '--seed', '-p', '/usr/local/bin/python3.13'],
                { throwOnStdErr: false },
            ),
        );
    });

    test('Reports occupied without touching anything when the path already exists', async () => {
        pathExistsStub.withArgs(venvDir).resolves(true);

        const result = await createGlobalEnvironment('3.13');

        assert.deepStrictEqual(result, { outcome: 'occupied', venvDir });
        // Never inspect, reuse, upgrade, or delete what is already there.
        assert.ok(!execStub.called, 'uv should not run against an occupied path');
        assert.ok(!mkdirpStub.called, 'nothing should be created when the path is occupied');
    });

    test('Reports failed when uv venv fails', async () => {
        execStub.rejects(new Error('uv venv exploded'));

        const result = await createGlobalEnvironment('3.13');

        assert.deepStrictEqual(result, { outcome: 'failed', venvDir });
    });

    test('Reports failed when the parent directory cannot be created', async () => {
        mkdirpStub.rejects(new Error('EACCES'));

        const result = await createGlobalEnvironment('3.13');

        assert.deepStrictEqual(result, { outcome: 'failed', venvDir });
        assert.ok(!execStub.called);
    });

    test('Reports failed when uv resolves but leaves no interpreter behind', async () => {
        // exec resolves on a nonzero exit when throwOnStdErr is false, so a resolved
        // call is not proof that the environment exists.
        execStub.resolves({ stdout: '', stderr: 'error: no interpreter found for 3.13' });
        pathExistsStub.withArgs(pythonPath).resolves(false);

        const result = await createGlobalEnvironment('3.13');

        assert.deepStrictEqual(result, { outcome: 'failed', venvDir });
    });

    test('Reports unsupported without creating anything when there is nowhere discovery scans', async () => {
        getUserHomeDirStub.returns(undefined);

        const result = await createGlobalEnvironment('3.13');

        assert.deepStrictEqual(result, { outcome: 'unsupported' });
        assert.ok(!mkdirpStub.called, 'nothing should be created outside a discovered directory');
        assert.ok(!execStub.called);
    });

    test('Reports failed when the occupancy check itself fails', async () => {
        pathExistsStub.withArgs(venvDir).rejects(new Error('EACCES'));

        const result = await createGlobalEnvironment('3.13');

        assert.deepStrictEqual(result, { outcome: 'failed', venvDir });
        assert.ok(!execStub.called);
    });
});
