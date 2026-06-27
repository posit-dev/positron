/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { getRuntimeSourceAndShortName } from '../../client/positron/runtime';
import { EnvironmentType } from '../../client/pythonEnvironments/info';
import { ModuleMetadata } from '../../client/pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';

suite('getRuntimeSourceAndShortName', () => {
    const MODULE_METADATA: ModuleMetadata = {
        type: 'module',
        environmentName: 'Python-Leaves',
        modules: ['python/3.12.8', 'answers/everything'],
        startupCommand: 'module load python/3.12.8 && module load answers/everything',
        version: '3.12.8',
    };

    test('labels a module interpreter as Module even when envType is Unknown', () => {
        // Regression: a module-managed Python that the native locator also sees as
        // a bare global has envType Unknown; the module metadata must win so it is
        // shown as "(Module: Python-Leaves)" rather than "(Unknown)".
        const result = getRuntimeSourceAndShortName(
            '/opt/software/python/3.12.8/bin/python3',
            EnvironmentType.Unknown,
            undefined,
            '3.12.8',
            MODULE_METADATA,
        );

        assert.deepEqual(result, {
            runtimeSource: EnvironmentType.Module,
            runtimeShortName: '3.12.8 (Module: Python-Leaves)',
        });
    });

    test('uses the parent project name for a .venv environment', () => {
        const result = getRuntimeSourceAndShortName(
            '/home/user/my-python-project/.venv/bin/python',
            EnvironmentType.Venv,
            '.venv',
            '3.10.17',
            undefined,
        );

        assert.deepEqual(result, {
            runtimeSource: EnvironmentType.Venv,
            runtimeShortName: '3.10.17 (Venv: my-python-project)',
        });
    });

    test('omits the environment name when it matches the Python version', () => {
        const result = getRuntimeSourceAndShortName(
            '/usr/bin/python3',
            EnvironmentType.System,
            '3.12.3',
            '3.12.3',
            undefined,
        );

        assert.deepEqual(result, {
            runtimeSource: EnvironmentType.System,
            runtimeShortName: '3.12.3 (System)',
        });
    });
});
