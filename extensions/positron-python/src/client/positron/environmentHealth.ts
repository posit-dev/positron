/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import * as fs from '../common/platform/fs-paths';
import {
    NativePythonFinder,
    getNativePythonFinder,
} from '../pythonEnvironments/base/locators/common/nativePythonFinder';
import {
    isVersionSupported,
    isBaseCondaEnvironment,
    isProblematicCondaEnvironment,
    comparePythonVersionDescending,
} from '../interpreter/configuration/environmentTypeComparer';
import { EnvironmentType, PythonEnvironment, virtualEnvTypes } from '../pythonEnvironments/info';
import { VenvCreationProviderId } from '../pythonEnvironments/creation/provider/venvCreationProvider';
import { UV_PROVIDER_ID } from '../pythonEnvironments/creation/provider/uvCreationProvider';
import { IServiceContainer } from '../ioc/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IInterpreterComparer } from '../interpreter/configuration/types';
import { IInstaller, Product, ProductInstallStatus } from '../common/types';
import { IPythonExecutionFactory } from '../common/process/types';
import { IPYKERNEL_VERSION, MINIMUM_PYTHON_VERSION, MAXIMUM_PYTHON_VERSION_EXCLUSIVE } from '../common/constants';
import { Architecture } from '../common/utils/platform';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';
import { traceInfo } from '../logging';
import { getIpykernelBundle } from './ipykernel';
import { isUvInstalled } from '../pythonEnvironments/common/environmentManagers/uv';

// Human-readable inclusive supported range (e.g. "3.9-3.14") for user-facing messages, derived from
// the version bounds so it stays in sync when they change. The exclusive maximum is set at a minor
// boundary (e.g. 3.15.0), so the last supported minor is one below it.
const SUPPORTED_PYTHON_VERSION_RANGE = `${MINIMUM_PYTHON_VERSION.major}.${MINIMUM_PYTHON_VERSION.minor}-${
    MAXIMUM_PYTHON_VERSION_EXCLUSIVE.major
}.${MAXIMUM_PYTHON_VERSION_EXCLUSIVE.minor - 1}`;

export type HealthItemStatus = 'pass' | 'warn' | 'fail' | 'skipped';

/** The four checks, in dependency order. */
export type HealthItemId = 'discovery' | 'pythonInstalled' | 'environmentReady' | 'dedicatedEnvironment';

export interface HealthItemFix {
    /** Extension OR core command id. */
    commandId: string;
    /** Fully computed at check time; plain JSON only (no vscode types). */
    args?: unknown[];
    /** Localized button label. */
    label: string;
}

export interface HealthItem {
    /** Stable machine id, e.g. 'environmentReady'. */
    id: HealthItemId;
    status: HealthItemStatus;
    /** Localized one-liner. */
    summary: string;
    /** Localized, personalized (actual paths/versions). */
    detail?: string;
    fix?: HealthItemFix;
    /** Reserved for future docs deep links. */
    learnMoreUrl?: string;
}

export interface EnvironmentHealthResult {
    /** True when no item has status 'fail' (warn and skipped do not affect it). */
    ok: boolean;
    /** In dependency order. */
    items: HealthItem[];
    /** Interpreter evaluated by items 3-4. */
    interpreterPath?: string;
}

export function probeDiscovery(finder: Pick<NativePythonFinder, 'lastDiscoveryError'>): HealthItem {
    const summary = vscode.l10n.t('Positron can discover Python environments');
    if (finder.lastDiscoveryError) {
        return {
            id: 'discovery',
            status: 'fail',
            summary,
            detail: vscode.l10n.t('Python environment discovery could not start: {0}', finder.lastDiscoveryError),
            fix: {
                commandId: 'positron.startupDiagnostics.show',
                label: vscode.l10n.t('Show Runtime Startup Diagnostics'),
            },
        };
    }
    return { id: 'discovery', status: 'pass', summary };
}

export const DISCOVERY_WAIT_MS = 10_000;

/** Resolves `true` if `refreshPromise` settles (resolve OR reject) within `waitMs`, else `false`. */
async function discoveryFinishedWithin(refreshPromise: Promise<void>, waitMs: number): Promise<boolean> {
    let finished = false;
    const settled = refreshPromise.then(
        () => {
            finished = true;
        },
        () => {
            finished = true;
        },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
    });
    try {
        await Promise.race([settled, timeout]);
    } finally {
        clearTimeout(timer);
    }
    return finished;
}

export async function probePythonInstalled(deps: {
    getInterpreters: () => PythonEnvironment[];
    refreshPromise: Promise<void> | undefined;
    lastDiscoveryError: () => string | undefined;
    allowUvPythonInstall: boolean;
    waitMs: number;
}): Promise<HealthItem> {
    const summary = vscode.l10n.t('A supported Python is installed');
    const hasSupported = () => deps.getInterpreters().some((i) => isVersionSupported(i.version));

    if (hasSupported()) {
        return { id: 'pythonInstalled', status: 'pass', summary };
    }

    // No supported interpreter is known yet. If a discovery pass is in flight, join it
    // (bounded); never trigger a new pass. `refreshPromise === undefined` post-activation
    // means discovery already finished.
    let finished = deps.refreshPromise === undefined;
    if (deps.refreshPromise) {
        finished = await discoveryFinishedWithin(deps.refreshPromise, deps.waitMs);
        if (hasSupported()) {
            return { id: 'pythonInstalled', status: 'pass', summary };
        }
    }

    if (!finished) {
        return {
            id: 'pythonInstalled',
            status: 'fail',
            summary,
            detail: vscode.l10n.t(
                'Python discovery had not finished. Re-run the check; it will likely resolve once discovery completes.',
            ),
        };
    }

    // The discovery probe (item 1) samples lastDiscoveryError once, before this bounded wait.
    // A locator failure that only surfaces during the wait (e.g. the initial refresh rejecting)
    // is set on the finder afterwards, so re-check it here: no supported Python plus a discovery
    // error means the locator is broken, not that Python is missing. Point at diagnostics rather
    // than offer an install-Python fix that would not resolve a broken locator.
    const discoveryError = deps.lastDiscoveryError();
    if (discoveryError) {
        return {
            id: 'pythonInstalled',
            status: 'fail',
            summary,
            detail: vscode.l10n.t(
                'A supported Python could not be confirmed because environment discovery failed: {0}',
                discoveryError,
            ),
            fix: {
                commandId: 'positron.startupDiagnostics.show',
                label: vscode.l10n.t('Show Runtime Startup Diagnostics'),
            },
        };
    }

    if (!deps.allowUvPythonInstall) {
        return {
            id: 'pythonInstalled',
            status: 'fail',
            summary,
            detail: vscode.l10n.t(
                'No supported Python ({0}) was found, and automatic installation is disabled by the python.allowUvPythonInstall setting. Ask your administrator to provision a supported Python.',
                SUPPORTED_PYTHON_VERSION_RANGE,
            ),
        };
    }

    return {
        id: 'pythonInstalled',
        status: 'fail',
        summary,
        detail: vscode.l10n.t('No supported Python ({0}) was found on this machine.', SUPPORTED_PYTHON_VERSION_RANGE),
        fix: {
            commandId: 'python.installPythonViaUv',
            label: vscode.l10n.t('Install Python'),
        },
    };
}

export async function resolveWouldBeUsedInterpreter(deps: {
    workspaceUri: vscode.Uri | undefined;
    getActiveInterpreter: (resource?: vscode.Uri) => Promise<PythonEnvironment | undefined>;
    getInterpreters: () => PythonEnvironment[];
    getRecommended: (
        interpreters: PythonEnvironment[],
        resource: vscode.Uri | undefined,
    ) => PythonEnvironment | undefined;
}): Promise<PythonEnvironment | undefined> {
    const active = await deps.getActiveInterpreter(deps.workspaceUri);
    if (active) {
        return active;
    }
    return deps.getRecommended(deps.getInterpreters(), deps.workspaceUri);
}

/**
 * A "dedicated" environment is a workspace-local or named virtual environment. A global/system
 * install or conda `base` is NOT dedicated. Externally-managed standalone installs (PEP 668),
 * including uv-managed base Pythons, are classified as global (see the native locator) and are
 * excluded here on that basis.
 */
export function isDedicatedEnvironment(env: PythonEnvironment): boolean {
    if (env.envType === EnvironmentType.Global || env.envType === EnvironmentType.System) {
        return false;
    }
    if (isBaseCondaEnvironment(env)) {
        return false;
    }
    return virtualEnvTypes.includes(env.envType);
}

// Env types safe to seed a new venv from: standalone global/system Pythons. Excludes virtual
// envs, Unknown (unclassified - could be an undetected venv), Module (Linux environment-module
// Pythons that must launch with the module loaded, not from the raw executable), MicrosoftStore
// (venv-creation quirks), and ActiveState (managed runtime). New env types default to excluded.
const supportedBaseTypes = [
    EnvironmentType.Global,
    EnvironmentType.System,
    EnvironmentType.Pyenv,
    EnvironmentType.Custom,
];

export function bestSupportedGlobalPython(interpreters: PythonEnvironment[]): PythonEnvironment | undefined {
    const globals = interpreters.filter((i) => isVersionSupported(i.version) && supportedBaseTypes.includes(i.envType));
    // Full-version comparator: orders by major/minor/patch and sorts unknown-version
    // interpreters last, so an unparsed-version global is only ever chosen as a last resort.
    globals.sort((a, b) => comparePythonVersionDescending(a.version, b.version));
    return globals[0];
}

export function buildCreateEnvFix(deps: {
    workspaceUri: vscode.Uri;
    uvInstalled: boolean;
    allowUvPythonInstall: boolean;
    baseInterpreterPath: string | undefined;
}): HealthItemFix | undefined {
    // The uv auto-version path lets uv select and download a uv-managed Python as part of
    // environment creation. When python.allowUvPythonInstall is off, skip it (mirroring the
    // install-Python fixes elsewhere in this file) and seed a venv from an existing supported
    // base interpreter instead, or omit the fix when there is none.
    if (deps.uvInstalled && deps.allowUvPythonInstall) {
        return {
            commandId: 'python.createEnvironmentAndRegister',
            args: [
                { providerId: UV_PROVIDER_ID, workspaceFolder: deps.workspaceUri.toString(), uvPythonVersion: 'auto' },
            ],
            label: vscode.l10n.t('Create Python Environment'),
        };
    }
    if (!deps.baseInterpreterPath) {
        // No usable uv path and no supported base interpreter to seed a venv. The command would
        // reject with "Missing required options", so offer no create-env fix and let the caller
        // fall back.
        return undefined;
    }
    return {
        commandId: 'python.createEnvironmentAndRegister',
        args: [
            {
                providerId: VenvCreationProviderId,
                workspaceFolder: deps.workspaceUri.toString(),
                interpreterPath: deps.baseInterpreterPath,
            },
        ],
        label: vscode.l10n.t('Create Python Environment'),
    };
}

export function buildNewFolderFix(): HealthItemFix {
    return {
        commandId: 'positron.workbench.action.newFolderFromTemplate',
        label: vscode.l10n.t('New Folder from Template'),
    };
}

export function probeDedicatedEnvironment(deps: {
    workspaceOpen: boolean;
    interpreterDedicated: boolean;
    anyDedicatedDiscovered: boolean;
    createEnvFix: HealthItemFix;
    newFolderFix: HealthItemFix;
}): HealthItem {
    const id = 'dedicatedEnvironment';
    const summary = vscode.l10n.t('A dedicated Python environment is available');

    if (deps.workspaceOpen) {
        if (deps.interpreterDedicated) {
            return { id, status: 'pass', summary };
        }
        return {
            id,
            status: 'fail',
            summary,
            detail: vscode.l10n.t(
                'This workspace would use a global, system, or base environment. Create a dedicated environment to isolate its packages.',
            ),
            fix: deps.createEnvFix,
        };
    }

    if (deps.anyDedicatedDiscovered) {
        return {
            id,
            status: 'warn',
            summary,
            detail: vscode.l10n.t(
                'A dedicated environment exists but no folder is open. Open a folder (or create one) to use it; full green means an open folder using a dedicated environment.',
            ),
            fix: deps.newFolderFix,
        };
    }

    return {
        id,
        status: 'fail',
        summary,
        detail: vscode.l10n.t(
            'No dedicated Python environment was found and no folder is open. Create a folder with a dedicated environment to get started.',
        ),
        fix: deps.newFolderFix,
    };
}

export function probeEnvironmentReady(deps: {
    resolvesAndRuns: boolean;
    versionSupported: boolean;
    kernelReady: boolean;
    isRosetta: boolean;
    recreateFix: HealthItemFix;
    installIpykernelFix: HealthItemFix;
    // Omitted when python.allowUvPythonInstall is off; the Rosetta warn then has no fix button.
    installNativePythonFix?: HealthItemFix;
}): HealthItem {
    const id = 'environmentReady';
    const summary = vscode.l10n.t('The environment is ready to use with Positron');

    if (!deps.resolvesAndRuns) {
        return {
            id,
            status: 'fail',
            summary,
            detail: vscode.l10n.t(
                "This environment's interpreter could not be run (it may be stale or missing). Recreating it will not carry over installed packages.",
            ),
            fix: deps.recreateFix,
        };
    }
    if (!deps.versionSupported) {
        return {
            id,
            status: 'fail',
            summary,
            detail: vscode.l10n.t(
                "This environment's Python version is not supported (needs {0}).",
                SUPPORTED_PYTHON_VERSION_RANGE,
            ),
            fix: deps.recreateFix,
        };
    }
    if (!deps.kernelReady) {
        return {
            id,
            status: 'fail',
            summary,
            detail: vscode.l10n.t('The Jupyter kernel (ipykernel) is not usable for this environment.'),
            fix: deps.installIpykernelFix,
        };
    }
    if (deps.isRosetta) {
        return {
            id,
            status: 'warn',
            summary,
            detail: vscode.l10n.t(
                'This x64 Python runs under Rosetta on Apple silicon. Install a native (arm64) Python and recreate the environment on it for best performance.',
            ),
            fix: deps.installNativePythonFix,
        };
    }
    return { id, status: 'pass', summary };
}

interface ItemProducers {
    discovery: () => HealthItem;
    pythonInstalled: () => Promise<HealthItem>;
    ready: () => Promise<HealthItem>;
    dedicated: () => Promise<HealthItem>;
}

function skipped(id: HealthItemId): HealthItem {
    return { id, status: 'skipped', summary: id };
}

async function runItem(id: HealthItemId, produce: () => HealthItem | Promise<HealthItem>): Promise<HealthItem> {
    try {
        return await produce();
    } catch (ex) {
        return {
            id,
            status: 'fail',
            summary: id,
            detail: vscode.l10n.t('Health check failed: {0}', ex instanceof Error ? ex.message : String(ex)),
        };
    }
}

export async function assembleItems(producers: ItemProducers): Promise<EnvironmentHealthResult> {
    const items: HealthItem[] = [];
    const discovery = await runItem('discovery', producers.discovery);
    items.push(discovery);
    if (discovery.status === 'fail') {
        items.push(skipped('pythonInstalled'), skipped('environmentReady'), skipped('dedicatedEnvironment'));
        return finalize(items);
    }

    const pythonInstalled = await runItem('pythonInstalled', producers.pythonInstalled);
    items.push(pythonInstalled);
    if (pythonInstalled.status === 'fail') {
        items.push(skipped('environmentReady'), skipped('dedicatedEnvironment'));
        return finalize(items);
    }

    // environmentReady precedes dedicatedEnvironment because the dedication verdict is derived
    // from the interpreter's envType, which is only trustworthy when the interpreter actually
    // resolves. An interpreter that cannot be run (e.g. a deleted venv) reports a degraded
    // envType and would be misclassified as non-dedicated, so skip dedicatedEnvironment on a
    // readiness failure and let the recreate fix stand alone rather than emit a misleading
    // "use a dedicated environment" verdict alongside it.
    const ready = await runItem('environmentReady', producers.ready);
    items.push(ready);
    if (ready.status === 'fail') {
        items.push(skipped('dedicatedEnvironment'));
        return finalize(items);
    }

    items.push(await runItem('dedicatedEnvironment', producers.dedicated));
    return finalize(items);
}

// The orchestrator sets `interpreterPath` on the returned result once its memoized
// interpreter snapshot has resolved (see getEnvironmentHealth); assembleItems stays
// pure over the item producers.
function finalize(items: HealthItem[]): EnvironmentHealthResult {
    return { ok: !items.some((i) => i.status === 'fail'), items };
}

export async function getEnvironmentHealth(
    serviceContainer: IServiceContainer,
    args?: { workspaceFolder?: string },
): Promise<EnvironmentHealthResult> {
    const interpreterService = serviceContainer.get<IInterpreterService>(IInterpreterService);
    const comparer = serviceContainer.get<IInterpreterComparer>(IInterpreterComparer);
    const workspaceUri = resolveWorkspaceUri(args?.workspaceFolder);
    const uvInstalled = await isUvInstalled();
    const allowUvPythonInstall = getConfiguration('python').get<boolean>('allowUvPythonInstall') ?? true;

    // Resolve the interpreter snapshot lazily and memoize it. Item 2 (pythonInstalled)
    // waits out any in-flight discovery, so items 3-4 must read the interpreter list
    // AFTER that wait. Resolving it eagerly here would hand them a pre-wait (possibly
    // empty) snapshot, so item 2 could pass (it found Python during its wait) while
    // environmentReady fails with "No interpreter to evaluate". The producers run in order
    // (environmentReady before dedicatedEnvironment), so environmentReady populates the
    // snapshot post-wait and dedicatedEnvironment -- plus the reported interpreterPath --
    // reuse it.
    let snapshot: { interp: PythonEnvironment | undefined; interpreters: PythonEnvironment[] } | undefined;
    const resolveSnapshot = async () => {
        if (!snapshot) {
            const interpreters = interpreterService.getInterpreters(workspaceUri);
            const interp = await resolveWouldBeUsedInterpreter({
                workspaceUri,
                getActiveInterpreter: (r) => interpreterService.getActiveInterpreter(r),
                getInterpreters: () => interpreters,
                getRecommended: (list, resource) => comparer.getRecommended(list, resource),
            });
            snapshot = { interp, interpreters };
        }
        return snapshot;
    };

    const result = await assembleItems({
        discovery: () => probeDiscovery(getNativePythonFinder()),
        pythonInstalled: () =>
            probePythonInstalled({
                getInterpreters: () => interpreterService.getInterpreters(workspaceUri),
                refreshPromise: interpreterService.getRefreshPromise(),
                lastDiscoveryError: () => getNativePythonFinder().lastDiscoveryError,
                allowUvPythonInstall,
                waitMs: DISCOVERY_WAIT_MS,
            }),
        ready: async () =>
            evaluateReady(serviceContainer, {
                workspaceUri,
                uvInstalled,
                allowUvPythonInstall,
                ...(await resolveSnapshot()),
            }),
        dedicated: async () =>
            evaluateDedicated({ workspaceUri, uvInstalled, allowUvPythonInstall, ...(await resolveSnapshot()) }),
    });
    // Read the memoized snapshot directly rather than calling resolveSnapshot() again.
    // When discovery or pythonInstalled failed, the cascade skipped environmentReady before it
    // could resolve the snapshot, so it stays undefined and interpreterPath is omitted. (A
    // readiness failure still resolves the snapshot, so the evaluated interpreter is reported
    // even when dedicatedEnvironment is skipped.) Re-invoking resolveSnapshot() here would run
    // getActiveInterpreter outside runItem, where a rejection escapes and breaks the "command
    // never rejects" contract.
    result.interpreterPath = snapshot?.interp?.path;

    traceEnvironmentHealth(result);
    return result;
}

function resolveWorkspaceUri(workspaceFolder: string | undefined): vscode.Uri | undefined {
    if (workspaceFolder) {
        return vscode.Uri.parse(workspaceFolder);
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function evaluateDedicated(ctx: {
    workspaceUri: vscode.Uri | undefined;
    interp: PythonEnvironment | undefined;
    interpreters: PythonEnvironment[];
    uvInstalled: boolean;
    allowUvPythonInstall: boolean;
}): Promise<HealthItem> {
    const createEnvFix =
        (ctx.workspaceUri &&
            buildCreateEnvFix({
                workspaceUri: ctx.workspaceUri,
                uvInstalled: ctx.uvInstalled,
                allowUvPythonInstall: ctx.allowUvPythonInstall,
                baseInterpreterPath: bestSupportedGlobalPython(ctx.interpreters)?.path,
            })) ||
        buildNewFolderFix();
    return probeDedicatedEnvironment({
        workspaceOpen: ctx.workspaceUri !== undefined,
        interpreterDedicated: ctx.interp !== undefined && isDedicatedEnvironment(ctx.interp),
        anyDedicatedDiscovered: ctx.interpreters.some((i) => isDedicatedEnvironment(i)),
        createEnvFix,
        newFolderFix: buildNewFolderFix(),
    });
}

async function evaluateReady(
    serviceContainer: IServiceContainer,
    ctx: {
        workspaceUri: vscode.Uri | undefined;
        interp: PythonEnvironment | undefined;
        interpreters: PythonEnvironment[];
        uvInstalled: boolean;
        allowUvPythonInstall: boolean;
    },
): Promise<HealthItem> {
    if (!ctx.interp) {
        throw new Error('No interpreter to evaluate');
    }
    const interp = ctx.interp;
    const factory = serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
    const installer = serviceContainer.get<IInstaller>(IInstaller);

    const resolvesAndRuns = await interpreterResolvesAndRuns(factory, interp);
    const versionSupported = isVersionSupported(interp.version);

    // getIpykernelBundle spawns the interpreter (always, on arm64) and can throw for a
    // stale/missing interpreter. probeEnvironmentReady short-circuits on !resolvesAndRuns
    // or !versionSupported before it ever reads kernelReady/isRosetta, so only compute the
    // bundle-derived signals once those gates pass. Computing the bundle eagerly would let
    // its throw escape evaluateReady and turn the intended ordered fail (with a recreate
    // fix) into a generic caught item failure with no actionable fix.
    let kernelReady = true;
    let isRosetta = false;
    if (resolvesAndRuns && versionSupported) {
        const bundle = await getIpykernelBundle(interp, serviceContainer, ctx.workspaceUri);
        kernelReady =
            bundle.disabledReason === undefined ||
            (await installer.isProductVersionCompatible(Product.ipykernel, IPYKERNEL_VERSION, interp)) ===
                ProductInstallStatus.Installed;
        isRosetta = os.arch() === 'arm64' && bundle.architecture === Architecture.x64;
    }

    const recreateFix =
        (ctx.workspaceUri &&
            buildCreateEnvFix({
                workspaceUri: ctx.workspaceUri,
                uvInstalled: ctx.uvInstalled,
                allowUvPythonInstall: ctx.allowUvPythonInstall,
                baseInterpreterPath: bestSupportedGlobalPython(ctx.interpreters)?.path,
            })) ||
        buildNewFolderFix();

    return probeEnvironmentReady({
        resolvesAndRuns,
        versionSupported,
        kernelReady,
        isRosetta,
        recreateFix,
        installIpykernelFix: {
            commandId: 'python.installIpykernel',
            args: [interp.path],
            label: vscode.l10n.t('Install ipykernel'),
        },
        // python.installPythonViaUv does not itself honor python.allowUvPythonInstall (only the
        // runtime-picker path does), so omit this fix when the setting is off - otherwise the
        // Rosetta warn's button would install Python via uv against the configured policy.
        installNativePythonFix: ctx.allowUvPythonInstall
            ? { commandId: 'python.installPythonViaUv', label: vscode.l10n.t('Install Native Python') }
            : undefined,
    });
}

async function interpreterResolvesAndRuns(
    factory: IPythonExecutionFactory,
    interp: PythonEnvironment,
): Promise<boolean> {
    if (isProblematicCondaEnvironment(interp)) {
        return false;
    }
    if (!(await fs.pathExists(interp.path))) {
        return false;
    }
    try {
        const execService = await factory.create({ pythonPath: interp.path });
        return (await execService.getInterpreterInformation()) !== undefined;
    } catch {
        return false;
    }
}

function traceEnvironmentHealth(result: EnvironmentHealthResult): void {
    traceInfo('===================== [START] PYTHON ENVIRONMENT HEALTH =====================');
    traceInfo(JSON.stringify(result, null, 2));
    traceInfo('====================== [END] PYTHON ENVIRONMENT HEALTH ======================');
}
