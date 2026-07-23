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
import { Uri } from 'vscode';

function envOf(overrides: Partial<PythonEnvironment>): PythonEnvironment {
    return { path: '/py', envType: EnvironmentType.Venv, ...overrides } as PythonEnvironment;
}

suite('Python Environment Health - shared helpers', () => {
    test('classifies dedicated vs non-dedicated environments', () => {
        assert.isTrue(isDedicatedEnvironment(envOf({ envType: EnvironmentType.Venv })));
        assert.isTrue(isDedicatedEnvironment(envOf({ envType: EnvironmentType.Conda, envName: 'myenv' })));
        assert.isFalse(isDedicatedEnvironment(envOf({ envType: EnvironmentType.Conda, envName: 'base' })));
        assert.isFalse(isDedicatedEnvironment(envOf({ envType: EnvironmentType.Global })));
        assert.isFalse(isDedicatedEnvironment(envOf({ envType: EnvironmentType.System })));
        // A uv venv keeps EnvironmentType.Uv and is dedicated; a uv-managed standalone install is
        // classified as Global by the native locator, so it lands on the isFalse case above.
        assert.isTrue(isDedicatedEnvironment(envOf({ envType: EnvironmentType.Uv })));
    });

    test('picks the highest-version safe base Python and ignores unsafe types', () => {
        const v = (minor: number) => ({ major: 3, minor, patch: 0, raw: `3.${minor}.0`, build: [], prerelease: [] });
        const older = envOf({ path: '/g1', envType: EnvironmentType.Global, version: v(10) });
        const newer = envOf({ path: '/g2', envType: EnvironmentType.System, version: v(12) });
        const custom = envOf({ path: '/c', envType: EnvironmentType.Custom, version: v(11) });
        const venv = envOf({ path: '/v', envType: EnvironmentType.Venv, version: v(13) });
        assert.strictEqual(bestSupportedGlobalPython([older, newer, custom, venv])?.path, '/g2');

        // Custom is a safe base: when it is the only candidate it is picked.
        assert.strictEqual(bestSupportedGlobalPython([custom, venv])?.path, '/c');

        // Same minor, different patch: the full-version comparator picks the higher patch
        // regardless of input order (the old minor-only sort left this order-dependent).
        const p = (minor: number, patch: number) => ({
            major: 3,
            minor,
            patch,
            raw: `3.${minor}.${patch}`,
            build: [],
            prerelease: [],
        });
        const lowPatch = envOf({ path: '/lo', envType: EnvironmentType.Global, version: p(12, 1) });
        const highPatch = envOf({ path: '/hi', envType: EnvironmentType.Global, version: p(12, 9) });
        assert.strictEqual(bestSupportedGlobalPython([lowPatch, highPatch])?.path, '/hi');

        // Unknown and Module are non-virtual but unsafe bases, so they are never picked.
        const unknown = envOf({ path: '/u', envType: EnvironmentType.Unknown, version: v(12) });
        const module = envOf({ path: '/m', envType: EnvironmentType.Module, version: v(12) });
        assert.isUndefined(bestSupportedGlobalPython([unknown, module]));
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

suite('Python Environment Health - dedicatedEnvironment (item 3)', () => {
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

suite('Python Environment Health - environmentReady (item 4)', () => {
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
            dedicated: async () => pass('dedicatedEnvironment'),
            ready: async () => pass('environmentReady'),
        });
        assert.deepStrictEqual(
            result.items.map((i) => [i.id, i.status]),
            [
                ['discovery', 'fail'],
                ['pythonInstalled', 'skipped'],
                ['dedicatedEnvironment', 'skipped'],
                ['environmentReady', 'skipped'],
            ],
        );
        assert.isFalse(result.ok);
    });

    test('failed pythonInstalled skips items 3-4', async () => {
        const result = await assembleItems({
            discovery: () => pass('discovery'),
            pythonInstalled: async () => fail('pythonInstalled'),
            dedicated: async () => pass('dedicatedEnvironment'),
            ready: async () => pass('environmentReady'),
        });
        assert.deepStrictEqual(
            result.items.map((i) => [i.id, i.status]),
            [
                ['discovery', 'pass'],
                ['pythonInstalled', 'fail'],
                ['dedicatedEnvironment', 'skipped'],
                ['environmentReady', 'skipped'],
            ],
        );
    });

    test('item 4 runs even when item 3 warns; warn does not affect ok', async () => {
        const warn = (id: HealthItemId): HealthItem => ({ id, status: 'warn', summary: id });
        const result = await assembleItems({
            discovery: () => pass('discovery'),
            pythonInstalled: async () => pass('pythonInstalled'),
            dedicated: async () => warn('dedicatedEnvironment'),
            ready: async () => pass('environmentReady'),
        });
        assert.strictEqual(result.items[3].status, 'pass');
        assert.isTrue(result.ok);
    });

    test('a probe that throws becomes a fail, not a rejection', async () => {
        const result = await assembleItems({
            discovery: () => pass('discovery'),
            pythonInstalled: async () => {
                throw new Error('boom');
            },
            dedicated: async () => pass('dedicatedEnvironment'),
            ready: async () => pass('environmentReady'),
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
