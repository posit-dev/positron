/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import * as fs from '../common/platform/fs-paths';
import { getNativePythonFinder } from '../pythonEnvironments/base/locators/common/nativePythonFinder';
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
import { getIpykernelBundle } from './ipykernel';
import { isUvInstalled } from '../pythonEnvironments/common/environmentManagers/uv';
import { noop } from '../common/utils/misc';

// Human-readable inclusive supported range for user-facing messages, derived from
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

/** Row titles for one check, one per status. `warn` is only set for checks that can warn. */
interface ItemSummaries {
    pass: string;
    fail: string;
    warn?: string;
    skipped: string;
}

/**
 * The row title for a check, matching its status: what passed, what is wrong, or (for a skipped
 * item) just the check's name. The detail line under a warn or fail row says why and what to do.
 * Callers that never run the probe (a skipped item, a probe that threw) still need the text, so it
 * lives here rather than inside each probe.
 */
export function itemSummary(id: HealthItemId, status: HealthItemStatus): string {
    // Record<HealthItemId, ...> requires an entry per id, so adding a check without summaries is a
    // compile error. Built per call because vscode.l10n.t needs the activated l10n bundle.
    const summaries: Record<HealthItemId, ItemSummaries> = {
        discovery: {
            pass: vscode.l10n.t('Python environment discovery is working'),
            fail: vscode.l10n.t('Python environment discovery is not working'),
            skipped: vscode.l10n.t('Python environment discovery'),
        },
        pythonInstalled: {
            pass: vscode.l10n.t('A supported Python is available'),
            fail: vscode.l10n.t('A supported Python is not available'),
            skipped: vscode.l10n.t('Supported Python version'),
        },
        environmentReady: {
            pass: vscode.l10n.t('The Python environment is ready to use with Positron'),
            fail: vscode.l10n.t('The Python environment is not ready to use with Positron'),
            warn: vscode.l10n.t('The Python environment may run slowly'),
            skipped: vscode.l10n.t('Python environment compatibility'),
        },
        dedicatedEnvironment: {
            pass: vscode.l10n.t('This folder uses a project environment'),
            fail: vscode.l10n.t('No project environment is in use'),
            warn: vscode.l10n.t('A project environment exists but is not in use'),
            skipped: vscode.l10n.t('Project environment'),
        },
    };
    // A check with no warn text falls back to its name, which reads correctly next to any icon.
    return summaries[id][status] ?? summaries[id].skipped;
}

/**
 * Builds a health item whose title comes from its status, so the two can never disagree. Every
 * item in this file is built through here.
 */
function healthItem(
    id: HealthItemId,
    status: HealthItemStatus,
    rest?: Omit<HealthItem, 'id' | 'status' | 'summary'>,
): HealthItem {
    return { id, status, summary: itemSummary(id, status), ...rest };
}

/**
 * Where the developer-facing text behind a failed check goes. The report shows a generic sentence,
 * so this is the only place the real message survives.
 */
export type LogError = (message: string, error?: unknown) => void;

// Keep in sync with positron-r's environmentHealth.ts.
function diagnosticsFix(): HealthItemFix {
    return {
        commandId: 'positron.startupDiagnostics.show',
        label: vscode.l10n.t('Show Runtime Startup Diagnostics'),
    };
}

/**
 * Reduces the locator's recorded error to the flag the probes take, logging the message on the way.
 * The probes never receive the message, so this is the only chance to record it.
 */
export function readDiscoveryFailure(
    lastDiscoveryError: string | undefined,
    context: string,
    logError: LogError,
): boolean {
    if (lastDiscoveryError) {
        logError(`${context}: ${lastDiscoveryError}`);
    }
    return Boolean(lastDiscoveryError);
}

export function probeDiscovery(deps: { discoveryFailed: boolean }): HealthItem {
    if (deps.discoveryFailed) {
        return healthItem('discovery', 'fail', {
            detail: vscode.l10n.t('Python environment discovery could not start.'),
            fix: diagnosticsFix(),
        });
    }
    return healthItem('discovery', 'pass');
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
    discoveryFailed: () => boolean;
    allowUvPythonInstall: boolean;
    waitMs: number;
}): Promise<HealthItem> {
    const hasSupported = () => deps.getInterpreters().some((i) => isVersionSupported(i.version));

    if (hasSupported()) {
        return healthItem('pythonInstalled', 'pass');
    }

    // No supported interpreter is known yet. If a discovery pass is in flight, join it
    // (bounded); never trigger a new pass. `refreshPromise === undefined` post-activation
    // means discovery already finished.
    let finished = deps.refreshPromise === undefined;
    if (deps.refreshPromise) {
        finished = await discoveryFinishedWithin(deps.refreshPromise, deps.waitMs);
        if (hasSupported()) {
            return healthItem('pythonInstalled', 'pass');
        }
    }

    if (!finished) {
        return healthItem('pythonInstalled', 'fail', {
            detail: vscode.l10n.t('Positron is still searching for Python environments. Run the checks again.'),
        });
    }

    // The discovery probe (item 1) samples the locator once, before this bounded wait. A locator
    // failure that only surfaces during the wait (e.g. the initial refresh rejecting) is recorded
    // afterwards, so re-check it here: no supported Python plus a discovery failure means the
    // locator is broken, not that Python is missing. Point at diagnostics rather than offer an
    // install-Python fix that would not resolve a broken locator.
    if (deps.discoveryFailed()) {
        return healthItem('pythonInstalled', 'fail', {
            detail: vscode.l10n.t(
                'Positron cannot check for a supported Python because Python environment discovery failed.',
            ),
            fix: diagnosticsFix(),
        });
    }

    if (!deps.allowUvPythonInstall) {
        return healthItem('pythonInstalled', 'fail', {
            detail: vscode.l10n.t(
                'Positron cannot find a supported Python ({0}) on this machine, and the python.allowUvPythonInstall setting turns off automatic installation. Ask your administrator to install a supported Python.',
                SUPPORTED_PYTHON_VERSION_RANGE,
            ),
        });
    }

    return healthItem('pythonInstalled', 'fail', {
        detail: vscode.l10n.t(
            'Positron cannot find a supported Python ({0}) on this machine. Run "Install Python" to install one.',
            SUPPORTED_PYTHON_VERSION_RANGE,
        ),
        fix: {
            commandId: 'python.installPythonViaUv',
            label: vscode.l10n.t('Install Python'),
        },
    });
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

/**
 * The CTA for every no-folder-open outcome. Opening a folder is the one step that unblocks the
 * rest of the check: once a folder is open, the check re-runs against it and surfaces the real
 * next step (create an environment, install ipykernel, and so on). Only offer it when no folder
 * is open - with a folder already open it addresses nothing.
 */
export function buildOpenFolderFix(): HealthItemFix {
    return {
        commandId: 'workbench.action.files.openFolder',
        label: vscode.l10n.t('Open Folder'),
    };
}

export function probeDedicatedEnvironment(deps: {
    workspaceOpen: boolean;
    interpreterDedicated: boolean;
    anyDedicatedDiscovered: boolean;
    createEnvFix?: HealthItemFix;
    openFolderFix: HealthItemFix;
}): HealthItem {
    const id = 'dedicatedEnvironment';

    if (deps.workspaceOpen) {
        if (deps.interpreterDedicated) {
            return healthItem(id, 'pass');
        }
        return healthItem(id, 'fail', {
            detail: vscode.l10n.t(
                'This folder uses a shared Python installation, so packages installed here affect other projects. Create a project environment for this folder.',
            ),
            fix: deps.createEnvFix,
        });
    }

    if (deps.anyDedicatedDiscovered) {
        return healthItem(id, 'warn', {
            detail: vscode.l10n.t(
                'No folder is open. Open a folder, then select an existing environment or create a new one.',
            ),
            fix: deps.openFolderFix,
        });
    }

    return healthItem(id, 'fail', {
        detail: vscode.l10n.t('No folder is open. Open a folder, then create a project environment in that folder.'),
        fix: deps.openFolderFix,
    });
}

export function probeEnvironmentReady(deps: {
    resolvesAndRuns: boolean;
    versionSupported: boolean;
    kernelReady: boolean;
    isRosetta: boolean;
    recreateFix?: HealthItemFix;
    installIpykernelFix: HealthItemFix;
    // Omitted when python.allowUvPythonInstall is off; the Rosetta warn then has no fix button.
    installNativePythonFix?: HealthItemFix;
}): HealthItem {
    const id = 'environmentReady';

    if (!deps.resolvesAndRuns) {
        return healthItem(id, 'fail', {
            detail: vscode.l10n.t(
                'The Python in this environment does not start. The environment may be out of date or deleted. Create a new Python environment to replace this one. Installed packages do not carry over.',
            ),
            fix: deps.recreateFix,
        });
    }
    if (!deps.versionSupported) {
        return healthItem(id, 'fail', {
            detail: vscode.l10n.t(
                'This environment uses an unsupported Python version. Positron supports Python {0}. Create a new environment with a supported Python version.',
                SUPPORTED_PYTHON_VERSION_RANGE,
            ),
            fix: deps.recreateFix,
        });
    }
    if (!deps.kernelReady) {
        return healthItem(id, 'fail', {
            detail: vscode.l10n.t(
                'The ipykernel package in this environment is missing or does not work. Positron needs ipykernel to run Python. Run "Install ipykernel" to fix the problem.',
            ),
            fix: deps.installIpykernelFix,
        });
    }
    if (deps.isRosetta) {
        return healthItem(id, 'warn', {
            detail: vscode.l10n.t(
                'This Python is built for Intel (x64) and runs slower on Apple silicon. Install a native (arm64) Python, then create a new environment that uses the native Python.',
            ),
            fix: deps.installNativePythonFix,
        });
    }
    return healthItem(id, 'pass');
}

interface ItemProducers {
    discovery: () => HealthItem;
    pythonInstalled: () => Promise<HealthItem>;
    ready: () => Promise<HealthItem>;
    dedicated: () => Promise<HealthItem>;
}

function skipped(id: HealthItemId): HealthItem {
    return healthItem(id, 'skipped');
}

async function runItem(
    id: HealthItemId,
    produce: () => HealthItem | Promise<HealthItem>,
    logError: LogError,
): Promise<HealthItem> {
    try {
        return await produce();
    } catch (ex) {
        // No curated action to offer for an unexpected probe failure, so this item carries no fix.
        logError(`Environment health check '${id}' failed`, ex);
        return healthItem(id, 'fail', { detail: vscode.l10n.t('This check could not be completed.') });
    }
}

export async function assembleItems(
    producers: ItemProducers,
    logError: LogError = noop,
): Promise<EnvironmentHealthResult> {
    const items: HealthItem[] = [];
    const discovery = await runItem('discovery', producers.discovery, logError);
    items.push(discovery);
    if (discovery.status === 'fail') {
        items.push(skipped('pythonInstalled'), skipped('environmentReady'), skipped('dedicatedEnvironment'));
        return finalize(items);
    }

    const pythonInstalled = await runItem('pythonInstalled', producers.pythonInstalled, logError);
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
    const ready = await runItem('environmentReady', producers.ready, logError);
    items.push(ready);
    if (ready.status === 'fail') {
        items.push(skipped('dedicatedEnvironment'));
        return finalize(items);
    }

    items.push(await runItem('dedicatedEnvironment', producers.dedicated, logError));
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
    logError: LogError,
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

    const result = await assembleItems(
        {
            discovery: () =>
                probeDiscovery({
                    discoveryFailed: readDiscoveryFailure(
                        getNativePythonFinder().lastDiscoveryError,
                        'Python environment discovery could not start',
                        logError,
                    ),
                }),
            pythonInstalled: () =>
                probePythonInstalled({
                    getInterpreters: () => interpreterService.getInterpreters(workspaceUri),
                    refreshPromise: interpreterService.getRefreshPromise(),
                    // Read per call, not once up front: probePythonInstalled asks again after its
                    // bounded wait, which is when a late locator failure first becomes visible.
                    discoveryFailed: () =>
                        readDiscoveryFailure(
                            getNativePythonFinder().lastDiscoveryError,
                            'Python environment discovery failed during the health check',
                            logError,
                        ),
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
        },
        logError,
    );
    // Read the memoized snapshot directly rather than calling resolveSnapshot() again.
    // When discovery or pythonInstalled failed, the cascade skipped environmentReady before it
    // could resolve the snapshot, so it stays undefined and interpreterPath is omitted. (A
    // readiness failure still resolves the snapshot, so the evaluated interpreter is reported
    // even when dedicatedEnvironment is skipped.) Re-invoking resolveSnapshot() here would run
    // getActiveInterpreter outside runItem, where a rejection escapes and breaks the "command
    // never rejects" contract.
    result.interpreterPath = snapshot?.interp?.path;

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
    const createEnvFix = ctx.workspaceUri
        ? buildCreateEnvFix({
              workspaceUri: ctx.workspaceUri,
              uvInstalled: ctx.uvInstalled,
              allowUvPythonInstall: ctx.allowUvPythonInstall,
              baseInterpreterPath: bestSupportedGlobalPython(ctx.interpreters)?.path,
          })
        : undefined;
    return probeDedicatedEnvironment({
        workspaceOpen: ctx.workspaceUri !== undefined,
        interpreterDedicated: ctx.interp !== undefined && isDedicatedEnvironment(ctx.interp),
        anyDedicatedDiscovered: ctx.interpreters.some((i) => isDedicatedEnvironment(i)),
        createEnvFix,
        openFolderFix: buildOpenFolderFix(),
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

    // With no folder open there is nothing to create an environment in, so the CTA is to open one.
    const recreateFix = ctx.workspaceUri
        ? buildCreateEnvFix({
              workspaceUri: ctx.workspaceUri,
              uvInstalled: ctx.uvInstalled,
              allowUvPythonInstall: ctx.allowUvPythonInstall,
              baseInterpreterPath: bestSupportedGlobalPython(ctx.interpreters)?.path,
          })
        : buildOpenFolderFix();

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
