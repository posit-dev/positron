/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import * as vscode from 'vscode';
import { Architecture } from '../../client/common/utils/platform';
import * as environmentTypeComparer from '../../client/interpreter/configuration/environmentTypeComparer';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import * as logging from '../../client/logging';
import * as ranking from '../../client/positron/interpreterRanking';
import type { IpykernelBundle } from '../../client/positron/ipykernel';
import { recommendWorkspaceRuntime, startupBehaviorFor } from '../../client/positron/interpreterRecommendation';
import * as interpreterSettings from '../../client/positron/interpreterSettings';
import * as runtime from '../../client/positron/runtime';
import * as commonUtils from '../../client/pythonEnvironments/common/commonUtils';
import * as externalDependencies from '../../client/pythonEnvironments/common/externalDependencies';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { createTypeMoq } from '../mocks/helper';

/**
 * An absolute path on every OS: as written on macOS and Linux, drive-rooted with
 * backslashes on Windows, where `isParentPath` compares with `path.sep`.
 */
function p(posixPath: string): string {
    return path.resolve(posixPath);
}

function env(executable: string, envType: EnvironmentType, extra: Partial<PythonEnvironment> = {}): PythonEnvironment {
    return {
        id: executable,
        path: executable,
        envType,
        envPath: path.dirname(path.dirname(executable)),
        sysPrefix: '',
        architecture: Architecture.x64,
        version: { major: 3, minor: 12, patch: 0, raw: '3.12.0', build: [], prerelease: [] },
        ...extra,
    };
}

suite('interpreterRecommendation', () => {
    const B = positron.LanguageRuntimeStartupBehavior;
    const workspaceUri = vscode.Uri.file(p('/proj'));
    const rootVenv = env(p('/proj/.venv/bin/python'), EnvironmentType.Venv);
    const pyenv = env(p('/home/u/.pyenv/versions/3.12.0/bin/python'), EnvironmentType.Pyenv);
    const homebrew = env(p('/opt/homebrew/bin/python3'), EnvironmentType.System, {
        nativeKind: NativePythonEnvironmentKind.Homebrew,
    });
    const condaBase = env(p('/home/u/miniconda3/bin/python'), EnvironmentType.Conda, { envName: 'base' });

    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let context: ranking.RankingContext;
    let discovered: PythonEnvironment[];
    let resolvable: Map<string, PythonEnvironment>;
    let noKernel: Set<string>;
    let missingPaths: Set<string>;
    let includeStub: sinon.SinonStub;
    let moduleWait: sinon.SinonStub;
    let createStub: sinon.SinonStub;
    let refreshPromise: Promise<void> | undefined;
    const bundle = {} as unknown as IpykernelBundle;

    setup(() => {
        context = {
            workspacePath: p('/proj'),
            activatedEnvPrefix: undefined,
            definitionPaths: [],
            definitionsOnly: false,
            defaultInterpreterPath: undefined,
            rootProjectEnv: undefined,
            pythonVersion: undefined,
            pythonVersionDir: undefined,
            nestedEnvDirs: [],
            hasPythonSignals: false,
            configuredPaths: [],
            modulePaths: new Set(),
            positronDefaultEnvDir: undefined,
            uvPythonInstallDirs: [],
            externallyManagedPaths: new Set(),
        };
        discovered = [];
        resolvable = new Map();
        noKernel = new Set();
        missingPaths = new Set();
        refreshPromise = undefined;

        interpreterService = createTypeMoq<IInterpreterService>();
        interpreterService.setup((s) => s.triggerRefresh(TypeMoq.It.isAny())).returns(() => Promise.resolve());
        interpreterService.setup((s) => s.refreshPromise).returns(() => refreshPromise);
        interpreterService.setup((s) => s.getInterpreters(TypeMoq.It.isAny())).returns(() => discovered);
        interpreterService
            .setup((s) => s.getInterpreterDetails(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((executable: string) => Promise.resolve(resolvable.get(executable)));
        serviceContainer = createTypeMoq<IServiceContainer>();

        sinon
            .stub(commonUtils, 'getInterpreterPathFromDir')
            .callsFake(async (dir: string) => path.join(dir, 'bin', 'python'));
        // The fake paths don't exist on disk; a test marks the ones that should be missing.
        sinon
            .stub(externalDependencies, 'pathExists')
            .callsFake(async (candidate: string) => !missingPaths.has(candidate));
        sinon.stub(ranking, 'buildRankingContext').callsFake(async () => context);
        moduleWait = sinon
            .stub(ranking, 'withDiscoveredFacts')
            .callsFake(async (c: ranking.RankingContext, interpreters: PythonEnvironment[]) => ({
                ...c,
                externallyManagedPaths: new Set(
                    interpreters.filter((i) => i.path === homebrew.path).map((i) => i.path),
                ),
            }));
        includeStub = sinon.stub(interpreterSettings, 'shouldIncludeInterpreter').returns(true);
        sinon.stub(environmentTypeComparer, 'isVersionSupported').returns(true);
        // It checks the disk for the conda env's python, which these fake paths don't have.
        sinon.stub(environmentTypeComparer, 'isProblematicCondaEnvironment').returns(false);
        sinon.stub(runtime, 'checkIpykernel').callsFake(async (interpreter: PythonEnvironment) => ({
            compatible: !noKernel.has(interpreter.path),
            bundle,
        }));
        createStub = sinon
            .stub(runtime, 'createPythonRuntimeMetadata')
            .callsFake(
                async (interpreter, _sc, startupBehavior) =>
                    ({ runtimePath: interpreter.path, startupBehavior } as unknown as positron.LanguageRuntimeMetadata),
            );
    });

    teardown(() => {
        sinon.restore();
    });

    /** The recommendation core gets after discovery (`afterDiscovery`), unless told otherwise. */
    async function recommend(afterDiscovery = true) {
        const metadata = await recommendWorkspaceRuntime(
            serviceContainer.object,
            interpreterService.object,
            workspaceUri,
            afterDiscovery,
        );
        return metadata && { path: metadata.runtimePath, startupBehavior: metadata.startupBehavior };
    }

    test('startupBehaviorFor: the folder decides, except that base and system installs start only when picked', () => {
        const python = { ...context, hasPythonSignals: true };
        const projectOnly = { ...context, rootProjectEnv: { envDir: p('/proj/.venv'), executable: rootVenv.path } };
        assert.deepEqual(
            [
                startupBehaviorFor(ranking.Tier.DefaultInterpreterPath, python),
                startupBehaviorFor(ranking.Tier.ProjectEnv, projectOnly),
                startupBehaviorFor(ranking.Tier.GlobalEnv, context),
                startupBehaviorFor(ranking.Tier.BaseInstall, python),
                startupBehaviorFor(ranking.Tier.ExternallyManaged, python),
            ],
            [B.Immediate, B.Immediate, B.Implicit, B.Explicit, B.Explicit],
        );
    });

    test('starts a root project env immediately, before discovery, without waiting for module discovery', async () => {
        context.rootProjectEnv = { envDir: p('/proj/.venv'), executable: rootVenv.path };
        resolvable.set(rootVenv.path, rootVenv);

        assert.deepEqual(await recommend(false), { path: rootVenv.path, startupBehavior: B.Immediate });
        // createPythonRuntimeMetadata's own module wait covers PET's whole activation scan.
        assert.deepEqual(createStub.firstCall.args[3], { skipModuleWait: true });
    });

    test('before discovery, never scans, lists or waits for discovery (Performance rule 1)', async () => {
        context.hasPythonSignals = true;
        discovered = [homebrew, pyenv];
        refreshPromise = new Promise(() => undefined);

        assert.strictEqual(await recommend(false), undefined);
        interpreterService.verify((s) => s.triggerRefresh(TypeMoq.It.isAny()), TypeMoq.Times.never());
        interpreterService.verify((s) => s.getInterpreters(TypeMoq.It.isAny()), TypeMoq.Times.never());
        sinon.assert.notCalled(moduleWait);
    });

    test('a named path that does not exist is ignored, so it does not defer the answer', async () => {
        const warn = sinon.stub(logging, 'traceWarn');
        const missing = p('/opt/missing/bin/python');
        context.hasPythonSignals = true;
        context.defaultInterpreterPath = missing;
        context.rootProjectEnv = { envDir: p('/proj/.venv'), executable: rootVenv.path };
        resolvable.set(rootVenv.path, rootVenv);
        missingPaths.add(missing);

        assert.deepEqual(await recommend(false), { path: rootVenv.path, startupBehavior: B.Immediate });
        sinon.assert.calledWithMatch(
            warn,
            sinon.match((message: string) => message.includes(missing)),
        );
    });

    test('the pyenv virtualenv named in .python-version is found without a scan, even with no ipykernel', async () => {
        const tool = env(p('/home/u/.pyenv/versions/tool/bin/python'), EnvironmentType.Pyenv, {
            nativeKind: NativePythonEnvironmentKind.PyenvVirtualEnv,
            envName: 'tool',
        });
        context.hasPythonSignals = true;
        context.pythonVersion = 'tool';
        context.pythonVersionDir = p('/home/u/.pyenv/versions/tool');
        resolvable.set(tool.path, tool);
        noKernel.add(tool.path);

        assert.deepEqual(await recommend(false), { path: tool.path, startupBehavior: B.Immediate });
    });

    test('defaultInterpreterPath beats the root project env, from any scope', async () => {
        context.rootProjectEnv = { envDir: p('/proj/.venv'), executable: rootVenv.path };
        context.defaultInterpreterPath = pyenv.path;
        resolvable.set(rootVenv.path, rootVenv);
        resolvable.set(pyenv.path, pyenv);

        assert.deepEqual(await recommend(false), { path: pyenv.path, startupBehavior: B.Immediate });
        // The setting can name a module Python, so its metadata waits for module
        // discovery; the ipykernel bundle computed for the check is reused.
        assert.deepEqual(createStub.firstCall.args[3], { skipModuleWait: false, ipykernelBundle: bundle });
    });

    test('ranks and recommends the path PET resolved, so the runtime matches the discovered one', async () => {
        // The setting names a symlink; PET resolves it to the real interpreter.
        const link = p('/usr/local/bin/python3');
        context.hasPythonSignals = true;
        context.defaultInterpreterPath = link;
        resolvable.set(link, pyenv);

        assert.deepEqual(await recommend(false), { path: pyenv.path, startupBehavior: B.Immediate });
    });

    test('the first pass picks what the full ranking would pick', async () => {
        // Same interpreters reachable both ways: by path (first pass), and by discovery.
        context.hasPythonSignals = true;
        context.rootProjectEnv = { envDir: p('/proj/.venv'), executable: rootVenv.path };
        context.defaultInterpreterPath = pyenv.path;
        resolvable.set(rootVenv.path, rootVenv);
        resolvable.set(pyenv.path, pyenv);
        const fromPaths = await recommend(false);

        resolvable.clear();
        discovered = [rootVenv, homebrew, pyenv];
        const fromDiscovery = await recommend(true);

        assert.deepEqual(fromPaths, fromDiscovery);
    });

    test('a named path that does not resolve is logged, and a lower tier cannot win before discovery', async () => {
        const warn = sinon.stub(logging, 'traceWarn');
        context.hasPythonSignals = true;
        context.rootProjectEnv = { envDir: p('/proj/.venv'), executable: rootVenv.path };
        context.defaultInterpreterPath = pyenv.path;
        // The setting's interpreter doesn't resolve by path (e.g. timed out), but
        // discovery finds it, so it still wins over the root .venv.
        resolvable.set(rootVenv.path, rootVenv);
        discovered = [rootVenv, pyenv];

        assert.strictEqual(await recommend(false), undefined);
        assert.strictEqual((await recommend(true))?.path, pyenv.path);
        sinon.assert.calledWithMatch(
            warn,
            sinon.match((message: string) => message.includes(pyenv.path)),
        );
    });

    test('a launch-shell env with no executable is ignored', async () => {
        sinon.stub(logging, 'traceWarn');
        context.hasPythonSignals = true;
        context.activatedEnvPrefix = p('/home/u/envs/active');
        context.rootProjectEnv = { envDir: p('/proj/.venv'), executable: rootVenv.path };
        resolvable.set(rootVenv.path, rootVenv);
        (commonUtils.getInterpreterPathFromDir as sinon.SinonStub)
            .withArgs(p('/home/u/envs/active'))
            .resolves(undefined);

        // No Python there means discovery can't find one either, so tier 0 is absent.
        assert.deepEqual(await recommend(false), { path: rootVenv.path, startupBehavior: B.Immediate });
    });

    test('after discovery, waits for module discovery and never starts a new scan', async () => {
        context.hasPythonSignals = true;
        discovered = [homebrew, pyenv];

        assert.deepEqual(await recommend(true), { path: pyenv.path, startupBehavior: B.Immediate });
        // triggerRefresh would rerun PET and module discovery once a refresh has finished.
        interpreterService.verify((s) => s.triggerRefresh(TypeMoq.It.isAny()), TypeMoq.Times.never());
        sinon.assert.calledOnce(moduleWait);
    });

    test('after discovery, waits for a refresh that is still running', async () => {
        context.hasPythonSignals = true;
        refreshPromise = new Promise((resolve) =>
            setTimeout(() => {
                discovered = [pyenv];
                resolve();
            }, 10),
        );

        assert.strictEqual((await recommend(true))?.path, pyenv.path);
    });

    test('in a folder with no Python files, the recommendation starts implicitly', async () => {
        discovered = [pyenv];

        assert.deepEqual(await recommend(), { path: pyenv.path, startupBehavior: B.Implicit });
    });

    test('a system Python is recommended but only starts when picked; conda base starts with a Python folder', async () => {
        context.hasPythonSignals = true;
        discovered = [homebrew];
        assert.deepEqual(await recommend(), { path: homebrew.path, startupBehavior: B.Explicit });

        discovered = [condaBase];
        assert.deepEqual(await recommend(), { path: condaBase.path, startupBehavior: B.Immediate });
    });

    test('skips an interpreter without a compatible ipykernel', async () => {
        // conda base outranks pyenv versions, but has no ipykernel here.
        discovered = [condaBase, pyenv];
        noKernel.add(condaBase.path);

        assert.deepEqual(await recommend(), { path: pyenv.path, startupBehavior: B.Implicit });
    });

    test('skips a system Python without a compatible ipykernel', async () => {
        discovered = [homebrew];
        noKernel.add(homebrew.path);

        assert.strictEqual(await recommend(), undefined);
    });

    test('skips an excluded interpreter, and logs why', async () => {
        const info = sinon.stub(logging, 'traceInfo');
        discovered = [homebrew, pyenv];
        includeStub.withArgs(pyenv.path).returns(false);

        assert.strictEqual((await recommend())?.path, homebrew.path);
        sinon.assert.calledWithMatch(
            info,
            sinon.match((message: string) => message.includes(`skipped ${pyenv.path}`)),
        );
    });

    test('in definitionsOnly mode, an unresolved definition defers the answer to after discovery', async () => {
        sinon.stub(logging, 'traceWarn');
        const first = p('/opt/first/bin/python');
        const second = p('/opt/homebrew/bin/python3');
        context.definitionsOnly = true;
        context.definitionPaths = [first, second];
        resolvable.set(second, homebrew);

        assert.strictEqual(await recommend(false), undefined);
        resolvable.set(first, env(first, EnvironmentType.Custom));
        assert.strictEqual((await recommend(true))?.path, first);
    });

    test('in definitionsOnly mode, ranks only definitions and keeps their paths, even after discovery', async () => {
        const definedPath = p('/opt/homebrew/bin/python3');
        context.definitionsOnly = true;
        context.definitionPaths = [definedPath];
        resolvable.set(definedPath, { ...homebrew, path: p('/opt/homebrew/Cellar/python/bin/python3.13') });
        context.hasPythonSignals = true;
        discovered = [pyenv];

        // A Homebrew definition is Configured, so it starts on its own.
        assert.deepEqual(
            [await recommend(false), await recommend(true)],
            [
                { path: definedPath, startupBehavior: B.Immediate },
                { path: definedPath, startupBehavior: B.Immediate },
            ],
        );
    });

    test('recommends nothing when nothing is eligible', async () => {
        discovered = [env(p('/weird/python'), EnvironmentType.Unknown)];

        assert.strictEqual(await recommend(), undefined);
    });
});
