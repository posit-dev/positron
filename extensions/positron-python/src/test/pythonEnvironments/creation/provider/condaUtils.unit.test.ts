// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import { CancellationTokenSource, Uri } from 'vscode';
import * as windowApis from '../../../../client/common/vscodeApis/windowApis';
import {
    ExistingCondaAction,
    // --- Start Positron ---
    getCondaPythonVersions,
    // --- End Positron ---
    pickExistingCondaAction,
    pickPythonVersion,
} from '../../../../client/pythonEnvironments/creation/provider/condaUtils';
// --- Start Positron ---
import { MAXIMUM_PYTHON_VERSION_EXCLUSIVE, MINIMUM_PYTHON_VERSION } from '../../../../client/common/constants';
// --- End Positron ---
import * as commonUtils from '../../../../client/pythonEnvironments/creation/common/commonUtils';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../constants';
import { CreateEnv } from '../../../../client/common/utils/localize';

suite('Conda Utils test', () => {
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
        showQuickPickWithBackStub.resolves({ label: 'Python', description: '3.10' });

        const actual = await pickPythonVersion();
        assert.equal(actual, '3.10');
    });

    test('With cancellation', async () => {
        const source = new CancellationTokenSource();

        showQuickPickWithBackStub.callsFake(() => {
            source.cancel();
        });

        const actual = await pickPythonVersion(source.token);
        assert.isUndefined(actual);
    });

    // --- Start Positron ---
    test('Offers every supported Python version, recommended first', () => {
        const { preferred, versions } = getCondaPythonVersions();
        const expected: string[] = [];
        for (let minor = MINIMUM_PYTHON_VERSION.minor; minor < MAXIMUM_PYTHON_VERSION_EXCLUSIVE.minor; minor += 1) {
            expected.push(`3.${minor}`);
        }

        assert.equal(versions[0], preferred);
        assert.sameMembers(versions, expected);
    });
    // --- End Positron ---
});

suite('Existing .conda env test', () => {
    let hasPrefixCondaEnvStub: sinon.SinonStub;
    let showQuickPickWithBackStub: sinon.SinonStub;

    const workspace1 = {
        uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
        name: 'workspace1',
        index: 0,
    };

    setup(() => {
        hasPrefixCondaEnvStub = sinon.stub(commonUtils, 'hasPrefixCondaEnv');
        showQuickPickWithBackStub = sinon.stub(windowApis, 'showQuickPickWithBack');
    });

    teardown(() => {
        sinon.restore();
    });

    test('No .conda found', async () => {
        hasPrefixCondaEnvStub.resolves(false);
        showQuickPickWithBackStub.resolves(undefined);

        const actual = await pickExistingCondaAction(workspace1);
        assert.deepStrictEqual(actual, ExistingCondaAction.Create);
        assert.isTrue(showQuickPickWithBackStub.notCalled);
    });

    test('User presses escape', async () => {
        hasPrefixCondaEnvStub.resolves(true);
        showQuickPickWithBackStub.resolves(undefined);
        await assert.isRejected(pickExistingCondaAction(workspace1));
    });

    test('.conda found and user selected to re-create', async () => {
        hasPrefixCondaEnvStub.resolves(true);
        showQuickPickWithBackStub.resolves({
            label: CreateEnv.Conda.recreate,
            description: CreateEnv.Conda.recreateDescription,
        });

        const actual = await pickExistingCondaAction(workspace1);
        assert.deepStrictEqual(actual, ExistingCondaAction.Recreate);
    });

    test('.conda found and user selected to re-use', async () => {
        hasPrefixCondaEnvStub.resolves(true);
        showQuickPickWithBackStub.resolves({
            label: CreateEnv.Conda.useExisting,
            description: CreateEnv.Conda.useExistingDescription,
        });

        const actual = await pickExistingCondaAction(workspace1);
        assert.deepStrictEqual(actual, ExistingCondaAction.UseExisting);
    });
});
