/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The single ranking of Python interpreters. The recommended interpreter for a
 * workspace is the first eligible one in this order. See
 * plans/python-startup-policy-design.md.
 *
 * Read `tierOf` top to bottom: the first rule that matches decides the tier.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';
import { IActivatedEnvironmentLaunch } from '../interpreter/contracts';
import {
    comparePythonVersionDescending,
    EnvLocationHeuristic,
    getEnvironmentTypeRank,
    getEnvLocationHeuristic,
    isBaseCondaEnvironment,
} from '../interpreter/configuration/environmentTypeComparer';
import { IServiceContainer } from '../ioc/types';
import { traceWarn } from '../logging';
import { getCustomVirtualEnvDirs } from '../pythonEnvironments/base/locators/common/nativePythonFinder';
import { NativePythonEnvironmentKind } from '../pythonEnvironments/base/locators/common/nativePythonUtils';
import {
    moduleMetadataMap,
    whenModuleMetadataReady,
} from '../pythonEnvironments/base/locators/lowLevel/moduleEnvironmentLocator';
import { arePathsSame, isParentPath } from '../pythonEnvironments/common/externalDependencies';
import { getGlobalEnvironmentDir } from '../pythonEnvironments/common/environmentManagers/globalEnvironment';
import { getPyenvVersionsDir } from '../pythonEnvironments/common/environmentManagers/pyenv';
import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { getUvPythonInstallDirs } from './discoveryRootSignature';
import { isExternallyManagedEnvironment } from './externallyManagedEnvironment';
import {
    getInterpreterDefinitionPaths,
    getResolvedFilterSettingPaths,
    isDefinitionsOnlyDiscovery,
    resolveSettingPath,
} from './interpreterSettings';
import { isProjectEnvironment, ProjectEnvironment, scanWorkspace } from './workspaceScan';

/** Ranking tiers, best first. */
export enum Tier {
    /** The env active in the shell Positron was launched from. */
    ActivatedEnv = 0,
    /** `python.defaultInterpreterPath`, at any scope. */
    DefaultInterpreterPath,
    /** The root project env, or the pyenv virtualenv named in the workspace's `.python-version`. */
    ProjectEnv,
    /** The pyenv version named in the workspace's `.python-version`. */
    PythonVersionFile,
    /** Envs one level deep, then other envs inside the workspace. */
    WorkspaceEnv,
    /** `interpreters.definitions`, environment modules, `include`, `venvPath`, `venvFolders`. */
    Configured,
    /** Positron's default env at `getGlobalEnvironmentDir()`. */
    PositronDefaultEnv,
    /** Conda named envs, then pyenv virtualenvs. */
    NamedEnv,
    /** uv base Pythons, conda base, pyenv versions, then global virtualenvs. */
    GlobalEnv,
    /** python.org, Windows Store and registry, other PATH Pythons. Start only when picked. */
    BaseInstall,
    /** Homebrew, Xcode/CLT, distro Pythons, anything with an EXTERNALLY-MANAGED marker. Start only when picked. */
    ExternallyManaged,
}

/**
 * Everything the ranking and the startup behavior read besides the interpreters
 * themselves. Built once by `buildRankingContext`; plain data, so every decision
 * below is a pure function of it.
 */
export interface RankingContext {
    workspacePath: string | undefined;
    activatedEnvPrefix: string | undefined;
    definitionPaths: string[];
    definitionsOnly: boolean;
    defaultInterpreterPath: string | undefined;
    /** Root project envs, highest priority first. */
    rootProjectEnvs: ProjectEnvironment[];
    pythonVersion: string | undefined;
    /** `<pyenv versions>/<pythonVersion>`, where pyenv keeps the version or virtualenv it names. */
    pythonVersionDir: string | undefined;
    nestedEnvDirs: string[];
    /** Whether the folder has Python files; decides `Immediate` vs `Implicit`. */
    hasPythonSignals: boolean;
    /** `include`, then `venvPath`, then `venvFolders`, in setting order. */
    configuredPaths: string[];
    /** Interpreters with environment-module metadata. */
    modulePaths: ReadonlySet<string>;
    positronDefaultEnvDir: string | undefined;
    /** Where `uv python install` puts its base Pythons. */
    uvPythonInstallDirs: string[];
    externallyManagedPaths: ReadonlySet<string>;
}

/** An interpreter and its tier; `undefined` means it is never recommended. */
export interface RankedInterpreter {
    interpreter: PythonEnvironment;
    tier: Tier | undefined;
}

function samePath(a: string | undefined, b: string | undefined): boolean {
    return !!a && !!b && arePathsSame(a, b);
}

/** Whether `p` is `dir` or inside it. `isParentPath` is true for equal paths too. */
function isUnder(p: string | undefined, dir: string): boolean {
    return !!p && isParentPath(p, dir);
}

function compareStrings(a: string, b: string): number {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

/**
 * Higher version first. `comparePythonVersionDescending` is not antisymmetric (it says 1 both
 * ways for two missing versions, or equal X.Y.Z with a different `raw`), so ties are made
 * explicit here and fall through to the path tie-break.
 */
function compareVersions(a: PythonEnvironment['version'], b: PythonEnvironment['version']): number {
    if (!a && !b) {
        return 0;
    }
    if (a && b && a.major === b.major && a.minor === b.minor && a.patch === b.patch) {
        return 0;
    }
    return comparePythonVersionDescending(a, b);
}

/** Which root project env this interpreter is (priority order), or -1. */
function rootProjectIndex(interpreter: PythonEnvironment, context: RankingContext): number {
    return context.rootProjectEnvs.findIndex((projectEnv) => isProjectEnvironment(interpreter, projectEnv));
}

/** Which env one level deep this interpreter belongs to (found order), or -1. */
function nestedIndex(interpreter: PythonEnvironment, context: RankingContext): number {
    return context.nestedEnvDirs.findIndex((dir) => isUnder(interpreter.path, dir));
}

function configuredIndex(interpreter: PythonEnvironment, context: RankingContext): number {
    return context.configuredPaths.findIndex((p) => isUnder(interpreter.path, p) || isUnder(interpreter.envPath, p));
}

function isPyenvVirtualenv(interpreter: PythonEnvironment): boolean {
    return (
        interpreter.envType === EnvironmentType.Pyenv &&
        interpreter.nativeKind === NativePythonEnvironmentKind.PyenvVirtualEnv
    );
}

function isUvBase(interpreter: PythonEnvironment, context: RankingContext): boolean {
    // uv venvs live elsewhere; only uv-managed base Pythons are under its install dirs.
    return context.uvPythonInstallDirs.some((dir) => isUnder(interpreter.path, dir));
}

/**
 * Whether `.python-version` names this pyenv env. Matched first on the folder pyenv
 * keeps it in, since PET shortens `version.raw` to X.Y.Z and so can't match names like
 * `3.13.0rc1`, `pypy3.10-7.3.15` or `miniconda3-latest`. A virtualenv can also be
 * reported under `<version>/envs/<name>`, so its name counts; a version, its X.Y.Z.
 */
function isNamedByPythonVersion(interpreter: PythonEnvironment, context: RankingContext): boolean {
    if (samePath(interpreter.envPath, context.pythonVersionDir)) {
        return true;
    }
    return isPyenvVirtualenv(interpreter)
        ? interpreter.envName === context.pythonVersion
        : interpreter.version?.raw === context.pythonVersion;
}

function isModule(interpreter: PythonEnvironment, context: RankingContext): boolean {
    return (
        interpreter.envType === EnvironmentType.Module ||
        [...context.modulePaths].some((modulePath) => samePath(modulePath, interpreter.path))
    );
}

/**
 * The interpreter's position in `interpreters.definitions`, or -1. Compared with
 * `arePathsSame`, not as strings, so a definition written with different case or
 * separators than PET's path (Windows) still matches.
 */
function definitionIndex(interpreter: PythonEnvironment, context: RankingContext): number {
    return context.definitionPaths.findIndex((definition) => samePath(definition, interpreter.path));
}

/** The tier of an interpreter, or `undefined` if it is never recommended. */
export function tierOf(interpreter: PythonEnvironment, context: RankingContext): Tier | undefined {
    if (
        samePath(interpreter.envPath, context.activatedEnvPrefix) ||
        samePath(interpreter.sysPrefix, context.activatedEnvPrefix)
    ) {
        return Tier.ActivatedEnv;
    }
    if (samePath(interpreter.path, context.defaultInterpreterPath)) {
        return Tier.DefaultInterpreterPath;
    }
    if (
        rootProjectIndex(interpreter, context) !== -1 ||
        (!!context.pythonVersion && isPyenvVirtualenv(interpreter) && isNamedByPythonVersion(interpreter, context))
    ) {
        return Tier.ProjectEnv;
    }
    if (
        !!context.pythonVersion &&
        interpreter.envType === EnvironmentType.Pyenv &&
        !isPyenvVirtualenv(interpreter) &&
        isNamedByPythonVersion(interpreter, context)
    ) {
        return Tier.PythonVersionFile;
    }
    // PET couldn't classify it. Rank it only if the user named it: the tiers above, or
    // `interpreters.definitions`.
    if (interpreter.envType === EnvironmentType.Unknown) {
        return definitionIndex(interpreter, context) !== -1 ? Tier.Configured : undefined;
    }
    // Envs one level deep are inside the folder too, so this covers them; `orderWithinTier`
    // puts them first.
    if (
        context.workspacePath &&
        getEnvLocationHeuristic(interpreter, context.workspacePath) === EnvLocationHeuristic.Local
    ) {
        return Tier.WorkspaceEnv;
    }
    if (
        definitionIndex(interpreter, context) !== -1 ||
        configuredIndex(interpreter, context) !== -1 ||
        isModule(interpreter, context) ||
        interpreter.envType === EnvironmentType.Custom
    ) {
        return Tier.Configured;
    }
    if (context.positronDefaultEnvDir && isUnder(interpreter.path, context.positronDefaultEnvDir)) {
        return Tier.PositronDefaultEnv;
    }
    if (
        (interpreter.envType === EnvironmentType.Conda && !isBaseCondaEnvironment(interpreter)) ||
        isPyenvVirtualenv(interpreter)
    ) {
        return Tier.NamedEnv;
    }
    // Before the externally managed check: uv installs its Pythons with an EXTERNALLY-MANAGED marker.
    if (
        isUvBase(interpreter, context) ||
        isBaseCondaEnvironment(interpreter) ||
        interpreter.envType === EnvironmentType.Pyenv
    ) {
        return Tier.GlobalEnv;
    }
    if (context.externallyManagedPaths.has(interpreter.path)) {
        return Tier.ExternallyManaged;
    }
    if (
        interpreter.envType === EnvironmentType.System ||
        interpreter.envType === EnvironmentType.Global ||
        interpreter.envType === EnvironmentType.MicrosoftStore
    ) {
        return Tier.BaseInstall;
    }
    // Global virtualenvs (virtualenvwrapper, and venv, poetry, pipenv, hatch and uv envs
    // stored outside the folder): nothing ties them to this folder.
    return Tier.GlobalEnv;
}

/** Order inside a tier, before version: lower first. */
function orderWithinTier(interpreter: PythonEnvironment, tier: Tier, context: RankingContext): number {
    switch (tier) {
        case Tier.ProjectEnv: {
            // Root project envs in priority order, then the pyenv virtualenv named in .python-version.
            const root = rootProjectIndex(interpreter, context);
            return root !== -1 ? root : context.rootProjectEnvs.length;
        }
        case Tier.WorkspaceEnv: {
            const nested = nestedIndex(interpreter, context);
            return nested !== -1 ? nested : context.nestedEnvDirs.length + getEnvironmentTypeRank(interpreter.envType);
        }
        case Tier.Configured: {
            // Definitions, then environment modules, then include, venvPath, venvFolders.
            const definitions = context.definitionPaths.length;
            const definition = definitionIndex(interpreter, context);
            if (definition !== -1) {
                return definition;
            }
            if (isModule(interpreter, context)) {
                return definitions;
            }
            const configured = configuredIndex(interpreter, context);
            return definitions + 1 + (configured !== -1 ? configured : context.configuredPaths.length);
        }
        case Tier.NamedEnv:
            return isPyenvVirtualenv(interpreter) ? 1 : 0;
        case Tier.GlobalEnv:
            if (isUvBase(interpreter, context)) {
                return 0;
            }
            if (isBaseCondaEnvironment(interpreter)) {
                return 1;
            }
            return interpreter.envType === EnvironmentType.Pyenv ? 2 : 3;
        default:
            return 0;
    }
}

/**
 * Rank interpreters best first. In `definitionsOnly` mode, ties keep the order of
 * `interpreters.definitions`. Interpreters that are never recommended come last.
 */
export function rankInterpreters(interpreters: PythonEnvironment[], context: RankingContext): RankedInterpreter[] {
    const keyed = interpreters.map((interpreter) => {
        const tier = tierOf(interpreter, context);
        return {
            interpreter,
            tier,
            tierKey: tier ?? Number.MAX_SAFE_INTEGER,
            within: tier === undefined ? 0 : orderWithinTier(interpreter, tier, context),
            definition: context.definitionsOnly ? definitionIndex(interpreter, context) : 0,
        };
    });
    keyed.sort(
        (a, b) =>
            a.tierKey - b.tierKey ||
            a.within - b.within ||
            compareVersions(a.interpreter.version, b.interpreter.version) ||
            a.definition - b.definition ||
            compareStrings(a.interpreter.path, b.interpreter.path),
    );
    return keyed.map(({ interpreter, tier }) => ({ interpreter, tier }));
}

/** Paths of the interpreters that are externally managed (`ExternallyManaged`), checked on disk. */
async function findExternallyManaged(interpreters: PythonEnvironment[]): Promise<Set<string>> {
    const flags = await Promise.all(
        interpreters.map(async (interpreter) => {
            try {
                return await isExternallyManagedEnvironment({
                    interpreterPath: interpreter.path,
                    nativeKind: interpreter.nativeKind,
                    environment: interpreter,
                });
            } catch (error) {
                traceWarn(`Could not classify ${interpreter.path}: ${error}`);
                return false;
            }
        }),
    );
    return new Set(interpreters.filter((_, i) => flags[i]).map((interpreter) => interpreter.path));
}

/**
 * `python.defaultInterpreterPath` for the first workspace folder, or undefined.
 * `get()` applies VS Code's precedence (folder > workspace > user) and includes an
 * admin-enforced value (POSITRON_ENFORCED_SETTINGS), so the scope is never inspected:
 * a value from any scope is `DefaultInterpreterPath`. `python` is the setting's
 * default and means unset.
 */
function readDefaultInterpreterPath(workspaceUri: vscode.Uri | undefined): string | undefined {
    const value = getConfiguration('python', workspaceUri).get<string>('defaultInterpreterPath');
    if (!value || value === 'python') {
        return undefined;
    }
    return resolveSettingPath(value, '[buildRankingContext]: python.defaultInterpreterPath');
}

/**
 * The context with the facts that only discovery can supply, for ranking `interpreters`
 * in full: `modulePaths` (PET reports many environment-module Pythons as plain global
 * Pythons; the module locator knows which they are) and `externallyManagedPaths`. Waits
 * for module discovery, which runs alongside PET's refresh, so call this only after
 * discovery, never on the fast path (Performance rule 2). Tiers 0-3 need neither.
 */
export async function withDiscoveredFacts(
    context: RankingContext,
    interpreters: PythonEnvironment[],
): Promise<RankingContext> {
    const [externallyManagedPaths] = await Promise.all([
        findExternallyManaged(interpreters),
        whenModuleMetadataReady(),
    ]);
    return { ...context, modulePaths: new Set(moduleMetadataMap.keys()), externallyManagedPaths };
}

/**
 * Gather the settings, environment and workspace facts the ranking reads. This is
 * the only place they are read; it scans the folder and never selects or writes an
 * interpreter. `modulePaths` and `externallyManagedPaths` start empty;
 * `withDiscoveredFacts` fills them.
 */
export async function buildRankingContext(
    serviceContainer: IServiceContainer,
    workspaceUri: vscode.Uri | undefined,
): Promise<RankingContext> {
    const [scan, activatedEnvPrefix] = await Promise.all([
        workspaceUri ? scanWorkspace(workspaceUri.fsPath) : undefined,
        serviceContainer.get<IActivatedEnvironmentLaunch>(IActivatedEnvironmentLaunch).getActivatedEnvPrefix(),
    ]);
    return {
        workspacePath: workspaceUri?.fsPath,
        activatedEnvPrefix,
        definitionPaths: getInterpreterDefinitionPaths(),
        definitionsOnly: isDefinitionsOnlyDiscovery(),
        defaultInterpreterPath: readDefaultInterpreterPath(workspaceUri),
        rootProjectEnvs: scan?.rootProjectEnvs ?? [],
        pythonVersion: scan?.pythonVersion,
        pythonVersionDir: scan?.pythonVersion ? path.join(getPyenvVersionsDir(), scan.pythonVersion) : undefined,
        nestedEnvDirs: scan?.nestedEnvDirs ?? [],
        hasPythonSignals: scan?.hasPythonSignals ?? false,
        // `venvPath` and `venvFolders` resolved by PET's own function, so `Configured`
        // matches exactly what PET searched.
        configuredPaths: [...getResolvedFilterSettingPaths().include, ...getCustomVirtualEnvDirs()],
        modulePaths: new Set(),
        positronDefaultEnvDir: getGlobalEnvironmentDir(),
        uvPythonInstallDirs: getUvPythonInstallDirs(),
        externallyManagedPaths: new Set(),
    };
}
