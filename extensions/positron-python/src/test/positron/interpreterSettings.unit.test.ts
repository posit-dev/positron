/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { WorkspaceConfiguration } from 'vscode';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import { isPythonStartupDisabled } from '../../client/positron/interpreterSettings';

suite('isPythonStartupDisabled', () => {
    let getConfigurationStub: sinon.SinonStub;
    let startupBehavior: string | undefined;

    setup(() => {
        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        const configMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        configMock.setup((c) => c.get<string>('startupBehavior')).returns(() => startupBehavior);
        getConfigurationStub.returns(configMock.object);
    });

    teardown(() => {
        sinon.restore();
    });

    test('returns true only when startupBehavior resolves to disabled', () => {
        const cases: [string | undefined, boolean][] = [
            ['disabled', true],
            ['auto', false],
            ['manual', false],
            ['always', false],
            [undefined, false],
        ];
        const results = cases.map(([value]) => {
            startupBehavior = value;
            return isPythonStartupDisabled();
        });
        assert.deepStrictEqual(
            results,
            cases.map(([, expected]) => expected),
        );
    });

    test('reads the python language-scoped interpreters configuration', () => {
        startupBehavior = 'disabled';
        isPythonStartupDisabled();
        assert.deepStrictEqual(getConfigurationStub.firstCall.args, ['interpreters', { languageId: 'python' }]);
    });
});
