// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { WorkspaceConfiguration } from 'vscode';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import { shouldUseNativeLocator } from '../../client/pythonEnvironments';

suite('shouldUseNativeLocator', () => {
    teardown(() => {
        sinon.restore();
    });

    test('shouldUseNativeLocator ignores python.locator = js', () => {
        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: () => 'js',
        } as unknown as WorkspaceConfiguration);

        assert.strictEqual(shouldUseNativeLocator(), true);
    });
});
