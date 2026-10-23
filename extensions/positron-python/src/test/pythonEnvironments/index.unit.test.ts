/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
