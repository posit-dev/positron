/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fileUtils from '../../../../client/pythonEnvironments/common/externalDependencies';
import { isUvEnvironment } from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import * as platformUtils from '../../../../client/common/utils/platform';
import * as logging from '../../../../client/logging';

suite('UV Environment Tests', () => {
    let resolveSymbolicLinkStub: sinon.SinonStub;
    let getOSTypeStub: sinon.SinonStub;
    let getEnvironmentVariableStub: sinon.SinonStub;
    let execStub: sinon.SinonStub;
    let traceVerboseStub: sinon.SinonStub;

    const customDir = '/custom/uv/python';
    const exampleUvPython = `${customDir}/cpython-3.12`;

    setup(() => {
        resolveSymbolicLinkStub = sinon.stub(fileUtils, 'resolveSymbolicLink');
        getOSTypeStub = sinon.stub(platformUtils, 'getOSType');
        getEnvironmentVariableStub = sinon.stub(platformUtils, 'getEnvironmentVariable');
        execStub = sinon.stub(fileUtils, 'exec');
        traceVerboseStub = sinon.stub(logging, 'traceVerbose');

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
});
