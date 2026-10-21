/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import * as vscode from 'vscode';
import * as platform from '../../client/common/utils/platform';
import { Architecture } from '../../client/common/utils/platform';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import { IActivatedEnvironmentLaunch } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import {
    buildRankingContext,
    RankingContext,
    rankInterpreters,
    Tier,
    tierOf,
    withDiscoveredFacts,
} from '../../client/positron/interpreterRanking';
import * as externallyManagedEnvironment from '../../client/positron/externallyManagedEnvironment';
import * as interpreterSettings from '../../client/positron/interpreterSettings';
import * as workspaceScan from '../../client/positron/workspaceScan';
import * as externalDependencies from '../../client/pythonEnvironments/common/externalDependencies';
import { createTypeMoq } from '../mocks/helper';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import * as moduleLocator from '../../client/pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';

/**
 * An absolute path on every OS: as written on macOS and Linux, drive-rooted with
 * backslashes on Windows, where `isParentPath` compares with `path.sep`.
 */
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

const emptyContext: RankingContext = {
    workspacePath: p('/proj'),
    homeInsideWorkspace: false,
    activatedEnvPrefix: undefined,
    definitionPaths: [],
    definitionsOnly: false,
    defaultInterpreterPath: undefined,
    rootProjectEnvs: [],
    pythonVersion: undefined,
    pythonVersionDir: undefined,
    nestedEnvDirs: [],
    hasPythonSignals: false,
    configuredPaths: [],
    modulePaths: new Set(),
    condaEnvDirs: [],
    positronDefaultEnvDir: p('/home/u/.virtualenvs/positron'),
    uvPythonInstallDirs: [p('/home/u/.local/share/uv/python')],
    externallyManagedPaths: new Set(),
};

suite('interpreterRanking', () => {
    teardown(() => sinon.restore());

    const activated = env(p('/home/u/envs/active/bin/python'), EnvironmentType.Venv, '3.12.1');
    const defaultPath = env(p('/opt/team/bin/python'), EnvironmentType.Custom, '3.11.3');
    const rootVenv = env(p('/proj/.venv/bin/python'), EnvironmentType.Venv, '3.12.7');
    const pyenvPinned = env(p('/home/u/.pyenv/versions/3.10.4/bin/python'), EnvironmentType.Pyenv, '3.10.4');
    const nestedB = env(p('/proj/b/.venv/bin/python'), EnvironmentType.Venv, '3.13.0');
    const nestedA = env(p('/proj/a/.venv/bin/python'), EnvironmentType.Venv, '3.9.1');
    const inFolderPoetry = env(p('/proj/tools/env/bin/python'), EnvironmentType.Poetry, '3.12.0');
    const defined = env(p('/opt/defined/bin/python'), EnvironmentType.Custom, '3.11.2');
    const module = env(p('/apps/python/3.12/bin/python'), EnvironmentType.Module, '3.12.3');
    // PET reports many module Pythons as plain globals; moduleMetadataMap knows better.
    const moduleByMetadata = env(p('/apps/python/3.11/bin/python'), EnvironmentType.Global, '3.11.9');
    const venvFolder = env(p('/srv/venvs/team/bin/python'), EnvironmentType.Venv, '3.13.4');
    const positronDefault = env(p('/home/u/.virtualenvs/positron/bin/python'), EnvironmentType.Venv, '3.12.4');
    const condaNamed = env(p('/home/u/miniconda3/envs/ds/bin/python'), EnvironmentType.Conda, '3.11.0', {
        envName: 'ds',
    });
    const pyenvVirtualenv = env(
        p('/home/u/.pyenv/versions/3.13.1/envs/tool/bin/python'),
        EnvironmentType.Pyenv,
        '3.13.1',
        {
            nativeKind: NativePythonEnvironmentKind.PyenvVirtualEnv,
            envName: 'tool',
        },
    );
    const uvBase = env(
        p('/home/u/.local/share/uv/python/cpython-3.12.8/bin/python3'),
        EnvironmentType.Global,
        '3.12.8',
        {
            nativeKind: NativePythonEnvironmentKind.Uv,
        },
    );
    const condaBase = env(p('/home/u/miniconda3/bin/python'), EnvironmentType.Conda, '3.11.1', { envName: 'base' });
    const pyenv = env(p('/home/u/.pyenv/versions/3.13.1/bin/python'), EnvironmentType.Pyenv, '3.13.1');
    const globalVirtualenv = env(
        p('/home/u/.virtualenvs/other/bin/python'),
        EnvironmentType.VirtualEnvWrapper,
        '3.13.6',
    );
    const pythonOrg = env(
        p('/Library/Frameworks/Python.framework/Versions/3.12/bin/python3'),
        EnvironmentType.System,
        '3.12.5',
        {
            nativeKind: NativePythonEnvironmentKind.MacPythonOrg,
        },
    );
    const homebrew = env(p('/opt/homebrew/bin/python3'), EnvironmentType.System, '3.13.2', {
        nativeKind: NativePythonEnvironmentKind.Homebrew,
    });
    const unknown = env(p('/weird/python'), EnvironmentType.Unknown, '3.12.0');

    const context: RankingContext = {
        ...emptyContext,
        activatedEnvPrefix: p('/home/u/envs/active'),
        definitionPaths: [defined.path],
        defaultInterpreterPath: defaultPath.path,
        rootProjectEnvs: [{ envDir: p('/proj/.venv'), executable: rootVenv.path }],
        pythonVersion: '3.10.4',
        pythonVersionDir: p('/home/u/.pyenv/versions/3.10.4'),
        nestedEnvDirs: [p('/proj/a/.venv'), p('/proj/b/.venv')],
        configuredPaths: [p('/srv/venvs')],
        modulePaths: new Set([moduleByMetadata.path]),
        // uv installs its Pythons with an EXTERNALLY-MANAGED marker; uv base is still GlobalEnv.
        externallyManagedPaths: new Set([homebrew.path, uvBase.path]),
    };

    test('ranks every kind of interpreter in tier order', () => {
        // Shuffled on purpose: the result must not depend on input order.
        const interpreters = [
            unknown,
            homebrew,
            pythonOrg,
            globalVirtualenv,
            pyenv,
            condaBase,
            uvBase,
            pyenvVirtualenv,
            condaNamed,
            positronDefault,
            venvFolder,
            moduleByMetadata,
            module,
            defined,
            inFolderPoetry,
            nestedB,
            nestedA,
            pyenvPinned,
            rootVenv,
            defaultPath,
            activated,
        ];

        const ranked = rankInterpreters(interpreters, context).map(({ interpreter, tier }) => [
            interpreter.path,
            tier === undefined ? 'never' : Tier[tier],
        ]);

        assert.deepEqual(ranked, [
            [activated.path, 'ActivatedEnv'],
            [defaultPath.path, 'DefaultInterpreterPath'],
            [rootVenv.path, 'ProjectEnv'],
            [pyenvPinned.path, 'PythonVersionFile'],
            [nestedA.path, 'WorkspaceEnv'],
            [nestedB.path, 'WorkspaceEnv'],
            [inFolderPoetry.path, 'WorkspaceEnv'],
            [defined.path, 'Configured'],
            [module.path, 'Configured'],
            [moduleByMetadata.path, 'Configured'],
            [venvFolder.path, 'Configured'],
            [positronDefault.path, 'PositronDefaultEnv'],
            [condaNamed.path, 'NamedEnv'],
            [pyenvVirtualenv.path, 'NamedEnv'],
            [uvBase.path, 'GlobalEnv'],
            [condaBase.path, 'GlobalEnv'],
            [pyenv.path, 'GlobalEnv'],
            [globalVirtualenv.path, 'GlobalEnv'],
            [pythonOrg.path, 'BaseInstall'],
            [homebrew.path, 'ExternallyManaged'],
            [unknown.path, 'never'],
        ]);
    });

    test('in definitionsOnly mode, definitions are ranked by what they are, then in list order', () => {
        const definitionsOnly: RankingContext = {
            ...emptyContext,
            definitionsOnly: true,
            definitionPaths: [homebrew.path, defined.path, rootVenv.path],
            rootProjectEnvs: [{ envDir: p('/proj/.venv'), executable: rootVenv.path }],
            externallyManagedPaths: new Set([homebrew.path]),
        };

        assert.deepEqual(
            rankInterpreters([homebrew, defined, rootVenv], definitionsOnly).map((r) => [
                r.interpreter.path,
                Tier[r.tier!],
            ]),
            [
                [rootVenv.path, 'ProjectEnv'],
                [homebrew.path, 'Configured'],
                [defined.path, 'Configured'],
            ],
        );
    });

    test('a definition located inside the workspace folder is a WorkspaceEnv, not Configured', () => {
        const inWorkspace = env(p('/proj/tools/env/bin/python'), EnvironmentType.Custom, '3.12.0');
        const context: RankingContext = { ...emptyContext, definitionPaths: [inWorkspace.path] };

        assert.strictEqual(Tier[tierOf(inWorkspace, context)!], 'WorkspaceEnv');
    });

    test('an interpreter PET cannot classify is ranked only when the user names it', () => {
        const custom = env(p('/opt/python/3.12.4/bin/python3'), EnvironmentType.Unknown, '3.12.4');
        assert.deepEqual(
            [
                tierOf(custom, { ...emptyContext, defaultInterpreterPath: custom.path }),
                tierOf(custom, { ...emptyContext, activatedEnvPrefix: custom.envPath }),
                tierOf(custom, { ...emptyContext, definitionPaths: [custom.path] }),
                tierOf(custom, emptyContext),
            ],
            [Tier.DefaultInterpreterPath, Tier.ActivatedEnv, Tier.Configured, undefined],
        );
    });

    test('with home opened as the folder, only envs one level down are WorkspaceEnv', () => {
        const nestedVenv = env(p('/home/u/proj/.venv/bin/python'), EnvironmentType.Venv, '3.12.0');
        const pyenvVersion = env(p('/home/u/.pyenv/versions/3.12.0/bin/python'), EnvironmentType.Pyenv, '3.12.0');
        const home = { ...emptyContext, workspacePath: p('/home/u'), nestedEnvDirs: [p('/home/u/proj/.venv')] };

        assert.deepEqual(
            [
                tierOf(nestedVenv, { ...home, homeInsideWorkspace: true }),
                tierOf(pyenvVersion, { ...home, homeInsideWorkspace: true }),
                // Without the flag, everything under the folder is the folder's own.
                tierOf(pyenvVersion, { ...home, homeInsideWorkspace: false }),
            ].map((tier) => Tier[tier!]),
            ['WorkspaceEnv', 'GlobalEnv', 'WorkspaceEnv'],
        );
    });

    test("another folder's conda --prefix env is never recommended unless a setting names it", () => {
        const otherProject = env(p('/home/u/code/other/.conda/bin/python'), EnvironmentType.Conda, '3.11.0', {
            envName: '',
        });
        const thisFolder = env(p('/proj/.conda/bin/python'), EnvironmentType.Conda, '3.11.0', { envName: '' });
        // A named env reported without its name still lives in an `envs` folder.
        const unnamedNamedEnv = env(p('/home/u/miniforge3/envs/tools/bin/python'), EnvironmentType.Conda, '3.11.0', {
            envName: '',
        });
        // A named env in a custom envs_dirs folder, reported without its name.
        const customEnvsDir = env(p('/data/conda-envs/tools/bin/python'), EnvironmentType.Conda, '3.11.0', {
            envName: '',
            envPath: p('/data/conda-envs/tools'),
        });
        assert.deepEqual(
            [
                tierOf(otherProject, emptyContext),
                tierOf(otherProject, { ...emptyContext, defaultInterpreterPath: otherProject.path }),
                tierOf(otherProject, { ...emptyContext, definitionPaths: [otherProject.path] }),
                tierOf(otherProject, { ...emptyContext, configuredPaths: [p('/home/u/code/other')] }),
                tierOf(thisFolder, emptyContext),
                tierOf(unnamedNamedEnv, emptyContext),
                tierOf(customEnvsDir, { ...emptyContext, condaEnvDirs: [p('/data/conda-envs')] }),
            ],
            [
                undefined,
                Tier.DefaultInterpreterPath,
                Tier.Configured,
                Tier.Configured,
                Tier.WorkspaceEnv,
                Tier.NamedEnv,
                Tier.NamedEnv,
            ],
        );
    });

    test('.python-version: a named pyenv virtualenv is a ProjectEnv, a named pyenv version is a PythonVersionFile', () => {
        const versions = p('/home/u/.pyenv/versions');
        const named = (name: string) => ({
            ...emptyContext,
            pythonVersion: name,
            pythonVersionDir: path.join(versions, name),
        });
        // PET reports X.Y.Z in version.raw, so a pre-release is matched by its folder.
        const prerelease = env(p('/home/u/.pyenv/versions/3.13.0rc1/bin/python'), EnvironmentType.Pyenv, '3.13.0');
        assert.deepEqual(
            [
                tierOf(pyenvVirtualenv, named('tool')),
                tierOf(pyenv, named('3.13.1')),
                tierOf(prerelease, named('3.13.0rc1')),
                // A virtualenv built on the named version is not what the file names.
                tierOf(pyenvVirtualenv, named('3.13.1')),
            ],
            [Tier.ProjectEnv, Tier.PythonVersionFile, Tier.PythonVersionFile, Tier.NamedEnv],
        );
    });

    test('a pre-release ranks below every stable Python, unless the user or project named it', () => {
        const stable = (v: string) => env(p(`/home/u/.pyenv/versions/${v}/bin/python`), EnvironmentType.Pyenv, v);
        const rc = env(p('/home/u/.pyenv/versions/3.14.0rc3/bin/python'), EnvironmentType.Pyenv, '3.14.0', {
            version: { major: 3, minor: 14, patch: 0, raw: '3.14.0', build: [], prerelease: ['candidate', '3'] },
        });
        const order = (list: PythonEnvironment[], context: RankingContext = emptyContext) =>
            rankInterpreters(list, context).map((r) => r.interpreter.path);
        // Same tier: the stable ones first, newest first, then the pre-release.
        assert.deepEqual(order([rc, stable('3.14.6'), stable('3.15.0')]), [
            stable('3.15.0').path,
            stable('3.14.6').path,
            rc.path,
        ]);
        // A pre-release in a better tier still loses to a stable Python in a lower tier.
        const python = env(p('/usr/local/python3.12/bin/python'), EnvironmentType.Global, '3.12.1');
        assert.deepEqual(order([rc, python]), [python.path, rc.path]);
        // A pre-release the user named is not demoted.
        assert.deepEqual(order([python, rc], { ...emptyContext, defaultInterpreterPath: rc.path }), [
            rc.path,
            python.path,
        ]);
        // A never-recommended interpreter ranks after a demoted pre-release.
        assert.deepEqual(order([unknown, rc]), [rc.path, unknown.path]);
    });

    test('a uv Python reached through ~/.local/bin is uv base, first in GlobalEnv', () => {
        const uvDir = p('/home/u/.local/share/uv/python/cpython-3.15.0-linux-x86_64-gnu');
        const linked = env(p('/home/u/.local/bin/python3.15'), EnvironmentType.Unknown, '3.15.0', {
            envType: EnvironmentType.Global,
            envPath: undefined,
            sysPrefix: uvDir,
        });
        const linkedByEnvPath = { ...linked, path: p('/home/u/.local/bin/python3.14'), envPath: uvDir, sysPrefix: '' };
        const pyenvNewer = env(p('/home/u/.pyenv/versions/3.16.0/bin/python'), EnvironmentType.Pyenv, '3.16.0');
        assert.deepEqual(
            [tierOf(linked, emptyContext), tierOf(linkedByEnvPath, emptyContext)],
            [Tier.GlobalEnv, Tier.GlobalEnv],
        );
        assert.equal(rankInterpreters([pyenvNewer, linked], emptyContext)[0].interpreter, linked);
    });

    test('buildRankingContext reads defaultInterpreterPath with get(), never selects, and scans the folder', async () => {
        let value: string | undefined;
        sinon.stub(workspaceApis, 'getConfiguration').returns({
            get: (key: string) => (key === 'defaultInterpreterPath' ? value : undefined),
        } as unknown as vscode.WorkspaceConfiguration);
        sinon
            .stub(interpreterSettings, 'getResolvedFilterSettingPaths')
            .returns({ include: [], exclude: [], override: [] });
        sinon.stub(interpreterSettings, 'getInterpreterDefinitionPaths').returns([]);
        sinon.stub(interpreterSettings, 'isDefinitionsOnlyDiscovery').returns(false);
        const moduleWait = sinon.stub(moduleLocator, 'whenModuleMetadataReady').resolves();
        sinon.stub(workspaceScan, 'scanWorkspace').resolves({
            rootProjectEnvs: [],
            nestedEnvDirs: [],
            hasPythonSignals: true,
            pythonVersion: undefined,
        });
        const launch = createTypeMoq<IActivatedEnvironmentLaunch>();
        launch.setup((a) => a.getActivatedEnvPrefix()).returns(() => Promise.resolve(p('/home/u/envs/active')));
        const serviceContainer = createTypeMoq<IServiceContainer>();
        serviceContainer.setup((c) => c.get(IActivatedEnvironmentLaunch)).returns(() => launch.object);

        async function read(setting: string | undefined) {
            value = setting;
            const c = await buildRankingContext(serviceContainer.object, vscode.Uri.file(p('/proj')));
            return [c.defaultInterpreterPath, c.activatedEnvPrefix, c.hasPythonSignals];
        }

        // get() already applies folder > workspace > user and admin-enforced values,
        // so the scope a value came from never matters. `python` is the default and means unset.
        assert.deepEqual(
            [await read(p('/team/python')), await read('python'), await read(undefined)],
            [
                [p('/team/python'), p('/home/u/envs/active'), true],
                [undefined, p('/home/u/envs/active'), true],
                [undefined, p('/home/u/envs/active'), true],
            ],
        );
        launch.verify((a) => a.selectIfLaunchedViaActivatedEnv(TypeMoq.It.isAny()), TypeMoq.Times.never());
        // Building the context must not wait for module discovery.
        sinon.assert.notCalled(moduleWait);

        // The folder contains home when it is home or an ancestor of it, not a folder inside home.
        const home = sinon.stub(platform, 'getUserHomeDir');
        const containsHome = async (homeDir: string) => {
            home.returns(homeDir);
            return (await buildRankingContext(serviceContainer.object, vscode.Uri.file(p('/proj'))))
                .homeInsideWorkspace;
        };
        assert.deepEqual(
            [await containsHome(p('/proj')), await containsHome(p('/proj/u')), await containsHome(p('/elsewhere'))],
            [true, true, false],
        );

        // A home reached through a symlink (e.g. /home/u -> /export/home/u) still matches
        // the folder opened by its real path.
        sinon
            .stub(externalDependencies, 'canonicalizePath')
            .callsFake(async (candidate: string) =>
                candidate === p('/home/u') ? p('/export/home/u') : path.normalize(candidate),
            );
        home.returns(p('/home/u'));
        const realHomeOpened = await buildRankingContext(serviceContainer.object, vscode.Uri.file(p('/export/home/u')));
        assert.isTrue(realHomeOpened.homeInsideWorkspace);
    });

    test('withDiscoveredFacts waits for module discovery, then fills modulePaths', async () => {
        const modulePath = p('/apps/python/3.11/bin/python');
        sinon.stub(moduleLocator, 'whenModuleMetadataReady').callsFake(async () => {
            moduleLocator.moduleMetadataMap.set(modulePath, {} as unknown as moduleLocator.ModuleMetadata);
        });
        try {
            const context = await withDiscoveredFacts(emptyContext, []);
            assert.deepEqual([...context.modulePaths], [modulePath]);
        } finally {
            moduleLocator.moduleMetadataMap.delete(modulePath);
        }
    });

    test('withDiscoveredFacts fills externallyManagedPaths with the interpreters that are externally managed', async () => {
        const a = env(p('/usr/lib/a/bin/python'), EnvironmentType.System, '3.12.0');
        const b = env(p('/usr/lib/b/bin/python'), EnvironmentType.System, '3.12.0');
        sinon.stub(moduleLocator, 'whenModuleMetadataReady').resolves();
        sinon
            .stub(externallyManagedEnvironment, 'isExternallyManagedEnvironment')
            .callsFake(async (options) => options.interpreterPath === a.path);

        const context = await withDiscoveredFacts(emptyContext, [a, b]);

        assert.deepEqual([...context.externallyManagedPaths], [a.path]);
    });

    test('conda base stays a global env even when it is externally managed', () => {
        const context = { ...emptyContext, externallyManagedPaths: new Set([condaBase.path]) };

        assert.strictEqual(tierOf(condaBase, context), Tier.GlobalEnv);
    });

    test('within a tier, the higher version wins, then the path', () => {
        const older = env(p('/home/u/.pyenv/versions/3.11.0/bin/python'), EnvironmentType.Pyenv, '3.11.0');
        const newer = env(p('/home/u/.pyenv/versions/3.12.0/bin/python'), EnvironmentType.Pyenv, '3.12.0');
        const sameVersion = env(p('/home/u/.pyenv/versions/3.12.0x/bin/python'), EnvironmentType.Pyenv, '3.12.0');

        assert.deepEqual(
            rankInterpreters([older, sameVersion, newer], emptyContext).map((r) => r.interpreter.path),
            [newer.path, sameVersion.path, older.path],
        );
    });

    test('equal or missing versions tie, so the order does not depend on input order', () => {
        const noVersionB = env(p('/home/u/.pyenv/versions/b/bin/python'), EnvironmentType.Pyenv, '3.0.0', {
            version: undefined,
        });
        const noVersionA = env(p('/home/u/.pyenv/versions/a/bin/python'), EnvironmentType.Pyenv, '3.0.0', {
            version: undefined,
        });
        const rawB = env(p('/home/u/.pyenv/versions/d/bin/python'), EnvironmentType.Pyenv, '3.12.0');
        const rawA = env(p('/home/u/.pyenv/versions/c/bin/python'), EnvironmentType.Pyenv, '3.12.0');
        rawB.version = { ...rawB.version!, raw: '3.12.0 (custom build)' };
        const paths = (list: PythonEnvironment[]) =>
            rankInterpreters(list, emptyContext).map((r) => r.interpreter.path);

        assert.deepEqual(paths([noVersionB, rawB, noVersionA, rawA]), paths([rawA, noVersionA, rawB, noVersionB]));
        assert.deepEqual(paths([noVersionB, rawB, noVersionA, rawA]), [
            rawA.path,
            rawB.path,
            noVersionA.path,
            noVersionB.path,
        ]);
    });
});
