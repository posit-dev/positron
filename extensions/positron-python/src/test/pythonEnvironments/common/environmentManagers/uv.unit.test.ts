/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fileUtils from '../../../../client/pythonEnvironments/common/externalDependencies';
import {
    isUvEnvironment,
    isUvInstalled,
    getUvDirs,
    getUvPythonVersionInfo,
    updateUv,
} from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import * as platformUtils from '../../../../client/common/utils/platform';
import * as logging from '../../../../client/logging';
import * as simplevenv from '../../../../client/pythonEnvironments/common/environmentManagers/simplevirtualenvs';

suite('UV Environment Tests', () => {
    let resolveSymbolicLinkStub: sinon.SinonStub;
    let getOSTypeStub: sinon.SinonStub;
    let getEnvironmentVariableStub: sinon.SinonStub;
    let execStub: sinon.SinonStub;
    let traceVerboseStub: sinon.SinonStub;
    let pathExistsStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;
    let getPyvenvConfigPathsStub: sinon.SinonStub;

    const customDir = '/custom/uv/python';
    const exampleUvPython = `${customDir}/cpython-3.12`;

    setup(() => {
        resolveSymbolicLinkStub = sinon.stub(fileUtils, 'resolveSymbolicLink');
        getOSTypeStub = sinon.stub(platformUtils, 'getOSType');
        getEnvironmentVariableStub = sinon.stub(platformUtils, 'getEnvironmentVariable');
        execStub = sinon.stub(fileUtils, 'exec');
        traceVerboseStub = sinon.stub(logging, 'traceVerbose');
        pathExistsStub = sinon.stub(fileUtils, 'pathExists');
        readFileStub = sinon.stub(fileUtils, 'readFile');
        getPyvenvConfigPathsStub = sinon.stub(simplevenv, 'getPyvenvConfigPathsFrom');

        getPyvenvConfigPathsStub.returns([]);
        getOSTypeStub.returns(platformUtils.OSType.Linux);
        execStub.resolves({ stdout: customDir });
    });

    teardown(() => {
        sinon.restore();
    });

    suite('UV Command Execution', () => {
        test('exec is called with correct arguments', async () => {
            await isUvEnvironment(exampleUvPython);

            assert.ok(execStub.calledWith('uv', ['python', 'dir'], { throwOnStdErr: true }));
        });

        test('getUvDir returns undefined when command fails', async () => {
            execStub.rejects(new Error('Command failed'));

            const result = await isUvEnvironment(exampleUvPython);

            assert.strictEqual(result, false);
            assert.ok(traceVerboseStub.calledWith(sinon.match.instanceOf(Error)));
            assert.ok(traceVerboseStub.calledWith('No uv binary found'));
        });

        test('UvUtils.locate traces verbose logs on success', async () => {
            await isUvEnvironment(exampleUvPython);

            assert.ok(traceVerboseStub.calledWith('Probing uv binary uv'));
            assert.ok(traceVerboseStub.calledWith('Found uv binary uv'));
        });

        test('UvUtils.locate traces verbose logs on failure', async () => {
            execStub.rejects(new Error('Command failed'));

            await isUvEnvironment(exampleUvPython);

            assert.ok(traceVerboseStub.calledWith('Probing uv binary uv'));
            assert.ok(traceVerboseStub.calledWith('No uv binary found'));
        });
    });

    suite('UV directory detection', () => {
        test('Works on Unix', async () => {
            const result = await isUvEnvironment(exampleUvPython);
            assert.strictEqual(result, true);
        });

        test('Works on Windows', async () => {
            const appData = 'C:\\Users\\user\\AppData\\Roaming';
            const uvDir = `${appData}\\uv\\data\\python`;
            const interpreter = `${uvDir}\\env123\\Scripts\\python.exe`;
            getOSTypeStub.returns(platformUtils.OSType.Windows);
            getEnvironmentVariableStub
                .withArgs('APPDATA')
                .returns(appData)
                .withArgs('UV_PYTHON_INSTALL_DIR')
                .returns(undefined);
            execStub.resolves({ stdout: uvDir });

            const result = await isUvEnvironment(interpreter);
            assert.strictEqual(result, true);
        });

        test('Works with a symlink to the python dir', async () => {
            const interpreter = '/path/to/venv/bin/python';
            resolveSymbolicLinkStub.withArgs(interpreter).resolves(exampleUvPython);

            assert.ok(await isUvEnvironment(interpreter));
        });

        test('symlink resolution fails', async () => {
            const interpreter = '/path/to/venv/bin/python';
            resolveSymbolicLinkStub.withArgs(interpreter).rejects(new Error('Failed to resolve symlink'));
            assert.strictEqual(await isUvEnvironment(interpreter), false);
        });

        test('symlink resolves but not to uv directory', async () => {
            const interpreter = '/path/to/venv/bin/python';
            const resolvedPath = '/path/to/other/venv/bin/python';
            resolveSymbolicLinkStub.withArgs(interpreter).resolves(resolvedPath);
            assert.strictEqual(await isUvEnvironment(interpreter), false);
        });
    });

    suite('pyvenv.cfg detection', () => {
        const interpreterPath = '/path/to/venv/bin/python';
        const venvPath1 = '/path/to/venv/pyvenv.cfg';
        const venvPath2 = '/path/to/venv/bin/pyvenv.cfg';

        setup(() => {
            // Make the uv dir checks fail
            execStub.resolves({ stdout: '/some/other/dir' });
            // Setup pyvenv paths
            getPyvenvConfigPathsStub.returns([venvPath1, venvPath2]);
        });

        test('Detects uv environment when pyvenv.cfg contains uv key', async () => {
            pathExistsStub.withArgs(venvPath1).resolves(true);
            readFileStub.withArgs(venvPath1).resolves('home = /usr/bin\nuv = 0.1.0\nversion = 3.11.0');

            const result = await isUvEnvironment(interpreterPath);

            assert.strictEqual(result, true);
            assert.strictEqual(pathExistsStub.calledWith(venvPath1), true);
            assert.strictEqual(readFileStub.calledWith(venvPath1), true);
        });

        test('Ignores case when checking for uv key', async () => {
            pathExistsStub.withArgs(venvPath1).resolves(true);
            readFileStub.withArgs(venvPath1).resolves('home = /usr/bin\nUV = 0.1.0\nversion = 3.11.0');

            const result = await isUvEnvironment(interpreterPath);

            assert.strictEqual(result, true);
        });

        test('Handles whitespace in pyvenv.cfg correctly', async () => {
            pathExistsStub.withArgs(venvPath1).resolves(true);
            readFileStub.withArgs(venvPath1).resolves('home = /usr/bin\n  uv  =  0.1.0  \nversion = 3.11.0');

            const result = await isUvEnvironment(interpreterPath);

            assert.strictEqual(result, true);
        });

        test('Returns false when pyvenv.cfg does not contain uv key', async () => {
            pathExistsStub.withArgs(venvPath1).resolves(true);
            readFileStub.withArgs(venvPath1).resolves('home = /usr/bin\nversion = 3.11.0');

            const result = await isUvEnvironment(interpreterPath);

            assert.strictEqual(result, false);
        });

        test('Checks both pyvenv.cfg paths', async () => {
            pathExistsStub.withArgs(venvPath1).resolves(false);
            pathExistsStub.withArgs(venvPath2).resolves(true);
            readFileStub.withArgs(venvPath2).resolves('home = /usr/bin\nuv = 0.1.0\nversion = 3.11.0');

            const result = await isUvEnvironment(interpreterPath);

            assert.strictEqual(result, true);
            assert.strictEqual(pathExistsStub.calledWith(venvPath1), true);
            assert.strictEqual(pathExistsStub.calledWith(venvPath2), true);
            assert.strictEqual(readFileStub.calledWith(venvPath2), true);
        });

        test('Handles file read errors gracefully', async () => {
            pathExistsStub.withArgs(venvPath1).resolves(true);
            readFileStub.withArgs(venvPath1).rejects(new Error('File read error'));

            const result = await isUvEnvironment(interpreterPath);

            assert.strictEqual(result, false);
            assert.ok(traceVerboseStub.calledWith(sinon.match.string));
        });
    });

    suite('isUvInstalled Tests', () => {
        test('Returns true when uv is installed and working', async () => {
            execStub.resolves({ stdout: customDir });

            const result = await isUvInstalled();

            assert.strictEqual(result, true);
        });

        test('Returns false when uv command fails', async () => {
            execStub.rejects(new Error('Command not found'));

            const result = await isUvInstalled();

            assert.strictEqual(result, false);
        });
    });

    suite('getUvDirs Tests', () => {
        test('Returns both uv dir and bin dir when both are available', async () => {
            const uvDir = '/path/to/uv/python';
            const uvBinDir = '/path/to/uv/bin';
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: uvDir });
            execStub.withArgs('uv', ['python', 'dir', '--bin'], { throwOnStdErr: true }).resolves({ stdout: uvBinDir });

            const result = await getUvDirs();

            assert.strictEqual(result.size, 2);
            assert.ok(result.has(uvDir));
            assert.ok(result.has(uvBinDir));
        });

        test('Returns empty set when uv is not installed', async () => {
            execStub.rejects(new Error('Command not found'));

            const result = await getUvDirs();

            assert.strictEqual(result.size, 0);
        });

        test('Trims whitespace from command output', async () => {
            const uvDir = '/path/to/uv/python';
            const uvBinDir = '/path/to/uv/bin';
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: `  ${uvDir}  \n` });
            execStub
                .withArgs('uv', ['python', 'dir', '--bin'], { throwOnStdErr: true })
                .resolves({ stdout: `\t${uvBinDir}\r\n` });

            const result = await getUvDirs();

            assert.strictEqual(result.size, 2);
            assert.ok(result.has(uvDir));
            assert.ok(result.has(uvBinDir));
        });
    });

    suite('getUvPythonVersionInfo Tests', () => {
        test('Returns undefined when uv is not installed', async () => {
            execStub.rejects(new Error('Command not found'));

            const result = await getUvPythonVersionInfo('3.13');

            assert.strictEqual(result, undefined);
        });

        test('Returns undefined when uv python list returns empty output', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.13'], { throwOnStdErr: false }).resolves({ stdout: '' });

            const result = await getUvPythonVersionInfo('3.13');

            assert.strictEqual(result, undefined);
        });

        test('Detects pre-release alpha version from download-only output', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.15'], { throwOnStdErr: false }).resolves({
                stdout: 'cpython-3.15.0a6-macos-aarch64-none    <download available>',
            });

            const result = await getUvPythonVersionInfo('3.15');

            assert.ok(result);
            assert.strictEqual(result.version, '3.15.0a6');
            assert.strictEqual(result.isPrerelease, true);
            assert.strictEqual(result.path, undefined);
        });

        test('Detects pre-release beta version', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.14'], { throwOnStdErr: false }).resolves({
                stdout: 'cpython-3.14.0b2-linux-x86_64-gnu    <download available>',
            });

            const result = await getUvPythonVersionInfo('3.14');

            assert.ok(result);
            assert.strictEqual(result.version, '3.14.0b2');
            assert.strictEqual(result.isPrerelease, true);
        });

        test('Detects pre-release candidate version', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.13'], { throwOnStdErr: false }).resolves({
                stdout: 'cpython-3.13.0rc1-macos-aarch64-none    <download available>',
            });

            const result = await getUvPythonVersionInfo('3.13');

            assert.ok(result);
            assert.strictEqual(result.version, '3.13.0rc1');
            assert.strictEqual(result.isPrerelease, true);
        });

        test('Detects stable version as non-prerelease', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.12'], { throwOnStdErr: false }).resolves({
                stdout: 'cpython-3.12.5-macos-aarch64-none    <download available>',
            });

            const result = await getUvPythonVersionInfo('3.12');

            assert.ok(result);
            assert.strictEqual(result.version, '3.12.5');
            assert.strictEqual(result.isPrerelease, false);
        });

        test('Returns local install info including path when version is pre-release', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.14'], { throwOnStdErr: false }).resolves({
                stdout: 'cpython-3.14.0a5-macos-aarch64-none    /usr/local/bin/python3.14',
            });

            const result = await getUvPythonVersionInfo('3.14');

            assert.ok(result);
            assert.strictEqual(result.version, '3.14.0a5');
            assert.strictEqual(result.isPrerelease, true);
            assert.strictEqual(result.path, '/usr/local/bin/python3.14');
        });

        test('Returns local install info for stable version', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.13'], { throwOnStdErr: false }).resolves({
                stdout: 'cpython-3.13.7-macos-aarch64-none     /usr/local/bin/python3.13 -> python3.13.real',
            });

            const result = await getUvPythonVersionInfo('3.13');

            assert.ok(result);
            assert.strictEqual(result.version, '3.13.7');
            assert.strictEqual(result.isPrerelease, false);
            assert.strictEqual(result.path, '/usr/local/bin/python3.13');
        });

        test('Prefers local install over download when both available', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.13'], { throwOnStdErr: false }).resolves({
                stdout: [
                    'cpython-3.13.8-macos-aarch64-none    <download available>',
                    'cpython-3.13.7-macos-aarch64-none    /usr/local/bin/python3.13',
                ].join('\n'),
            });

            const result = await getUvPythonVersionInfo('3.13');

            assert.ok(result);
            // Should use the local install (3.13.7), not the download (3.13.8)
            assert.strictEqual(result.version, '3.13.7');
            assert.strictEqual(result.path, '/usr/local/bin/python3.13');
        });

        test('Returns undefined when version cannot be parsed from output', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.13'], { throwOnStdErr: false }).resolves({
                stdout: 'unexpected format that does not match',
            });

            const result = await getUvPythonVersionInfo('3.13');

            assert.strictEqual(result, undefined);
            assert.ok(traceVerboseStub.calledWith(sinon.match(/Could not parse version/)));
        });

        test('Handles multiple lines of output', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['python', 'list', '3.12'], { throwOnStdErr: false }).resolves({
                stdout: [
                    'cpython-3.12.9-macos-aarch64-none    <download available>',
                    'cpython-3.12.8-macos-aarch64-none    <download available>',
                    'cpython-3.12.7-macos-aarch64-none    <download available>',
                ].join('\n'),
            });

            const result = await getUvPythonVersionInfo('3.12');

            assert.ok(result);
            // Should use the first line (highest version) when all are downloads
            assert.strictEqual(result.version, '3.12.9');
            assert.strictEqual(result.isPrerelease, false);
        });
    });

    suite('updateUv Tests', () => {
        test('Returns false when uv is not installed', async () => {
            execStub.rejects(new Error('Command not found'));

            const result = await updateUv();

            assert.strictEqual(result, false);
        });

        test('Returns true when uv self update succeeds', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['self', 'update'], { throwOnStdErr: false }).resolves({ stdout: 'Updated' });

            const result = await updateUv();

            assert.strictEqual(result, true);
            assert.ok(execStub.calledWith('uv', ['self', 'update'], { throwOnStdErr: false }));
        });

        test('Returns false when uv self update fails', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['self', 'update'], { throwOnStdErr: false }).rejects(new Error('Update failed'));

            const result = await updateUv();

            assert.strictEqual(result, false);
            assert.ok(traceVerboseStub.calledWith(sinon.match(/Error running uv self update/)));
        });

        test('Logs success message on successful update', async () => {
            execStub.withArgs('uv', ['python', 'dir'], { throwOnStdErr: true }).resolves({ stdout: customDir });
            execStub.withArgs('uv', ['self', 'update'], { throwOnStdErr: false }).resolves({ stdout: 'Updated' });

            await updateUv();

            assert.ok(traceVerboseStub.calledWith('Running uv self update...'));
            assert.ok(traceVerboseStub.calledWith('uv self update completed successfully'));
        });
    });
});
