/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import { EnvironmentType } from '../../client/pythonEnvironments/info';
import {
    categorizePythonEnvironment,
    CategorizationInput,
    PythonEnvironmentCategory,
} from '../../client/positron/interpreterCategorization';

const WS = '/repos/my-project';

function input(overrides: Partial<CategorizationInput>): CategorizationInput {
    return {
        kind: undefined,
        envType: EnvironmentType.Unknown,
        envName: undefined,
        envPath: undefined,
        interpreterPath: '/py',
        project: undefined,
        hasModuleMetadata: false,
        externallyManagedMarker: false,
        workspaceFolders: [WS],
        customInterpreterDirs: [],
        ...overrides,
    };
}

suite('interpreterCategorization - category', () => {
    const cases: Array<[string, Partial<CategorizationInput>, PythonEnvironmentCategory]> = [
        [
            'venv inside workspace -> Project',
            {
                kind: NativePythonEnvironmentKind.Venv,
                envName: '.venv',
                envPath: `${WS}/.venv`,
                interpreterPath: `${WS}/.venv/bin/python`,
            },
            PythonEnvironmentCategory.ProjectEnvironment,
        ],
        [
            'pyenv-local matched by PET project -> Project',
            { kind: NativePythonEnvironmentKind.PyenvVirtualEnv, envPath: '/home/u/.pyenv/versions/proj', project: WS },
            PythonEnvironmentCategory.ProjectEnvironment,
        ],
        [
            'venv elsewhere -> Global',
            { kind: NativePythonEnvironmentKind.Venv, envName: 'positron', envPath: '/home/u/.virtualenvs/positron' },
            PythonEnvironmentCategory.GlobalEnvironment,
        ],
        [
            'conda named env -> Global',
            { kind: NativePythonEnvironmentKind.Conda, envName: 'sandbox', envPath: '/home/u/miniconda3/envs/sandbox' },
            PythonEnvironmentCategory.GlobalEnvironment,
        ],
        [
            'custom-dir interpreter (PET Custom kind) -> Global',
            {
                kind: NativePythonEnvironmentKind.Custom,
                envName: 'shared',
                envPath: '/opt/shared/shared',
                interpreterPath: '/opt/shared/shared/bin/python',
                customInterpreterDirs: ['/opt/shared'],
                workspaceFolders: [],
            },
            PythonEnvironmentCategory.GlobalEnvironment,
        ],
        [
            'pyenv build -> Base',
            { kind: NativePythonEnvironmentKind.Pyenv, interpreterPath: '/home/u/.pyenv/versions/3.13.2/bin/python' },
            PythonEnvironmentCategory.BaseInterpreter,
        ],
        [
            'python.org -> Base',
            {
                kind: NativePythonEnvironmentKind.MacPythonOrg,
                interpreterPath: '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
            },
            PythonEnvironmentCategory.BaseInterpreter,
        ],
        [
            'module interpreter -> Base',
            { hasModuleMetadata: true, interpreterPath: '/opt/apps/python/3.11/bin/python' },
            PythonEnvironmentCategory.BaseInterpreter,
        ],
        [
            'windows store -> Base',
            {
                kind: NativePythonEnvironmentKind.WindowsStore,
                interpreterPath: 'C:/Users/u/AppData/Local/Microsoft/WindowsApps/python.exe',
            },
            PythonEnvironmentCategory.BaseInterpreter,
        ],
        [
            'unmarked standalone -> Base',
            { kind: NativePythonEnvironmentKind.GlobalPaths, interpreterPath: '/opt/python/3.12/bin/python' },
            PythonEnvironmentCategory.BaseInterpreter,
        ],
        [
            'uv base install -> Externally Managed',
            {
                kind: NativePythonEnvironmentKind.Uv,
                interpreterPath: '/home/u/.local/share/uv/python/cpython-3.14.0/bin/python',
            },
            PythonEnvironmentCategory.ExternallyManaged,
        ],
        [
            'non-workspace uv venv -> Global',
            {
                kind: NativePythonEnvironmentKind.Uv,
                envName: 'scratch',
                envPath: '/home/u/.venvs/scratch',
                interpreterPath: '/home/u/.venvs/scratch/bin/python',
            },
            PythonEnvironmentCategory.GlobalEnvironment,
        ],
        [
            'homebrew -> Externally Managed',
            { kind: NativePythonEnvironmentKind.Homebrew, interpreterPath: '/opt/homebrew/bin/python3' },
            PythonEnvironmentCategory.ExternallyManaged,
        ],
        [
            'macOS CLT -> Externally Managed',
            { kind: NativePythonEnvironmentKind.MacCommandLineTools, interpreterPath: '/usr/bin/python3' },
            PythonEnvironmentCategory.ExternallyManaged,
        ],
        [
            'linux system /usr/bin -> Externally Managed',
            { kind: NativePythonEnvironmentKind.LinuxGlobal, interpreterPath: '/usr/bin/python3' },
            PythonEnvironmentCategory.ExternallyManaged,
        ],
        [
            'conda base -> Externally Managed',
            {
                kind: NativePythonEnvironmentKind.Conda,
                envName: 'base',
                envPath: '/home/u/miniconda3',
                interpreterPath: '/home/u/miniconda3/bin/python',
            },
            PythonEnvironmentCategory.ExternallyManaged,
        ],
        [
            'marked distro python -> Externally Managed',
            {
                kind: NativePythonEnvironmentKind.GlobalPaths,
                interpreterPath: '/opt/python/3.12/bin/python',
                externallyManagedMarker: true,
            },
            PythonEnvironmentCategory.ExternallyManaged,
        ],
        [
            'no workspace -> venv is Global not Project',
            { kind: NativePythonEnvironmentKind.Venv, envName: 'x', envPath: '/somewhere/x', workspaceFolders: [] },
            PythonEnvironmentCategory.GlobalEnvironment,
        ],
    ];
    cases.forEach(([name, over, expected]) => {
        test(name, () => {
            assert.strictEqual(categorizePythonEnvironment(input(over)).category, expected);
        });
    });
});

suite('interpreterCategorization - sortKey + tokens', () => {
    test('sortKey = category*1000 + subpriority; uv ranks first in tier 1', () => {
        const uv = categorizePythonEnvironment(
            input({
                kind: NativePythonEnvironmentKind.UvWorkspace,
                envName: '.venv',
                envPath: `${WS}/.venv`,
                interpreterPath: `${WS}/.venv/bin/python`,
            }),
        );
        const conda = categorizePythonEnvironment(
            input({
                kind: NativePythonEnvironmentKind.Conda,
                envName: 'p',
                envPath: `${WS}/.conda`,
                interpreterPath: `${WS}/.conda/bin/python`,
            }),
        );
        assert.strictEqual(uv.managerToken, 'uv');
        assert.strictEqual(conda.managerToken, 'conda');
        assert.isTrue(uv.sortKey < conda.sortKey);
        assert.isTrue(uv.sortKey >= 1000 && uv.sortKey < 2000);
    });
    test('system pythons sort dead last within tier 4', () => {
        const sys = categorizePythonEnvironment(
            input({ kind: NativePythonEnvironmentKind.LinuxGlobal, interpreterPath: '/usr/bin/python3' }),
        );
        const uvBase = categorizePythonEnvironment(
            input({
                kind: NativePythonEnvironmentKind.Uv,
                interpreterPath: '/home/u/.local/share/uv/python/x/bin/python',
            }),
        );
        const condaBase = categorizePythonEnvironment(
            input({
                kind: NativePythonEnvironmentKind.Conda,
                envName: 'base',
                interpreterPath: '/home/u/miniconda3/bin/python',
            }),
        );
        assert.isTrue(uvBase.sortKey < condaBase.sortKey);
        assert.isTrue(condaBase.sortKey < sys.sortKey);
    });
    test('custom-configured location ranks above well-known homes in tier 2', () => {
        const custom = categorizePythonEnvironment(
            input({
                kind: NativePythonEnvironmentKind.Custom,
                envName: 'a',
                envPath: '/opt/shared/a',
                customInterpreterDirs: ['/opt/shared'],
                workspaceFolders: [],
            }),
        );
        const home = categorizePythonEnvironment(
            input({
                kind: NativePythonEnvironmentKind.Venv,
                envName: 'b',
                envPath: '/home/u/.virtualenvs/b',
                workspaceFolders: [],
            }),
        );
        assert.isTrue(custom.sortKey < home.sortKey);
    });
});

// Envs lacking a raw PET kind (JS locator / cache miss) fall back to the collapsed
// envType. Each case sets kind: undefined so the envType fallback is exercised.
suite('interpreterCategorization - envType fallback (no PET kind)', () => {
    test('conda base without kind -> Externally Managed (not a dedicated env)', () => {
        const condaBase = categorizePythonEnvironment(
            input({
                kind: undefined,
                envType: EnvironmentType.Conda,
                envName: 'base',
                interpreterPath: '/home/u/miniconda3/bin/python',
                workspaceFolders: [],
            }),
        );
        assert.strictEqual(condaBase.category, PythonEnvironmentCategory.ExternallyManaged);
    });

    test('conda named env without kind -> Global', () => {
        const condaNamed = categorizePythonEnvironment(
            input({
                kind: undefined,
                envType: EnvironmentType.Conda,
                envName: 'sandbox',
                envPath: '/home/u/miniconda3/envs/sandbox',
                workspaceFolders: [],
            }),
        );
        assert.strictEqual(condaNamed.category, PythonEnvironmentCategory.GlobalEnvironment);
    });

    test('custom interpreter without kind -> Global', () => {
        const custom = categorizePythonEnvironment(
            input({
                kind: undefined,
                envType: EnvironmentType.Custom,
                interpreterPath: '/opt/shared/bin/python',
                workspaceFolders: [],
            }),
        );
        assert.strictEqual(custom.category, PythonEnvironmentCategory.GlobalEnvironment);
    });

    test('uv base install without kind -> Externally Managed (not a dedicated env)', () => {
        const uvBase = categorizePythonEnvironment(
            input({
                kind: undefined,
                envType: EnvironmentType.Uv,
                interpreterPath: '/home/u/.local/share/uv/python/cpython-3.14.0/bin/python',
                workspaceFolders: [],
            }),
        );
        assert.strictEqual(uvBase.category, PythonEnvironmentCategory.ExternallyManaged);
    });

    test('uv venv without kind -> Global', () => {
        const uvVenv = categorizePythonEnvironment(
            input({
                kind: undefined,
                envType: EnvironmentType.Uv,
                envName: 'scratch',
                envPath: '/home/u/.venvs/scratch',
                interpreterPath: '/home/u/.venvs/scratch/bin/python',
                workspaceFolders: [],
            }),
        );
        assert.strictEqual(uvVenv.category, PythonEnvironmentCategory.GlobalEnvironment);
    });

    const tokenCases: Array<[EnvironmentType, string]> = [
        [EnvironmentType.Uv, 'uv'],
        [EnvironmentType.Pixi, 'pixi'],
        [EnvironmentType.Poetry, 'poetry'],
        [EnvironmentType.Pipenv, 'pipenv'],
        [EnvironmentType.VirtualEnvWrapper, 'virtualenvwrapper'],
    ];
    tokenCases.forEach(([envType, token]) => {
        test(`${envType} without kind -> '${token}' manager token`, () => {
            const result = categorizePythonEnvironment(
                input({ kind: undefined, envType, envName: 'e', envPath: '/home/u/envs/e', workspaceFolders: [] }),
            );
            assert.strictEqual(result.managerToken, token);
        });
    });
});

// validVenvSeed answers "can venv creation safely spawn the raw interpreter path", which is
// distinct from category (project appropriateness). Base/externally-managed interpreters
// qualify except module-managed and ActiveState Pythons; MicrosoftStore is deliberately
// allowed. Dedicated environments (categories 1-2) are never seeds.
suite('interpreterCategorization - validVenvSeed', () => {
    const cases: Array<[string, Partial<CategorizationInput>, boolean]> = [
        [
            'python.org base -> seedable',
            { kind: NativePythonEnvironmentKind.MacPythonOrg, interpreterPath: '/Library/py/bin/python3' },
            true,
        ],
        [
            'conda base (externally managed) -> seedable',
            {
                kind: NativePythonEnvironmentKind.Conda,
                envName: 'base',
                envPath: '/home/u/miniconda3',
                interpreterPath: '/home/u/miniconda3/bin/python',
            },
            true,
        ],
        [
            'windows store -> seedable (deliberate; may be the only Python on the machine)',
            {
                kind: NativePythonEnvironmentKind.WindowsStore,
                envType: EnvironmentType.MicrosoftStore,
                interpreterPath: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe',
            },
            true,
        ],
        [
            'module python (envType) -> not seedable',
            {
                envType: EnvironmentType.Module,
                hasModuleMetadata: true,
                interpreterPath: '/opt/apps/python/3.11/bin/python',
            },
            false,
        ],
        [
            'module python reconciled onto a native path (metadata only) -> not seedable',
            { hasModuleMetadata: true, interpreterPath: '/opt/apps/python/3.12/bin/python' },
            false,
        ],
        [
            'ActiveState managed runtime -> not seedable',
            { envType: EnvironmentType.ActiveState, interpreterPath: '/home/u/.activestate/x/bin/python' },
            false,
        ],
        [
            'project venv (category 1) -> not seedable',
            {
                kind: NativePythonEnvironmentKind.Venv,
                envName: '.venv',
                envPath: `${WS}/.venv`,
                interpreterPath: `${WS}/.venv/bin/python`,
            },
            false,
        ],
        [
            'global named env (category 2) -> not seedable',
            { kind: NativePythonEnvironmentKind.Venv, envName: 'x', envPath: '/home/u/.virtualenvs/x' },
            false,
        ],
    ];
    cases.forEach(([name, over, expected]) => {
        test(name, () => {
            assert.strictEqual(categorizePythonEnvironment(input(over)).validVenvSeed, expected);
        });
    });
});
