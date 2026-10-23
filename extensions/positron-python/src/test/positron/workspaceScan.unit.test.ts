/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as platform from '../../client/common/utils/platform';
import * as interpreterSettings from '../../client/positron/interpreterSettings';
import { isProjectEnvironment, scanWorkspace } from '../../client/positron/workspaceScan';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';

/** Create an env at `envDir` with the executable layout PET expects on this OS. */
function makeEnv(envDir: string, layout: 'venv' | 'conda' = 'venv'): string {
    const isWindows = platform.getOSType() === platform.OSType.Windows;
    let executable: string;
    if (!isWindows) {
        executable = path.join(envDir, 'bin', 'python');
    } else if (layout === 'conda') {
        executable = path.join(envDir, 'python.exe');
    } else {
        executable = path.join(envDir, 'Scripts', 'python.exe');
    }
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '');
    return executable;
}

function makeInterpreter(executable: string, envPath?: string): PythonEnvironment {
    return {
        id: executable,
        path: executable,
        envPath,
        envType: EnvironmentType.Venv,
        architecture: platform.Architecture.x64,
        sysPrefix: envPath ?? '',
    };
}

suite('workspaceScan', () => {
    let root: string;
    let includeStub: sinon.SinonStub;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-workspace-scan-'));
        includeStub = sinon.stub(interpreterSettings, 'shouldIncludeInterpreter').returns(true);
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('finds nothing in an empty folder, or one that cannot be read', async () => {
        const empty = {
            rootProjectEnvs: [],
            nestedEnvDirs: [],
            hasPythonSignals: false,
            pythonVersion: undefined,
        };
        assert.deepEqual([await scanWorkspace(root), await scanWorkspace(path.join(root, 'missing'))], [empty, empty]);
    });

    test('picks the root env by priority, skipping broken and excluded ones', async () => {
        // Each case: the env dirs to create (broken ones have no executable), the excluded
        // ones, and the env dir that should win.
        const cases: { make: string[]; broken?: string[]; excluded?: string[]; expected: string }[] = [
            { make: ['.pixi/envs/default', 'venv', '.conda', '.venv'], expected: '.venv' },
            { make: ['.conda'], broken: ['.venv'], expected: '.conda' },
            { make: ['.venv', '.conda'], excluded: ['.venv'], expected: '.conda' },
            { make: ['.pixi/envs/zeta', '.pixi/envs/alpha'], expected: '.pixi/envs/alpha' },
            { make: ['.pixi/envs/alpha', '.pixi/envs/default'], expected: '.pixi/envs/default' },
        ];
        const actual: (string | undefined)[] = [];
        for (const c of cases) {
            const dir = fs.mkdtempSync(path.join(root, 'case-'));
            const executables = new Map(
                c.make.map((name) => [
                    name,
                    makeEnv(path.join(dir, name), name === '.venv' || name === 'venv' ? 'venv' : 'conda'),
                ]),
            );
            for (const name of c.broken ?? []) {
                fs.mkdirSync(path.join(dir, name));
            }
            for (const name of c.excluded ?? []) {
                includeStub.withArgs(executables.get(name)).returns(false);
            }
            const found = (await scanWorkspace(dir)).rootProjectEnvs[0];
            actual.push(found && path.relative(dir, found.envDir).split(path.sep).join('/'));
        }
        assert.deepEqual(
            actual,
            cases.map((c) => c.expected),
        );
    });

    test('keeps every root env, highest priority first', async () => {
        for (const name of ['venv', '.conda', '.venv']) {
            makeEnv(path.join(root, name), name === '.conda' ? 'conda' : 'venv');
        }

        assert.deepEqual(
            (await scanWorkspace(root)).rootProjectEnvs.map((e) => path.basename(e.envDir)),
            ['.venv', '.conda', 'venv'],
        );
    });

    test('finds envs exactly one level down, in found order, not two levels and not at the root', async () => {
        makeEnv(path.join(root, '.venv'));
        makeEnv(path.join(root, 'b', '.venv'));
        makeEnv(path.join(root, 'a', '.conda'), 'conda');
        makeEnv(path.join(root, 'a', '.venv'));
        makeEnv(path.join(root, 'deep', 'nested', '.venv'));
        makeEnv(path.join(root, 'node_modules', 'pkg', '.venv'));
        fs.mkdirSync(path.join(root, 'c', 'venv'), { recursive: true }); // no executable

        assert.deepEqual((await scanWorkspace(root)).nestedEnvDirs, [
            path.join(root, 'a', '.venv'),
            path.join(root, 'a', '.conda'),
            path.join(root, 'b', '.venv'),
        ]);
    });

    test('skips nested envs that are excluded, and ignored folders whatever their case', async () => {
        const excluded = makeEnv(path.join(root, 'a', '.venv'));
        includeStub.withArgs(excluded).returns(false);
        makeEnv(path.join(root, 'Node_Modules', 'pkg', '.venv'));
        makeEnv(path.join(root, '.Tox', '.venv'));
        makeEnv(path.join(root, 'b', '.venv'));

        assert.deepEqual((await scanWorkspace(root)).nestedEnvDirs, [path.join(root, 'b', '.venv')]);
    });

    test('stops after 1000 child folders', async () => {
        for (let i = 0; i < 1005; i += 1) {
            fs.mkdirSync(path.join(root, `d${String(i).padStart(4, '0')}`));
        }
        makeEnv(path.join(root, 'd1004', '.venv'));
        fs.writeFileSync(path.join(root, 'd1004', 'main.py'), '');

        const scan = await scanWorkspace(root);
        assert.deepEqual([scan.nestedEnvDirs, scan.hasPythonSignals], [[], false]);
    });

    test('shares the latest scan of a folder until it is rescanned', async () => {
        const first = scanWorkspace(root);
        assert.strictEqual(scanWorkspace(root), first);
        // Let the first scan finish before changing the folder: its reads are async, so a
        // file written while it runs may or may not be seen.
        const before = (await first).hasPythonSignals;
        fs.writeFileSync(path.join(root, 'main.py'), '');

        assert.deepEqual(
            [
                before,
                // Still the shared scan from before the file was written.
                (await scanWorkspace(root)).hasPythonSignals,
                (await scanWorkspace(root, true)).hasPythonSignals,
                // The rescan is now the latest.
                (await scanWorkspace(root)).hasPythonSignals,
            ],
            [false, false, true, true],
        );
    });

    test('finds Python signals at the root and one level deep, not two', async () => {
        fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
        fs.writeFileSync(path.join(root, 'a', 'b', 'main.py'), '');
        const twoLevels = (await scanWorkspace(root)).hasPythonSignals;

        fs.writeFileSync(path.join(root, 'a', 'dev-requirements.txt'), '');
        const oneLevel = (await scanWorkspace(root, true)).hasPythonSignals;

        assert.deepEqual([twoLevels, oneLevel], [false, true]);
    });

    test('recognizes each signal file at the root', async () => {
        const names = [
            'x.py',
            'x.ipynb',
            'pyproject.toml',
            'requirements-dev.txt',
            'Pipfile',
            'setup.py',
            'setup.cfg',
            'environment.yml',
            '.python-version',
            'uv.lock',
            'pixi.toml',
            'Requirements.txt',
            'Setup.py',
            'X.PY',
            'PIPFILE',
        ];
        for (const name of names) {
            const dir = fs.mkdtempSync(path.join(root, 'signal-'));
            fs.writeFileSync(path.join(dir, name), '');
            assert.isTrue((await scanWorkspace(dir)).hasPythonSignals, name);
        }
    });

    test('reads the first version in .python-version', async () => {
        fs.writeFileSync(path.join(root, '.python-version'), '\n3.12.7\n3.11.9\n');
        assert.strictEqual((await scanWorkspace(root)).pythonVersion, '3.12.7');
    });

    test('reads the version from a .python-version file that starts with a BOM', async () => {
        fs.writeFileSync(path.join(root, '.python-version'), '\uFEFF3.12.7\n');
        assert.strictEqual((await scanWorkspace(root)).pythonVersion, '3.12.7');
    });

    test('recognizes the project env by env dir when PET reports a different executable name', async () => {
        const executable = makeEnv(path.join(root, '.venv'));
        const projectEnv = (await scanWorkspace(root)).rootProjectEnvs[0];
        const petPath = path.join(path.dirname(executable), 'python3');

        assert.deepEqual(
            [
                isProjectEnvironment(makeInterpreter(petPath, path.join(root, '.venv')), projectEnv),
                isProjectEnvironment(makeInterpreter(executable), projectEnv),
                isProjectEnvironment(makeInterpreter('/usr/bin/python3', '/usr'), projectEnv),
                isProjectEnvironment(makeInterpreter(executable), undefined),
            ],
            [true, true, false, false],
        );
    });
});
