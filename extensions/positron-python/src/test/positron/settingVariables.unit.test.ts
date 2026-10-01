/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { SubstitutionResult, substituteWorkspaceFolder } from '../../client/positron/settingVariables';

suite('substituteWorkspaceFolder', () => {
    test('resolves paths that use only ${workspaceFolder}, or no variable', () => {
        const cases: [string, string | undefined, string][] = [
            ['/opt/python/bin/python', '/work/proj', '/opt/python/bin/python'],
            ['/opt/python/bin/python', undefined, '/opt/python/bin/python'],
            ['${workspaceFolder}/.venv/bin/python', '/work/proj', '/work/proj/.venv/bin/python'],
            ['${workspaceFolder}/a:${workspaceFolder}/b', '/work/proj', '/work/proj/a:/work/proj/b'],
            ['~/pythons/bin/python', '/work/proj', '~/pythons/bin/python'],
            [
                '${workspaceFolder}\\.venv\\Scripts\\python.exe',
                'C:\\Users\\me\\My Project',
                'C:\\Users\\me\\My Project\\.venv\\Scripts\\python.exe',
            ],
            ['${workspaceFolder}/bin/python', '/work/${odd}', '/work/${odd}/bin/python'],
        ];
        assert.deepStrictEqual(
            cases.map(([value, folder]) => substituteWorkspaceFolder(value, folder)),
            cases.map(([, , expected]): SubstitutionResult => ({ resolved: true, value: expected })),
        );
    });

    test('does not resolve other variables, or ${workspaceFolder} with no folder open', () => {
        const cases: [string, string | undefined, string, 'noFolder' | 'unsupported'][] = [
            ['${workspaceFolder}/.venv/bin/python', undefined, '${workspaceFolder}', 'noFolder'],
            ['${env:PYTHON_ROOT}/bin/python', '/work/proj', '${env:PYTHON_ROOT}', 'unsupported'],
            ['${userHome}/.venv/bin/python', '/work/proj', '${userHome}', 'unsupported'],
            ['/opt/${env:PY_VERSION}/bin/python', '/work/proj', '${env:PY_VERSION}', 'unsupported'],
            ['${workspacefolder}/.venv/bin/python', '/work/proj', '${workspacefolder}', 'unsupported'],
            ['${workspaceFolder:proj}/.venv/bin/python', '/work/proj', '${workspaceFolder:proj}', 'unsupported'],
            ['${workspaceFolder}/${foo}/bin/python', '/work/proj', '${foo}', 'unsupported'],
            ['${workspaceFolder/bin/python', '/work/proj', '${workspaceFolder/bin/python', 'unsupported'],
        ];
        assert.deepStrictEqual(
            cases.map(([value, folder]) => substituteWorkspaceFolder(value, folder)),
            cases.map(([, , variable, reason]): SubstitutionResult => ({ resolved: false, variable, reason })),
        );
    });
});
