/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Chooses the interpreter Positron recommends for a workspace, and when it starts.
 *
 * - Which: the first interpreter in the ranking (interpreterRanking.ts) that
 *   `skipReason` doesn't skip.
 * - When: `startupBehaviorFor`, from its tier and the folder.
 *
 * Both are functions of the `RankingContext` and the interpreters, so the same folder
 * and settings always give the same answer.
 */

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import {
    isProblematicCondaEnvironment,
    isVersionSupported,
} from '../interpreter/configuration/environmentTypeComparer';
import { IPersistentStateFactory } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { IServiceContainer } from '../ioc/types';
import { traceError, traceInfo, traceWarn } from '../logging';
import { getInterpreterPathFromDir } from '../pythonEnvironments/common/commonUtils';
import { normCasePath, pathExists } from '../pythonEnvironments/common/externalDependencies';
import { EnvironmentType, PythonEnvironment, virtualEnvTypes } from '../pythonEnvironments/info';
import {
    buildRankingContext,
    RankingContext,
    rankInterpreters,
    isWorkspaceEnv,
    Tier,
    tierOf,
    withDiscoveredFacts,
} from './interpreterRanking';
import { getPythonDiscoveryRootSignature } from './discoveryRootSignature';
import { getResolvedFilterSettingPaths, shouldIncludeInterpreter } from './interpreterSettings';
import type { IpykernelBundle } from './ipykernel';
import { checkIpykernel, createPythonRuntimeMetadata } from './runtime';
import { resolveInterpreterOnce } from './util';

/** Whether a ranked interpreter can be recommended. */
type Eligibility =
    | { skip: string }
    | {
          skip: undefined;
          /** The bundle the ipykernel check computed, so metadata needn't start Python again. */
          ipykernelBundle: IpykernelBundle | undefined;
      };

/**
 * Why a ranked interpreter can't be recommended, if it can't. Every eligibility rule
 * lives here, so every skip is logged with its reason. Without a compatible ipykernel
 * an interpreter is skipped, unless it is the project's own env or lives inside the
 * folder, so the user is prompted to install ipykernel there.
 */
async function skipReason(
    serviceContainer: IServiceContainer,
    interpreter: PythonEnvironment,
    tier: Tier,
    context: RankingContext,
    workspaceUri: vscode.Uri | undefined,
): Promise<Eligibility> {
    if (!shouldIncludeInterpreter(interpreter.path)) {
        return { skip: 'excluded by python.interpreters.exclude or override' };
    }
    if (!isVersionSupported(interpreter.version)) {
        return { skip: 'unsupported Python version' };
    }
    if (isProblematicCondaEnvironment(interpreter)) {
        return { skip: 'conda env without Python' };
    }
    // The folder's own envs skip the check, so the user is prompted to install ipykernel there.
    if (tier === Tier.ProjectEnv || isWorkspaceEnv(interpreter, context)) {
        return { skip: undefined, ipykernelBundle: undefined };
    }
    const { compatible, bundle } = await checkIpykernel(interpreter, serviceContainer, workspaceUri);
    return compatible ? { skip: undefined, ipykernelBundle: bundle } : { skip: 'no compatible ipykernel' };
}

/**
 * Whether an interpreter in this tier can be an environment-module Python. A module
 * Python needs its module metadata to start, and waiting for that covers PET's whole
 * activation scan, so only these tiers wait for it.
 *
 * Keep in sync with `canBeModuleEnv`, which answers the same question for a pinned
 * interpreter, which has no tier.
 */
function canBeModulePython(tier: Tier): boolean {
    return ![Tier.ActivatedEnv, Tier.ProjectEnv, Tier.PythonVersionFile, Tier.WorkspaceEnv].includes(tier);
}

/**
 * Whether an interpreter of this environment type can be an environment-module Python.
 * Virtual environments other than conda, and pyenv installs, never are, so their runtimes
 * don't need to wait for module discovery, which on Linux waits for PET's whole interpreter
 * scan. Conda can come from a module, as with `module load anaconda`.
 *
 * Keep in sync with `canBeModulePython`, which answers the same question by tier.
 */
export function canBeModuleEnv(envType: EnvironmentType): boolean {
    if (envType === EnvironmentType.Conda) {
        return true;
    }
    return !virtualEnvTypes.includes(envType) && envType !== EnvironmentType.Pyenv;
}

/**
 * When the recommendation starts. Base and system installs head the picker but start
 * only when picked; anything else starts when the folder opens if it is a Python
 * folder, and otherwise when a Python file is opened or code is run.
 */
export function startupBehaviorFor(tier: Tier, context: RankingContext): positron.LanguageRuntimeStartupBehavior {
    if (tier >= Tier.BaseInstall) {
        return positron.LanguageRuntimeStartupBehavior.Explicit;
    }
    return context.hasPythonSignals || context.rootProjectEnvs.length > 0
        ? positron.LanguageRuntimeStartupBehavior.Immediate
        : positron.LanguageRuntimeStartupBehavior.Implicit;
}

/** The interpreters named by path, and the context to rank them with. */
interface NamedInterpreters {
    resolved: PythonEnvironment[];
    /** Named paths that exist but didn't resolve. Any of them makes the first pass unsafe. */
    unresolved: number;
    context: RankingContext;
}

/**
 * Interpreters named by path in the context (every candidate for tiers 0-3, or every
 * definition in `definitionsOnly` mode), resolved in parallel without a full scan.
 *
 * A named path that doesn't exist is absent: it is logged as a warning and skipped, as
 * if it had never been named, since discovery can't find it either. That covers a stale
 * `defaultInterpreterPath` and a launch-shell env with no Python. A path that exists but
 * doesn't resolve is logged as a warning and counted in `unresolved`.
 *
 * Before discovery each resolve has the usual `RESOLVE_TIMEOUT_MS`, since core waits for
 * this answer before anything else starts; a timeout only defers the answer. After
 * discovery there is no timeout: a resolve that is slow but succeeds must not let a
 * lower tier win, so the answer never depends on timing.
 *
 * In `definitionsOnly` mode the path is kept as written, since Positron matches
 * definitions on the exact path. Otherwise the interpreter keeps the path PET resolved,
 * which is the path discovery registers, so the runtime ID matches the discovered
 * runtime; `defaultInterpreterPath` in the returned context is updated to match.
 */
async function resolveNamedInterpreters(
    interpreterService: IInterpreterService,
    context: RankingContext,
    workspaceUri: vscode.Uri | undefined,
    afterDiscovery: boolean,
): Promise<NamedInterpreters> {
    let named: (string | undefined)[];
    if (context.definitionsOnly) {
        named = context.definitionPaths;
    } else {
        const activatedExecutable = context.activatedEnvPrefix
            ? await getInterpreterPathFromDir(context.activatedEnvPrefix)
            : undefined;
        if (context.activatedEnvPrefix && !activatedExecutable) {
            traceWarn(
                `Interpreter ranking: no Python found in the launch shell's env ${context.activatedEnvPrefix}...ignoring`,
            );
        }
        named = [
            activatedExecutable,
            context.defaultInterpreterPath,
            ...context.rootProjectEnvs.map((projectEnv) => projectEnv.executable),
            // pyenv links each virtualenv into its versions folder, so this covers both
            // a named virtualenv (ProjectEnv) and a named version (PythonVersionFile).
            // A name pyenv doesn't have is not an error: the file may name something else.
            context.pythonVersionDir ? await getInterpreterPathFromDir(context.pythonVersionDir) : undefined,
        ];
    }
    const resolve = async (namedPath: string): Promise<PythonEnvironment | undefined> => {
        if (!afterDiscovery) {
            return resolveInterpreterOnce(interpreterService, namedPath, workspaceUri);
        }
        try {
            return await interpreterService.getInterpreterDetails(namedPath, workspaceUri);
        } catch (err) {
            traceWarn(`Interpreter ranking: error resolving ${namedPath}: ${err}`);
            return undefined;
        }
    };
    // The same path is often named more than once (e.g. defaultInterpreterPath is the root
    // `.venv`); resolve it once.
    const unique = [...new Set(named.filter((namedPath): namedPath is string => !!namedPath))];
    const results = await Promise.all(
        unique.map(async (namedPath) => {
            if (!(await pathExists(namedPath))) {
                traceWarn(
                    `Interpreter ranking: ${namedPath} is named by the settings or the folder but does not exist...ignoring`,
                );
                return 'absent' as const;
            }
            const interpreter = await resolve(namedPath);
            if (!interpreter) {
                traceWarn(
                    `Interpreter ranking: ${namedPath} is named by the settings or the folder but could not be resolved`,
                );
                return 'unresolved' as const;
            }
            return {
                named: namedPath,
                interpreter: context.definitionsOnly ? { ...interpreter, path: namedPath } : interpreter,
            };
        }),
    );
    const found = results.filter(
        (r): r is { named: string; interpreter: PythonEnvironment } => r !== 'absent' && r !== 'unresolved',
    );
    const resolvedDefault = found.find((r) => r.named === context.defaultInterpreterPath)?.interpreter.path;
    return {
        resolved: found.map((r) => r.interpreter),
        unresolved: results.filter((r) => r === 'unresolved').length,
        context: resolvedDefault ? { ...context, defaultInterpreterPath: resolvedDefault } : context,
    };
}

/** A recommended interpreter, its tier, and its runtime metadata. */
interface Recommendation {
    interpreter: PythonEnvironment;
    tier: Tier;
    metadata: positron.LanguageRuntimeMetadata;
}

/** The first ranked interpreter that isn't skipped, or undefined. */
async function firstEligible(
    serviceContainer: IServiceContainer,
    candidates: PythonEnvironment[],
    context: RankingContext,
    workspaceUri: vscode.Uri | undefined,
): Promise<Recommendation | undefined> {
    const ranked = rankInterpreters(candidates, context);
    for (const { interpreter, tier } of ranked) {
        if (tier === undefined) {
            return undefined;
        }
        let eligibility: Eligibility;
        try {
            eligibility = await skipReason(serviceContainer, interpreter, tier, context, workspaceUri);
        } catch (err) {
            traceInfo(
                `Interpreter ranking: skipped ${interpreter.path} (${Tier[tier]}): eligibility check failed: ${err}`,
            );
            continue;
        }
        if (eligibility.skip !== undefined) {
            traceInfo(`Interpreter ranking: skipped ${interpreter.path} (${Tier[tier]}): ${eligibility.skip}`);
            continue;
        }
        const startupBehavior = startupBehaviorFor(tier, context);
        try {
            const metadata = await createPythonRuntimeMetadata(interpreter, serviceContainer, startupBehavior, {
                skipModuleWait: !canBeModulePython(tier),
                ...(eligibility.ipykernelBundle && { ipykernelBundle: eligibility.ipykernelBundle }),
            });
            traceInfo(`Interpreter ranking: recommended ${interpreter.path} (${Tier[tier]}, ${startupBehavior})`);
            return { interpreter, tier, metadata };
        } catch (err) {
            traceError(`Interpreter ranking: could not create the runtime for ${interpreter.path}: ${err}`);
        }
    }
    return undefined;
}

/** Workspace state key for the last answer after discovery. */
const LAST_AFTER_DISCOVERY_KEY = 'positron.interpreterRanking.lastAfterDiscovery';

/** The last answer after discovery, and the inputs it was computed from. */
interface RememberedAnswer {
    inputs: string;
    path: string;
    tier: Tier;
}

/**
 * Everything the answer after discovery depends on: the discovery roots (one stat each,
 * the same signature core uses to decide whether its cache is fresh), the folder scan
 * and the settings in the context, and the interpreter filters. What it doesn't cover,
 * such as ipykernel being installed into an env, isn't noticed until one of these changes.
 */
async function rankingInputs(context: RankingContext): Promise<string> {
    const { modulePaths: _modulePaths, externallyManagedPaths: _externallyManaged, ...settingsAndScan } = context;
    return JSON.stringify({
        roots: await getPythonDiscoveryRootSignature(),
        context: settingsAndScan,
        filters: getResolvedFilterSettingPaths(),
    });
}

function rememberedAnswerState(serviceContainer: IServiceContainer) {
    return serviceContainer
        .get<IPersistentStateFactory>(IPersistentStateFactory)
        .createWorkspacePersistentState<RememberedAnswer | undefined>(LAST_AFTER_DISCOVERY_KEY, undefined);
}

/**
 * The last answer after discovery, if it was computed from the same inputs. It is
 * resolved like a named path, so a slow resolve defers to the ask after discovery.
 */
async function fromRememberedAnswer(
    serviceContainer: IServiceContainer,
    interpreterService: IInterpreterService,
    inputs: string,
    context: RankingContext,
    workspaceUri: vscode.Uri | undefined,
): Promise<positron.LanguageRuntimeMetadata | undefined> {
    const remembered = rememberedAnswerState(serviceContainer).value;
    if (!remembered || remembered.inputs !== inputs) {
        return undefined;
    }
    const interpreter = await resolveInterpreterOnce(interpreterService, remembered.path, workspaceUri);
    if (!interpreter) {
        return undefined;
    }
    const startupBehavior = startupBehaviorFor(remembered.tier, context);
    const metadata = await createPythonRuntimeMetadata(interpreter, serviceContainer, startupBehavior, {
        skipModuleWait: !canBeModulePython(remembered.tier),
    });
    traceInfo(
        `Interpreter ranking: recommended ${interpreter.path} (${Tier[remembered.tier]}, ${startupBehavior}), ` +
            'remembered from the last answer after discovery',
    );
    return metadata;
}

function dedupeByPath(interpreters: PythonEnvironment[]): PythonEnvironment[] {
    const seen = new Set<string>();
    return interpreters.filter((i) => {
        const key = normCasePath(i.path);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * The runtime to recommend for the workspace, or undefined. One ranking, run in at
 * most two passes over growing candidate sets. The answer depends only on the folder,
 * the settings and the interpreters on disk, never on how long anything takes.
 *
 * Pass 1 ranks the interpreters named by path without a scan, so a project env or a set
 * defaultInterpreterPath is recommended in milliseconds. Outside `definitionsOnly` those
 * are tiers 0-3, which have no other members, so when every named path resolved, pass 1's
 * pick is the full ranking's pick. If any named path didn't resolve, pass 1 waits for the
 * ask after discovery: a slow or failed resolve must not let a lower tier win on timing. In `definitionsOnly` mode the definitions are every candidate, so
 * pass 1 is the whole ranking and there is no pass 2.
 *
 * Pass 2 ranks everything discovery found. It runs only when core asks after discovery
 * (`afterDiscovery`). Core asks first during startup and waits for every language's
 * answer before discovery starts, so the first ask must never wait for PET or module
 * discovery; it answers undefined instead, and core asks again.
 * Pass 2 ranks only a finished discovery: if discovery failed, what it found depends on
 * when it failed, so nothing is recommended.
 *
 * Pass 2's answer is remembered for the folder with the inputs it was computed from. When
 * pass 1 finds nothing named and the inputs are unchanged, it answers with the remembered
 * interpreter, so a folder that needs pass 2 starts without waiting for discovery again.
 */
export async function recommendWorkspaceRuntime(
    serviceContainer: IServiceContainer,
    interpreterService: IInterpreterService,
    workspaceUri: vscode.Uri | undefined,
    afterDiscovery: boolean,
): Promise<positron.LanguageRuntimeMetadata | undefined> {
    const started = Date.now();
    const baseContext = await buildRankingContext(serviceContainer, workspaceUri);
    const {
        resolved: named,
        unresolved,
        context,
    } = await resolveNamedInterpreters(interpreterService, baseContext, workspaceUri, afterDiscovery);

    if (unresolved === 0 || (context.definitionsOnly && afterDiscovery)) {
        // A `.python-version` that names neither a pyenv virtualenv nor an exact pyenv
        // version resolves to something below tier 3; leave that to pass 2.
        const pass1 = context.definitionsOnly
            ? named
            : named.filter((i) => (tierOf(i, context) ?? Number.MAX_SAFE_INTEGER) <= Tier.PythonVersionFile);
        const fromNamed = await firstEligible(serviceContainer, pass1, context, workspaceUri);
        traceInfo(`Interpreter ranking: pass 1 took ${Date.now() - started} ms`);
        // In `definitionsOnly` mode the definitions are every candidate, so there is no pass 2.
        if (fromNamed || context.definitionsOnly) {
            return fromNamed?.metadata;
        }
    }
    // The inputs are read from the context before any path is resolved, so both asks
    // compute the same inputs for the same folder, settings and roots.
    const inputs = await rankingInputs(baseContext).catch((err) => {
        traceWarn(`Interpreter ranking: could not read the ranking inputs: ${err}`);
        return undefined;
    });
    if (!afterDiscovery) {
        // Nothing named is eligible, so the answer is the one after discovery; reuse the
        // last one if nothing it depends on has changed.
        const remembered =
            unresolved === 0 && inputs
                ? await fromRememberedAnswer(serviceContainer, interpreterService, inputs, context, workspaceUri)
                : undefined;
        if (remembered) {
            return remembered;
        }
        traceInfo(
            `${
                unresolved > 0
                    ? 'Interpreter ranking: a named path did not resolve; recommending after discovery'
                    : 'Interpreter ranking: nothing named by path is eligible; recommending after discovery'
            } (${Date.now() - started} ms)`,
        );
        return undefined;
    }

    const pass2Started = Date.now();
    try {
        // Wait for a refresh still running, but never start one: after a refresh has
        // finished, triggerRefresh reruns PET and module discovery from scratch.
        await interpreterService.refreshPromise;
    } catch (err) {
        traceError(`Interpreter ranking: discovery failed, so nothing is recommended: ${err}`);
        return undefined;
    }
    const all = dedupeByPath([...named, ...interpreterService.getInterpreters(workspaceUri)]);
    const fromAll = await firstEligible(serviceContainer, all, await withDiscoveredFacts(context, all), workspaceUri);
    traceInfo(`Interpreter ranking: pass 2 took ${Date.now() - pass2Started} ms`);
    if (inputs) {
        await rememberedAnswerState(serviceContainer).updateValue(
            fromAll ? { inputs, path: fromAll.interpreter.path, tier: fromAll.tier } : undefined,
        );
    }
    return fromAll?.metadata;
}
