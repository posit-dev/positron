/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { sortInterpreters } from '../../client/positron/discoverer';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { Architecture } from '../../client/common/utils/platform';

function makeInterpreter(envType: EnvironmentType, version: string): PythonEnvironment {
    const [major, minor, patch] = version.split('.').map(Number);
    return {
        id: `${envType}-${version}`,
        path: `/envs/${envType}-${version}/bin/python`,
        envType,
        architecture: Architecture.x64,
        sysPrefix: `/envs/${envType}-${version}`,
        version: { major, minor, patch, raw: version, build: [], prerelease: [] },
    };
}

/** Describe a sorted list as "<envType> <version>" pairs, which is what the ordering is about. */
function describeOrder(interpreters: PythonEnvironment[]): string[] {
    return interpreters.map((i) => `${i.envType} ${i.version?.raw}`);
}

suite('sortInterpreters', () => {
    test('ranks environment types ahead of Python version, with system Pythons last', () => {
        // A newer system Python must not outrank a uv, venv or conda environment.
        const interpreters = [
            makeInterpreter(EnvironmentType.System, '3.13.1'),
            makeInterpreter(EnvironmentType.Conda, '3.11.9'),
            makeInterpreter(EnvironmentType.Uv, '3.10.14'),
            makeInterpreter(EnvironmentType.Venv, '3.12.7'),
        ];

        assert.deepEqual(describeOrder(sortInterpreters(interpreters, undefined)), [
            'uv 3.10.14',
            'Venv 3.12.7',
            'Conda 3.11.9',
            'System 3.13.1',
        ]);
    });

    test('sorts by descending Python version within an environment type', () => {
        const interpreters = [
            makeInterpreter(EnvironmentType.Venv, '3.10.14'),
            makeInterpreter(EnvironmentType.Venv, '3.13.1'),
            makeInterpreter(EnvironmentType.Venv, '3.12.7'),
        ];

        assert.deepEqual(describeOrder(sortInterpreters(interpreters, undefined)), [
            'Venv 3.13.1',
            'Venv 3.12.7',
            'Venv 3.10.14',
        ]);
    });

    test('ranks deliberately provided interpreters ahead of system Pythons', () => {
        // Custom means the interpreter was found in a directory the user added to
        // python.interpreters.include, and Module means a site admin exposed it through
        // environment modules; both outrank whatever else is on the system.
        const interpreters = [
            makeInterpreter(EnvironmentType.Global, '3.13.1'),
            makeInterpreter(EnvironmentType.System, '3.13.1'),
            makeInterpreter(EnvironmentType.Custom, '3.9.18'),
            makeInterpreter(EnvironmentType.Module, '3.8.19'),
        ];

        assert.deepEqual(describeOrder(sortInterpreters(interpreters, undefined)), [
            'Module 3.8.19',
            'Custom 3.9.18',
            'Global 3.13.1',
            'System 3.13.1',
        ]);
    });

    test('keeps the preferred interpreter first regardless of its environment type', () => {
        // Positron falls back to the first registered runtime for a language as its
        // preferred runtime, so the recommended interpreter has to stay at the front.
        const preferred = makeInterpreter(EnvironmentType.System, '3.9.18');
        const interpreters = [makeInterpreter(EnvironmentType.Uv, '3.13.1'), preferred];

        assert.deepEqual(describeOrder(sortInterpreters(interpreters, preferred)), ['System 3.9.18', 'uv 3.13.1']);
    });

    test('ranks environment types missing from the priority list last', () => {
        // indexOf returns -1 for an unlisted type; without a guard that would sort it
        // ahead of everything else.
        const interpreters = [
            makeInterpreter(EnvironmentType.MicrosoftStore, '3.11.9'),
            makeInterpreter('Brand New Env Type' as EnvironmentType, '3.13.1'),
            makeInterpreter(EnvironmentType.Uv, '3.10.14'),
        ];

        assert.deepEqual(describeOrder(sortInterpreters(interpreters, undefined)), [
            'uv 3.10.14',
            'MicrosoftStore 3.11.9',
            'Brand New Env Type 3.13.1',
        ]);
    });

    test('does not mutate the input array', () => {
        const interpreters = [
            makeInterpreter(EnvironmentType.System, '3.13.1'),
            makeInterpreter(EnvironmentType.Uv, '3.10.14'),
        ];

        sortInterpreters(interpreters, undefined);

        assert.deepEqual(describeOrder(interpreters), ['System 3.13.1', 'uv 3.10.14']);
    });
});
