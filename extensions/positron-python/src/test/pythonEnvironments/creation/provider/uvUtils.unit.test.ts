/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationTokenSource } from 'vscode';
import * as windowApis from '../../../../client/common/vscodeApis/windowApis';
import * as uv from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import { pickPythonVersion, getUvPythonVersions } from '../../../../client/pythonEnvironments/creation/provider/uvUtils';

suite('uv Utils test', () => {
    let showQuickPickWithBackStub: sinon.SinonStub;
    let getAvailablePythonVersionsStub: sinon.SinonStub;

    setup(() => {
        showQuickPickWithBackStub = sinon.stub(windowApis, 'showQuickPickWithBack');
        // Stub getAvailablePythonVersions to return test versions
        getAvailablePythonVersionsStub = sinon.stub(uv, 'getAvailablePythonVersions');
        getAvailablePythonVersionsStub.resolves([
            { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1' },
            { version: '3.12', isInstalled: true, path: '/usr/bin/python3.12', identifier: 'cpython-3.12.8' },
            { version: '3.11', isInstalled: false, identifier: 'cpython-3.11.9' },
        ]);
    });

    teardown(() => {
        sinon.restore();
    });

    test('No version selected or user pressed escape', async () => {
        showQuickPickWithBackStub.resolves(undefined);

        const actual = await pickPythonVersion();
        assert.isUndefined(actual);
    });

    test('User selected a version', async () => {
        showQuickPickWithBackStub.resolves({ label: 'Python', description: '3.12' });

        const actual = await pickPythonVersion();
        assert.equal(actual, '3.12');
    });

    test('With cancellation', async () => {
        const source = new CancellationTokenSource();

        showQuickPickWithBackStub.callsFake(() => {
            source.cancel();
        });

        const actual = await pickPythonVersion(source.token);
        assert.isUndefined(actual);
    });

    test('getUvPythonVersions returns versions from uv', async () => {
        const result = await getUvPythonVersions();
        assert.deepEqual(result.versions, ['3.13', '3.12', '3.11']);
    });

    test('getUvPythonVersions falls back to static list on error', async () => {
        getAvailablePythonVersionsStub.rejects(new Error('uv not found'));

        const result = await getUvPythonVersions();
        // Should fall back to FALLBACK_UV_PYTHON_VERSIONS
        assert.isArray(result.versions);
        assert.include(result.versions, '3.13');
        assert.include(result.versions, '3.12');
    });

    test('getUvPythonVersions falls back when uv returns empty array', async () => {
        getAvailablePythonVersionsStub.resolves([]);

        const result = await getUvPythonVersions();
        // Should fall back to FALLBACK_UV_PYTHON_VERSIONS
        assert.isArray(result.versions);
        assert.isTrue(result.versions.length > 0);
    });
});
