/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import { assert } from 'chai';
import { probeDiscovery, probePythonInstalled, DISCOVERY_WAIT_MS } from '../../client/positron/environmentHealth';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';

suite('Python Environment Health - discovery (item 1)', () => {
    teardown(() => sinon.restore());

    test('passes when discovery is operational', () => {
        const item = probeDiscovery({ lastDiscoveryError: undefined });
        assert.strictEqual(item.id, 'discovery');
        assert.strictEqual(item.status, 'pass');
        assert.isUndefined(item.fix);
    });

    test('fails with a diagnostics link-out on fatal discovery error', () => {
        const item = probeDiscovery({ lastDiscoveryError: 'spawn ENOENT' });
        assert.strictEqual(item.status, 'fail');
        assert.strictEqual(item.fix?.commandId, 'positron.startupDiagnostics.show');
        assert.isUndefined(item.fix?.args);
        assert.include(item.detail ?? '', 'spawn ENOENT');
    });
});

function env(version: { major: number; minor: number; patch: number } | undefined): PythonEnvironment {
    return { path: '/py', version: version && { ...version, raw: '', build: [], prerelease: [] } } as PythonEnvironment;
}
const supported = env({ major: 3, minor: 12, patch: 0 });
const unsupported = env({ major: 3, minor: 7, patch: 0 });

suite('Python Environment Health - pythonInstalled (item 2)', () => {
    test('passes immediately when a supported interpreter is already known', async () => {
        const item = await probePythonInstalled({
            getInterpreters: () => [unsupported, supported],
            refreshPromise: undefined,
            lastDiscoveryError: () => undefined,
            allowUvPythonInstall: true,
            waitMs: 10,
        });
        assert.strictEqual(item.status, 'pass');
    });

    test('waits for in-flight discovery, then fails cleanly with an install fix', async () => {
        let list: PythonEnvironment[] = [];
        const refreshPromise = new Promise<void>((r) => setTimeout(r, 1));
        const item = await probePythonInstalled({
            getInterpreters: () => list,
            refreshPromise,
            lastDiscoveryError: () => undefined,
            allowUvPythonInstall: true,
            waitMs: 50,
        });
        assert.strictEqual(item.status, 'fail');
        assert.strictEqual(item.fix?.commandId, 'python.installPythonViaUv');
    });

    test('reports a broken locator, not a missing Python, when discovery errors during the wait', async () => {
        // The discovery probe (item 1) already passed because the error had not surfaced yet.
        // The refresh rejects during the bounded wait; the finder records the error afterwards.
        let discoveryError: string | undefined;
        const refreshPromise = new Promise<void>((r) =>
            setTimeout(() => {
                discoveryError = 'Refresh error: spawn ENOENT';
                r();
            }, 1),
        );
        const item = await probePythonInstalled({
            getInterpreters: () => [],
            refreshPromise,
            lastDiscoveryError: () => discoveryError,
            allowUvPythonInstall: true,
            waitMs: 50,
        });
        assert.strictEqual(item.status, 'fail');
        assert.strictEqual(item.fix?.commandId, 'positron.startupDiagnostics.show');
        assert.include(item.detail ?? '', 'spawn ENOENT');
    });

    test('times out with no fix when discovery does not finish in time', async () => {
        const neverResolves = new Promise<void>(() => undefined);
        const item = await probePythonInstalled({
            getInterpreters: () => [],
            refreshPromise: neverResolves,
            lastDiscoveryError: () => undefined,
            allowUvPythonInstall: true,
            waitMs: 10,
        });
        assert.strictEqual(item.status, 'fail');
        assert.isUndefined(item.fix);
    });

    test('omits the fix when python.allowUvPythonInstall is false', async () => {
        const item = await probePythonInstalled({
            getInterpreters: () => [],
            refreshPromise: undefined,
            lastDiscoveryError: () => undefined,
            allowUvPythonInstall: false,
            waitMs: 10,
        });
        assert.strictEqual(item.status, 'fail');
        assert.isUndefined(item.fix);
        assert.isDefined(item.detail);
    });

    test('exposes a ~10s default wait constant', () => {
        assert.strictEqual(DISCOVERY_WAIT_MS, 10_000);
    });
});

import {
    isDedicatedEnvironment,
    bestSupportedGlobalPython,
    resolveWouldBeUsedInterpreter,
    buildCreateEnvFix,
} from '../../client/positron/environmentHealth';
import { EnvironmentType } from '../../client/pythonEnvironments/info';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import {
    moduleMetadataMap,
    setModuleDiscoveryInFlight,
} from '../../client/pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';
import { Uri } from 'vscode';

function envOf(overrides: Partial<PythonEnvironment>): PythonEnvironment {
    return { path: '/py', envType: EnvironmentType.Venv, ...overrides } as PythonEnvironment;
}

const WS = '/work';

suite('Python Environment Health - shared helpers', () => {
    test('classifies dedicated (project/global) vs non-dedicated (base/externally-managed) environments', () => {
        // Project environment: named venv inside the open workspace.
        assert.isTrue(
            isDedicatedEnvironment(envOf({ nativeEnvKind: NativePythonEnvironmentKind.Venv, envPath: `${WS}/.venv` }), [
                WS,
            ]),
        );
        // Global environment: named conda env outside the workspace.
        assert.isTrue(
            isDedicatedEnvironment(
                envOf({
                    nativeEnvKind: NativePythonEnvironmentKind.Conda,
                    envName: 'myenv',
                    envPath: '/home/user/.conda/envs/myenv',
                }),
                [WS],
            ),
        );
        // Externally managed: conda base is never dedicated.
        assert.isFalse(
            isDedicatedEnvironment(envOf({ nativeEnvKind: NativePythonEnvironmentKind.Conda, envName: 'base' }), [WS]),
        );
        // Conda base is still recognized (and non-dedicated) when the raw PET kind is
        // missing, falling back to envType.
        assert.isFalse(isDedicatedEnvironment(envOf({ envType: EnvironmentType.Conda, envName: 'base' }), [WS]));
        // Base interpreter: a plain python.org install is never dedicated.
        assert.isFalse(
            isDedicatedEnvironment(
                envOf({ nativeEnvKind: NativePythonEnvironmentKind.MacPythonOrg, path: '/mac-base' }),
                [WS],
            ),
        );
        // A uv venv (not a uv-managed base install) is a named environment and dedicated.
        assert.isTrue(
            isDedicatedEnvironment(envOf({ nativeEnvKind: NativePythonEnvironmentKind.Uv, envPath: `${WS}/.venv` }), [
                WS,
            ]),
        );
        // A uv-managed base install lives under .../uv/python/... and is externally managed, not
        // dedicated.
        assert.isFalse(
            isDedicatedEnvironment(
                envOf({
                    nativeEnvKind: NativePythonEnvironmentKind.Uv,
                    path: '/home/user/.local/share/uv/python/cpython-3.12/bin/python3',
                }),
                [WS],
            ),
        );
    });

    test('picks the base/externally-managed seed with the lowest sort key, then highest version', async () => {
        const v = (minor: number, patch = 0) => ({
            major: 3,
            minor,
            patch,
            raw: `3.${minor}.${patch}`,
            build: [],
            prerelease: [],
        });

        const projectVenv = envOf({
            nativeEnvKind: NativePythonEnvironmentKind.Venv,
            envPath: `${WS}/.venv`,
            version: v(13),
        });
        const globalNamed = envOf({
            nativeEnvKind: NativePythonEnvironmentKind.Conda,
            envName: 'myenv',
            envPath: '/home/user/.conda/envs/myenv',
            version: v(13),
        });
        const pyenvBase = envOf({
            path: '/pyenv-base',
            nativeEnvKind: NativePythonEnvironmentKind.Pyenv,
            version: v(10),
        });
        const macPythonOrgBase = envOf({
            path: '/mac-base',
            nativeEnvKind: NativePythonEnvironmentKind.MacPythonOrg,
            version: v(13),
        });
        const condaBase = envOf({
            path: '/conda-base',
            nativeEnvKind: NativePythonEnvironmentKind.Conda,
            envName: 'base',
            version: v(13),
        });

        // Category 1/2 (project/global named environments) are never picked as seeds, even at
        // the highest version. Within category 3 (base interpreter), Pyenv's tier beats
        // MacPythonOrg's regardless of version.
        assert.strictEqual(
            (await bestSupportedGlobalPython([projectVenv, globalNamed, macPythonOrgBase, condaBase, pyenvBase], [WS]))
                ?.path,
            '/pyenv-base',
        );

        // Same tier (both MacPythonOrg base interpreters): the higher version wins.
        const olderMacPythonOrg = envOf({
            path: '/mac-older',
            nativeEnvKind: NativePythonEnvironmentKind.MacPythonOrg,
            version: v(11),
        });
        assert.strictEqual(
            (await bestSupportedGlobalPython([olderMacPythonOrg, macPythonOrgBase], [WS]))?.path,
            '/mac-base',
        );

        // Category 3 (base interpreter) beats category 4 (externally managed) even at a lower
        // version.
        assert.strictEqual((await bestSupportedGlobalPython([condaBase, macPythonOrgBase], [WS]))?.path, '/mac-base');

        // Only an externally-managed candidate is available: it is still picked.
        assert.strictEqual((await bestSupportedGlobalPython([condaBase], [WS]))?.path, '/conda-base');

        // Unsupported versions are never picked.
        const tooOld = envOf({
            path: '/too-old',
            nativeEnvKind: NativePythonEnvironmentKind.MacPythonOrg,
            version: v(7),
        });
        assert.isUndefined(await bestSupportedGlobalPython([tooOld], [WS]));
    });

    test('excludes env types that are unsafe to shell out to as a venv seed, even when categorization alone would allow them', async () => {
        // Categorization answers "how appropriate for the project", not "is this safe to spawn
        // as a venv-creation seed". Venv creation invokes the interpreter path directly, so
        // Categorization.validVenvSeed excludes these regardless of category:
        // - Module: a Linux environment-module Python that must launch with the module loaded,
        //   not from the raw executable.
        // - ActiveState: a managed runtime, not a safe seed.
        // MicrosoftStore is deliberately a valid seed (see Categorization.validVenvSeed).
        const v = (minor: number) => ({ major: 3, minor, patch: 0, raw: `3.${minor}.0`, build: [], prerelease: [] });

        const moduleEnv = envOf({
            path: '/opt/apps/python/3.11/bin/python',
            envType: EnvironmentType.Module,
            version: v(11),
        });
        assert.isUndefined(await bestSupportedGlobalPython([moduleEnv], [WS]));

        // A module Python that PET also discovered under a native path: envType is not Module,
        // but the path is keyed in moduleMetadataMap (see reconcileModuleEnvsWithNative).
        const reconciledModuleEnv = envOf({
            path: '/opt/apps/python/3.12/bin/python',
            envType: EnvironmentType.Unknown,
            version: v(12),
        });
        moduleMetadataMap.set(reconciledModuleEnv.path, {
            type: 'module',
            environmentName: 'Python-3.12',
            modules: ['python/3.12'],
            startupCommand: 'module load python/3.12',
            version: '3.12.0',
        });
        try {
            assert.isUndefined(await bestSupportedGlobalPython([reconciledModuleEnv], [WS]));
        } finally {
            moduleMetadataMap.delete(reconciledModuleEnv.path);
        }

        const activeStateEnv = envOf({
            path: '/home/user/.activestate/pythons/xyz/bin/python',
            envType: EnvironmentType.ActiveState,
            version: v(11),
        });
        assert.isUndefined(await bestSupportedGlobalPython([activeStateEnv], [WS]));

        // MicrosoftStore stays seedable, and is picked when it is the only candidate.
        const microsoftStoreEnv = envOf({
            path: 'C:\\Program Files\\WindowsApps\\PythonSoftwareFoundation.Python.3.11\\python.exe',
            envType: EnvironmentType.MicrosoftStore,
            nativeEnvKind: NativePythonEnvironmentKind.WindowsStore,
            version: v(11),
        });
        assert.strictEqual((await bestSupportedGlobalPython([microsoftStoreEnv], [WS]))?.path, microsoftStoreEnv.path);

        // A safe base interpreter is still picked when mixed in with unsafe candidates, and a
        // python.org install outranks the Store python within the base tier.
        const macPythonOrg = envOf({
            path: '/mac-base',
            nativeEnvKind: NativePythonEnvironmentKind.MacPythonOrg,
            version: v(11),
        });
        assert.strictEqual(
            (await bestSupportedGlobalPython([moduleEnv, microsoftStoreEnv, activeStateEnv, macPythonOrg], [WS]))?.path,
            '/mac-base',
        );
    });

    test('waits for an in-flight module discovery pass before judging seed eligibility', async () => {
        // Module metadata is keyed onto the native path only when the discovery pass finishes,
        // and the health check can run while a pass is still in flight (item 2 passes without
        // joining the refresh when a supported interpreter is already known). Reading the map
        // before the pass settles would offer this module Python as a venv seed.
        const reconciledModuleEnv = envOf({
            path: '/opt/apps/python/3.12/bin/python',
            envType: EnvironmentType.Unknown,
            version: { major: 3, minor: 12, patch: 0, raw: '3.12.0', build: [], prerelease: [] },
        });
        let landMetadata: () => void = () => undefined;
        const pass = new Promise<void>((resolve) => {
            landMetadata = () => {
                moduleMetadataMap.set(reconciledModuleEnv.path, {
                    type: 'module',
                    environmentName: 'Python-3.12',
                    modules: ['python/3.12'],
                    startupCommand: 'module load python/3.12',
                    version: '3.12.0',
                });
                resolve();
            };
        });
        setModuleDiscoveryInFlight(pass);
        try {
            const seed = bestSupportedGlobalPython([reconciledModuleEnv], [WS]);
            landMetadata();
            assert.isUndefined(await seed);
        } finally {
            moduleMetadataMap.delete(reconciledModuleEnv.path);
            setModuleDiscoveryInFlight(Promise.resolve());
        }
    });

    test('resolves the active interpreter, falling back to the recommendation', async () => {
        const rec = envOf({ path: '/rec' });
        const active = await resolveWouldBeUsedInterpreter({
            workspaceUri: undefined,
            getActiveInterpreter: async () => envOf({ path: '/active' }),
            getInterpreters: () => [rec],
            getRecommended: () => rec,
        });
        assert.strictEqual(active?.path, '/active');

        const fallback = await resolveWouldBeUsedInterpreter({
            workspaceUri: undefined,
            getActiveInterpreter: async () => undefined,
            getInterpreters: () => [rec],
            getRecommended: () => rec,
        });
        assert.strictEqual(fallback?.path, '/rec');
    });

    test('builds a plain-JSON create-env fix branching on uv vs venv', () => {
        const ws = Uri.file('/work');
        // uv does not need a base interpreter to seed the environment.
        const uvFix = buildCreateEnvFix({
            workspaceUri: ws,
            uvInstalled: true,
            allowUvPythonInstall: true,
            baseInterpreterPath: undefined,
        });
        assert.strictEqual(uvFix?.commandId, 'python.createEnvironmentAndRegister');
        assert.deepStrictEqual(uvFix?.args, [
            { providerId: 'ms-python.python:uv', workspaceFolder: ws.toString(), uvPythonVersion: 'auto' },
        ]);

        const venvFix = buildCreateEnvFix({
            workspaceUri: ws,
            uvInstalled: false,
            allowUvPythonInstall: true,
            baseInterpreterPath: '/g/py',
        });
        assert.deepStrictEqual(venvFix?.args, [
            { providerId: 'ms-python.python:venv', workspaceFolder: ws.toString(), interpreterPath: '/g/py' },
        ]);

        // No uv and no supported base interpreter: no runnable create-env fix (caller falls back).
        const noFix = buildCreateEnvFix({
            workspaceUri: ws,
            uvInstalled: false,
            allowUvPythonInstall: true,
            baseInterpreterPath: undefined,
        });
        assert.strictEqual(noFix, undefined);
    });

    test('skips the uv auto-version path when python.allowUvPythonInstall is off', () => {
        const ws = Uri.file('/work');
        // uv is installed, but installs are disallowed: seed a venv from the base interpreter
        // rather than let the uv auto path download a uv-managed Python.
        const seededFix = buildCreateEnvFix({
            workspaceUri: ws,
            uvInstalled: true,
            allowUvPythonInstall: false,
            baseInterpreterPath: '/g/py',
        });
        assert.deepStrictEqual(seededFix?.args, [
            { providerId: 'ms-python.python:venv', workspaceFolder: ws.toString(), interpreterPath: '/g/py' },
        ]);

        // uv installed but disallowed and no base interpreter to seed: no runnable fix.
        const noFix = buildCreateEnvFix({
            workspaceUri: ws,
            uvInstalled: true,
            allowUvPythonInstall: false,
            baseInterpreterPath: undefined,
        });
        assert.strictEqual(noFix, undefined);
    });
});

import { probeDedicatedEnvironment } from '../../client/positron/environmentHealth';

suite('Python Environment Health - dedicatedEnvironment (item 4)', () => {
    const createEnvFix = { commandId: 'python.createEnvironmentAndRegister', label: 'c', args: [{}] };
    const newFolderFix = { commandId: 'positron.workbench.action.newFolderFromTemplate', label: 'n' };

    test('workspace open + dedicated interpreter => pass', () => {
        const item = probeDedicatedEnvironment({
            workspaceOpen: true,
            interpreterDedicated: true,
            anyDedicatedDiscovered: true,
            createEnvFix,
            newFolderFix,
        });
        assert.strictEqual(item.status, 'pass');
        assert.isUndefined(item.fix);
    });

    test('workspace open + non-dedicated interpreter => fail + create-env fix', () => {
        const item = probeDedicatedEnvironment({
            workspaceOpen: true,
            interpreterDedicated: false,
            anyDedicatedDiscovered: true,
            createEnvFix,
            newFolderFix,
        });
        assert.strictEqual(item.status, 'fail');
        assert.strictEqual(item.fix, createEnvFix);
    });

    test('no workspace + a dedicated env exists => warn + New Folder fix', () => {
        const item = probeDedicatedEnvironment({
            workspaceOpen: false,
            interpreterDedicated: false,
            anyDedicatedDiscovered: true,
            createEnvFix,
            newFolderFix,
        });
        assert.strictEqual(item.status, 'warn');
        assert.strictEqual(item.fix, newFolderFix);
    });

    test('no workspace + no dedicated env => fail + New Folder fix', () => {
        const item = probeDedicatedEnvironment({
            workspaceOpen: false,
            interpreterDedicated: false,
            anyDedicatedDiscovered: false,
            createEnvFix,
            newFolderFix,
        });
        assert.strictEqual(item.status, 'fail');
        assert.strictEqual(item.fix, newFolderFix);
    });
});

import { probeEnvironmentReady } from '../../client/positron/environmentHealth';

suite('Python Environment Health - environmentReady (item 3)', () => {
    const recreateFix = { commandId: 'python.createEnvironmentAndRegister', label: 'r', args: [{}] };
    const installIpykernelFix = { commandId: 'python.installIpykernel', label: 'k', args: ['/py'] };
    const installNativePythonFix = { commandId: 'python.installPythonViaUv', label: 'n' };
    const green = {
        resolvesAndRuns: true,
        versionSupported: true,
        kernelReady: true,
        isRosetta: false,
        recreateFix,
        installIpykernelFix,
        installNativePythonFix,
    };

    test('broken env short-circuits before version/kernel/arch', () => {
        const item = probeEnvironmentReady({ ...green, resolvesAndRuns: false });
        assert.strictEqual(item.status, 'fail');
        assert.strictEqual(item.fix, recreateFix);
        assert.include(item.detail ?? '', 'packages');
    });

    test('unsupported version fails with recreate fix', () => {
        const item = probeEnvironmentReady({ ...green, versionSupported: false });
        assert.strictEqual(item.status, 'fail');
        assert.strictEqual(item.fix, recreateFix);
    });

    test('kernel not ready fails with install-ipykernel fix', () => {
        const item = probeEnvironmentReady({ ...green, kernelReady: false });
        assert.strictEqual(item.status, 'fail');
        assert.strictEqual(item.fix, installIpykernelFix);
    });

    test('Rosetta warns only when earlier probes pass', () => {
        const item = probeEnvironmentReady({ ...green, isRosetta: true });
        assert.strictEqual(item.status, 'warn');
        assert.strictEqual(item.fix, installNativePythonFix);
    });

    test('Rosetta warns without a fix when native-Python install is disabled', () => {
        const item = probeEnvironmentReady({ ...green, isRosetta: true, installNativePythonFix: undefined });
        assert.strictEqual(item.status, 'warn');
        assert.isUndefined(item.fix);
    });

    test('all green => pass', () => {
        assert.strictEqual(probeEnvironmentReady(green).status, 'pass');
    });
});

import { assembleItems, HealthItem, HealthItemId } from '../../client/positron/environmentHealth';

suite('Python Environment Health - orchestration', () => {
    const pass = (id: HealthItemId): HealthItem => ({ id, status: 'pass', summary: id });
    const fail = (id: HealthItemId): HealthItem => ({ id, status: 'fail', summary: id });

    test('fatal discovery skips items 2-4', async () => {
        const result = await assembleItems({
            discovery: () => fail('discovery'),
            pythonInstalled: async () => pass('pythonInstalled'),
            ready: async () => pass('environmentReady'),
            dedicated: async () => pass('dedicatedEnvironment'),
        });
        assert.deepStrictEqual(
            result.items.map((i) => [i.id, i.status]),
            [
                ['discovery', 'fail'],
                ['pythonInstalled', 'skipped'],
                ['environmentReady', 'skipped'],
                ['dedicatedEnvironment', 'skipped'],
            ],
        );
        assert.isFalse(result.ok);
    });

    test('failed pythonInstalled skips items 3-4', async () => {
        const result = await assembleItems({
            discovery: () => pass('discovery'),
            pythonInstalled: async () => fail('pythonInstalled'),
            ready: async () => pass('environmentReady'),
            dedicated: async () => pass('dedicatedEnvironment'),
        });
        assert.deepStrictEqual(
            result.items.map((i) => [i.id, i.status]),
            [
                ['discovery', 'pass'],
                ['pythonInstalled', 'fail'],
                ['environmentReady', 'skipped'],
                ['dedicatedEnvironment', 'skipped'],
            ],
        );
    });

    test('failed environmentReady skips dedicatedEnvironment', async () => {
        const result = await assembleItems({
            discovery: () => pass('discovery'),
            pythonInstalled: async () => pass('pythonInstalled'),
            ready: async () => fail('environmentReady'),
            dedicated: async () => pass('dedicatedEnvironment'),
        });
        assert.deepStrictEqual(
            result.items.map((i) => [i.id, i.status]),
            [
                ['discovery', 'pass'],
                ['pythonInstalled', 'pass'],
                ['environmentReady', 'fail'],
                ['dedicatedEnvironment', 'skipped'],
            ],
        );
        assert.isFalse(result.ok);
    });

    test('dedicatedEnvironment runs when environmentReady warns; warn does not affect ok', async () => {
        const warn = (id: HealthItemId): HealthItem => ({ id, status: 'warn', summary: id });
        const result = await assembleItems({
            discovery: () => pass('discovery'),
            pythonInstalled: async () => pass('pythonInstalled'),
            ready: async () => warn('environmentReady'),
            dedicated: async () => pass('dedicatedEnvironment'),
        });
        assert.deepStrictEqual(
            result.items.map((i) => [i.id, i.status]),
            [
                ['discovery', 'pass'],
                ['pythonInstalled', 'pass'],
                ['environmentReady', 'warn'],
                ['dedicatedEnvironment', 'pass'],
            ],
        );
        assert.isTrue(result.ok);
    });

    test('a probe that throws becomes a fail, not a rejection', async () => {
        const result = await assembleItems({
            discovery: () => pass('discovery'),
            pythonInstalled: async () => {
                throw new Error('boom');
            },
            ready: async () => pass('environmentReady'),
            dedicated: async () => pass('dedicatedEnvironment'),
        });
        assert.strictEqual(result.items[1].status, 'fail');
        assert.include(result.items[1].detail ?? '', 'boom');
    });
});

suite('Python Environment Health - contract shape', () => {
    test('create-env fix args are plain JSON values', () => {
        const fix = buildCreateEnvFix({
            workspaceUri: Uri.file('/w'),
            uvInstalled: false,
            allowUvPythonInstall: true,
            baseInterpreterPath: '/g/py',
        });
        // JSON round-trip must be lossless (no Uri/WorkspaceFolder/etc.)
        assert.deepStrictEqual(JSON.parse(JSON.stringify(fix?.args)), fix?.args);
    });
});
