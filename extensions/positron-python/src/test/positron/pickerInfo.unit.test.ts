/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import { Architecture } from '../../client/common/utils/platform';
import {
    createPythonPickerInfo,
    PickerGroupContext,
    pickerGroupOf,
    PythonPickerGroup,
} from '../../client/positron/pickerInfo';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';

/** An absolute path on every OS. */
function p(posixPath: string): string {
    return path.resolve(posixPath);
}

function env(
    executable: string,
    envType: EnvironmentType,
    version: string,
    extra: Partial<PythonEnvironment> = {},
): PythonEnvironment {
    const [major, minor, patch] = version.split('.').map(Number);
    const envPath = path.dirname(path.dirname(executable));
    return {
        id: executable,
        path: executable,
        envType,
        envPath,
        sysPrefix: envPath,
        architecture: Architecture.x64,
        version: { major, minor, patch, raw: version, build: [], prerelease: [] },
        ...extra,
    };
}

const context: PickerGroupContext = {
    workspacePath: p('/home/u/myproject'),
    homeInsideWorkspace: false,
    nestedEnvDirs: [],
    uvPythonInstallDirs: [p('/home/u/.local/share/uv/python')],
};

suite('pickerInfo', () => {
    const projectVenv = env(p('/home/u/myproject/.venv/bin/python'), EnvironmentType.Uv, '3.12.4', {
        envName: '.venv',
    });
    const condaNamed = env(p('/home/u/miniconda3/envs/ds/bin/python'), EnvironmentType.Conda, '3.11.0', {
        envName: 'ds',
    });
    const condaBase = env(p('/home/u/miniconda3/bin/python'), EnvironmentType.Conda, '3.11.1', { envName: 'base' });
    const pyenv = env(p('/home/u/.pyenv/versions/3.13.1/bin/python'), EnvironmentType.Pyenv, '3.13.1');
    const pyenvVirtualenv = env(
        p('/home/u/.pyenv/versions/3.13.1/envs/tool/bin/python'),
        EnvironmentType.Pyenv,
        '3.13.1',
        { nativeKind: NativePythonEnvironmentKind.PyenvVirtualEnv, envName: 'tool' },
    );
    const pythonOrg = env(
        p('/Library/Frameworks/Python.framework/Versions/3.12/bin/python3'),
        EnvironmentType.System,
        '3.12.5',
        { nativeKind: NativePythonEnvironmentKind.MacPythonOrg },
    );
    const homebrew = env(p('/opt/homebrew/bin/python3'), EnvironmentType.System, '3.13.2', {
        nativeKind: NativePythonEnvironmentKind.Homebrew,
    });
    const uvBase = env(
        p('/home/u/.local/share/uv/python/cpython-3.12.8/bin/python3'),
        EnvironmentType.Global,
        '3.12.8',
        { nativeKind: NativePythonEnvironmentKind.Uv },
    );

    test('pickerGroupOf groups by location', () => {
        assert.deepEqual(
            {
                projectVenv: pickerGroupOf(projectVenv, context, false),
                condaNamed: pickerGroupOf(condaNamed, context, false),
                pyenv: pickerGroupOf(pyenv, context, false),
                pythonOrg: pickerGroupOf(pythonOrg, context, false),
                uvBase: pickerGroupOf(uvBase, context, false),
                condaBase: pickerGroupOf(condaBase, context, false),
                externallyManaged: pickerGroupOf(homebrew, context, true),
            },
            {
                projectVenv: PythonPickerGroup.Project,
                condaNamed: PythonPickerGroup.Global,
                pyenv: PythonPickerGroup.Base,
                pythonOrg: PythonPickerGroup.Base,
                uvBase: PythonPickerGroup.ExternallyManaged,
                condaBase: PythonPickerGroup.ExternallyManaged,
                externallyManaged: PythonPickerGroup.ExternallyManaged,
            },
        );
    });

    test('pickerGroupOf counts only nested envs as Project when the workspace is the home folder', () => {
        const homeVenv = env(p('/home/u/.venv/bin/python'), EnvironmentType.Venv, '3.12.1');
        const virtualenvsFoo = env(
            p('/home/u/.virtualenvs/foo/bin/python'),
            EnvironmentType.VirtualEnvWrapper,
            '3.12.2',
        );
        const homeContext: PickerGroupContext = {
            ...context,
            workspacePath: p('/home/u'),
            homeInsideWorkspace: true,
            nestedEnvDirs: [],
        };
        assert.deepEqual(
            {
                virtualenvsFoo: pickerGroupOf(virtualenvsFoo, homeContext, false),
                homeVenv: pickerGroupOf(homeVenv, { ...homeContext, nestedEnvDirs: [p('/home/u/.venv')] }, false),
            },
            { virtualenvsFoo: PythonPickerGroup.Global, homeVenv: PythonPickerGroup.Project },
        );
    });

    test('a pyenv virtualenv named by .python-version is Global', () => {
        // Grouping never reads `.python-version`, so the named virtualenv stays where it lives.
        assert.strictEqual(pickerGroupOf(pyenvVirtualenv, context, false), PythonPickerGroup.Global);
    });

    test('createPythonPickerInfo builds the label and gray text', () => {
        const common = { context, externallyManaged: false };
        assert.deepEqual(
            [
                createPythonPickerInfo({
                    ...common,
                    interpreter: projectVenv,
                    runtimeSource: EnvironmentType.Uv,
                    envName: 'myproject',
                    pythonVersion: '3.12.4',
                    supported: true,
                }),
                createPythonPickerInfo({
                    ...common,
                    interpreter: homebrew,
                    runtimeSource: EnvironmentType.System,
                    envName: '',
                    pythonVersion: '3.13.2',
                    supported: true,
                    externallyManaged: true,
                }),
                createPythonPickerInfo({
                    ...common,
                    interpreter: pyenv,
                    runtimeSource: EnvironmentType.Pyenv,
                    envName: '3.13.1',
                    pythonVersion: '3.13.1',
                    supported: false,
                }),
            ],
            [
                {
                    group: 'Project environments',
                    groupOrder: 0,
                    rowOrder: 0,
                    label: 'Python 3.12.4',
                    description: 'uv: myproject',
                },
                {
                    group: 'Externally managed',
                    groupOrder: 3,
                    rowOrder: 0,
                    label: 'Python 3.13.2',
                    description: 'Homebrew',
                },
                {
                    group: 'Base interpreters',
                    groupOrder: 2,
                    rowOrder: 1,
                    label: 'Python 3.13.1',
                    description: 'pyenv \u00B7 not supported',
                },
            ],
        );
    });
});
