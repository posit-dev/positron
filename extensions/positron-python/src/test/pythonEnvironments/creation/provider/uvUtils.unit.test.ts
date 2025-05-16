/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationTokenSource } from 'vscode';
import * as windowApis from '../../../../client/common/vscodeApis/windowApis';
import { pickPythonVersion } from '../../../../client/pythonEnvironments/creation/provider/uvUtils';

suite('UV Utils test', () => {
    let showQuickPickWithBackStub: sinon.SinonStub;

    setup(() => {
        showQuickPickWithBackStub = sinon.stub(windowApis, 'showQuickPickWithBack');
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
});
