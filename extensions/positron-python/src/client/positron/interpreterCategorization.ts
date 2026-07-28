/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { NativePythonEnvironmentKind } from '../pythonEnvironments/base/locators/common/nativePythonUtils';
import { EnvironmentType, PythonEnvironment, virtualEnvTypes } from '../pythonEnvironments/info';
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
import { isParentPath, pathExistsSync } from '../pythonEnvironments/common/externalDependencies';

/**
 * How appropriate an interpreter is for the open project. Numeric values double
 * as display order (lower is more appropriate).
 */
export enum PythonEnvironmentCategory {
    ProjectEnvironment = 1,
    GlobalEnvironment = 2,
    BaseInterpreter = 3,
    ExternallyManaged = 4,
}

/** PET-resolved inputs for a single interpreter. Pure -- no I/O. */
export interface CategorizationInput {
    kind: NativePythonEnvironmentKind | undefined;
    envType: EnvironmentType;
    envName: string | undefined;
    envPath: string | undefined;
    interpreterPath: string;
    project: string | undefined;
    hasModuleMetadata: boolean;
    externallyManagedMarker: boolean;
    workspaceFolders: string[];
    customInterpreterDirs: string[];
}

export interface Categorization {
    category: PythonEnvironmentCategory;
    sortKey: number;
    managerToken: string;
    groupLabel: string;
    /**
     * Whether venv creation may use this interpreter as its base. Category ranks how
     * appropriate an environment is for the project; this answers the separate question of
     * whether venv creation can safely spawn the raw interpreter path. Base/externally-managed
     * interpreters qualify, except environment-module Pythons (must launch with their module
     * loaded, not from the raw executable) and ActiveState (a managed runtime). MicrosoftStore
     * is deliberately allowed: `python -m venv` works on current Store builds, and it can be
     * the only Python on a stock Windows machine.
     */
    validVenvSeed: boolean;
}

const NAMED_ENV_KINDS = new Set<NativePythonEnvironmentKind>([
    NativePythonEnvironmentKind.Venv,
    NativePythonEnvironmentKind.VirtualEnv,
    NativePythonEnvironmentKind.VirtualEnvWrapper,
    NativePythonEnvironmentKind.Pipenv,
    NativePythonEnvironmentKind.Poetry,
    NativePythonEnvironmentKind.Pixi,
    NativePythonEnvironmentKind.Conda,
    NativePythonEnvironmentKind.PyenvVirtualEnv,
    NativePythonEnvironmentKind.UvWorkspace,
    // PET emits `Custom` only for interpreters discovered via a user-configured
    // custom location (`python.interpreters.include`), so treat them as named:
    // Global unless project-associated. tier2Subpriority then ranks them first.
    NativePythonEnvironmentKind.Custom,
]);

function normalize(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

function isCondaBase(input: CategorizationInput): boolean {
    // Recognize conda from the raw PET kind, or from the collapsed envType when the
    // raw kind is missing (JS locator / cache miss). Without the envType fallback a
    // conda `base` without nativeEnvKind would be treated as a named/dedicated env.
    const isConda =
        input.kind === NativePythonEnvironmentKind.Conda ||
        (input.kind === undefined && input.envType === EnvironmentType.Conda);
    return isConda && (input.envName === 'base' || input.envName === 'miniconda');
}

/** uv managed base Pythons live under the uv python data dir; uv venvs do not. */
function isUvBaseInstall(interpreterPath: string): boolean {
    return normalize(interpreterPath).includes('/uv/python/');
}

function isUvManaged(input: CategorizationInput): boolean {
    // Recognize uv from the raw PET kind, or from the collapsed envType when the raw
    // kind is missing (JS locator / cache miss). Without the envType fallback a uv base
    // install without nativeEnvKind would be treated as a named/dedicated env, since
    // EnvironmentType.Uv is in virtualEnvTypes.
    return (
        input.kind === NativePythonEnvironmentKind.Uv ||
        (input.kind === undefined && input.envType === EnvironmentType.Uv)
    );
}

const SYSTEM_LOCATION_KINDS = new Set<NativePythonEnvironmentKind>([
    NativePythonEnvironmentKind.MacCommandLineTools,
    NativePythonEnvironmentKind.MacXCode,
    NativePythonEnvironmentKind.LinuxGlobal,
]);

// `/usr/local/bin` is intentionally excluded: python.org and standalone
// interpreters symlink there and remain pip-writable. Homebrew under
// `/usr/local` is caught by PET kind; PEP 668 pythons by the marker.
const SYSTEM_LOCATION_PREFIXES = [
    '/usr/bin/',
    '/bin/',
    '/library/developer/commandlinetools/',
    '/applications/xcode.app/',
];

function isSystemLocated(input: CategorizationInput): boolean {
    if (input.kind !== undefined && SYSTEM_LOCATION_KINDS.has(input.kind)) {
        return true;
    }
    const p = normalize(input.interpreterPath);
    return SYSTEM_LOCATION_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function isNamedEnvironment(input: CategorizationInput): boolean {
    if (isCondaBase(input)) {
        return false;
    }
    if (input.hasModuleMetadata) {
        return false;
    }
    if (isUvManaged(input)) {
        // uv base installs are not named environments; non-workspace uv venvs are.
        return !isUvBaseInstall(input.interpreterPath);
    }
    if (input.kind !== undefined) {
        return NAMED_ENV_KINDS.has(input.kind);
    }
    // Fallback for envs lacking a raw PET kind (JS locator / cache miss). Custom is a
    // user-configured interpreter (treated as named/Global, matching NAMED_ENV_KINDS)
    // but is not in virtualEnvTypes, so include it explicitly.
    return virtualEnvTypes.includes(input.envType) || input.envType === EnvironmentType.Custom;
}

function isProjectAssociated(input: CategorizationInput): boolean {
    const candidates = [input.envPath, input.interpreterPath].filter((p): p is string => !!p);
    for (const folder of input.workspaceFolders) {
        if (candidates.some((c) => isParentPath(c, folder))) {
            return true;
        }
        if (input.project && isParentPath(input.project, folder)) {
            return true;
        }
    }
    return false;
}

function isExternallyManaged(input: CategorizationInput): boolean {
    if (isCondaBase(input)) {
        return true;
    }
    if (input.kind === NativePythonEnvironmentKind.Homebrew) {
        return true;
    }
    if (isUvManaged(input) && isUvBaseInstall(input.interpreterPath)) {
        return true;
    }
    if (isSystemLocated(input)) {
        return true;
    }
    return input.externallyManagedMarker;
}

/** Manager token shown in runtimeName, derived from the raw PET kind. */
function managerToken(input: CategorizationInput): string {
    if (input.hasModuleMetadata) {
        return 'module';
    }
    switch (input.kind) {
        case NativePythonEnvironmentKind.Venv:
        case NativePythonEnvironmentKind.VirtualEnv:
            return 'venv';
        case NativePythonEnvironmentKind.VirtualEnvWrapper:
            return 'virtualenvwrapper';
        case NativePythonEnvironmentKind.Conda:
            return 'conda';
        case NativePythonEnvironmentKind.Pyenv:
        case NativePythonEnvironmentKind.PyenvVirtualEnv:
            return 'pyenv';
        case NativePythonEnvironmentKind.Pixi:
            return 'pixi';
        case NativePythonEnvironmentKind.Poetry:
            return 'poetry';
        case NativePythonEnvironmentKind.Pipenv:
            return 'pipenv';
        case NativePythonEnvironmentKind.Uv:
        case NativePythonEnvironmentKind.UvWorkspace:
            return 'uv';
        case NativePythonEnvironmentKind.Homebrew:
            return 'Homebrew';
        case NativePythonEnvironmentKind.MacPythonOrg:
            return 'python.org';
        case NativePythonEnvironmentKind.MacCommandLineTools:
        case NativePythonEnvironmentKind.MacXCode:
        case NativePythonEnvironmentKind.LinuxGlobal:
        case NativePythonEnvironmentKind.GlobalPaths:
        case NativePythonEnvironmentKind.WindowsRegistry:
        case NativePythonEnvironmentKind.WindowsStore:
            return 'system';
        default:
            return getEnvironmentTypeToken(input.envType);
    }
}

// Fallback token derived from the collapsed envType, used when the raw PET kind is
// missing (JS locator / cache miss). Kept in sync with the kind-based tokens above.
function getEnvironmentTypeToken(envType: EnvironmentType): string {
    switch (envType) {
        case EnvironmentType.Hatch:
            return 'hatch';
        case EnvironmentType.Conda:
            return 'conda';
        case EnvironmentType.Pyenv:
            return 'pyenv';
        case EnvironmentType.Venv:
        case EnvironmentType.VirtualEnv:
            return 'venv';
        case EnvironmentType.VirtualEnvWrapper:
            return 'virtualenvwrapper';
        case EnvironmentType.Uv:
            return 'uv';
        case EnvironmentType.Pixi:
            return 'pixi';
        case EnvironmentType.Poetry:
            return 'poetry';
        case EnvironmentType.Pipenv:
            return 'pipenv';
        default:
            return 'system';
    }
}

function groupLabel(category: PythonEnvironmentCategory): string {
    switch (category) {
        case PythonEnvironmentCategory.ProjectEnvironment:
            return vscode.l10n.t('Project Environments');
        case PythonEnvironmentCategory.GlobalEnvironment:
            return vscode.l10n.t('Global Environments');
        case PythonEnvironmentCategory.BaseInterpreter:
            return vscode.l10n.t('Base Interpreters');
        case PythonEnvironmentCategory.ExternallyManaged:
            return vscode.l10n.t('Externally Managed');
        default:
            return vscode.l10n.t('Base Interpreters');
    }
}

const RESERVED_POSITRON_VENV = path.join(os.homedir(), '.virtualenvs', 'positron');

function wellKnownVenvHomes(): string[] {
    const home = os.homedir();
    return [
        process.env.WORKON_HOME,
        path.join(home, '.venvs'),
        path.join(home, '.virtualenvs'),
        path.join(home, '.local', 'share', 'virtualenvs'),
    ].filter((p): p is string => !!p);
}

function tier1Subpriority(token: string): number {
    switch (token) {
        case 'uv':
            return 0;
        case 'venv':
            return 10;
        case 'pixi':
            return 20;
        case 'hatch':
            return 30;
        case 'conda':
            return 40;
        default:
            return 50;
    }
}

function tier2Subpriority(input: CategorizationInput): number {
    const target = input.envPath ?? input.interpreterPath;
    if (input.customInterpreterDirs.some((dir) => isParentPath(target, dir))) {
        return 0;
    }
    if (isParentPath(target, RESERVED_POSITRON_VENV)) {
        return 10; // reserved for the #14887 blessed global venv location
    }
    if (wellKnownVenvHomes().some((home) => isParentPath(target, home))) {
        return 20;
    }
    return 30; // tool-managed (pyenv-virtualenv, conda named) and everything else
}

function tier3Subpriority(input: CategorizationInput): number {
    if (input.hasModuleMetadata) {
        return 30;
    }
    switch (input.kind) {
        case NativePythonEnvironmentKind.Pyenv:
            return 0;
        case NativePythonEnvironmentKind.MacPythonOrg:
            return 10;
        case NativePythonEnvironmentKind.WindowsRegistry:
            return 20;
        default:
            return 40;
    }
}

function tier4Subpriority(input: CategorizationInput): number {
    if (isUvManaged(input) || input.kind === NativePythonEnvironmentKind.Homebrew) {
        return 0;
    }
    if (isCondaBase(input)) {
        return 10;
    }
    if (isSystemLocated(input)) {
        return 20; // system pythons always dead last
    }
    return 15; // marker-only externally managed
}

function subpriority(category: PythonEnvironmentCategory, token: string, input: CategorizationInput): number {
    switch (category) {
        case PythonEnvironmentCategory.ProjectEnvironment:
            return tier1Subpriority(token);
        case PythonEnvironmentCategory.GlobalEnvironment:
            return tier2Subpriority(input);
        case PythonEnvironmentCategory.BaseInterpreter:
            return tier3Subpriority(input);
        case PythonEnvironmentCategory.ExternallyManaged:
            return tier4Subpriority(input);
        default:
            return 0;
    }
}

/** Classify an interpreter. Pure: all I/O (marker probe, config) is in the input. */
export function categorizePythonEnvironment(input: CategorizationInput): Categorization {
    let category: PythonEnvironmentCategory;
    if (isNamedEnvironment(input)) {
        category = isProjectAssociated(input)
            ? PythonEnvironmentCategory.ProjectEnvironment
            : PythonEnvironmentCategory.GlobalEnvironment;
    } else if (isExternallyManaged(input)) {
        category = PythonEnvironmentCategory.ExternallyManaged;
    } else {
        category = PythonEnvironmentCategory.BaseInterpreter;
    }
    const token = managerToken(input);
    const validVenvSeed =
        (category === PythonEnvironmentCategory.BaseInterpreter ||
            category === PythonEnvironmentCategory.ExternallyManaged) &&
        !input.hasModuleMetadata &&
        input.envType !== EnvironmentType.Module &&
        input.envType !== EnvironmentType.ActiveState;
    return {
        category,
        sortKey: category * 1000 + subpriority(category, token, input),
        managerToken: token,
        groupLabel: groupLabel(category),
        validVenvSeed,
    };
}

/**
 * Probe the PEP 668 EXTERNALLY-MANAGED marker under an interpreter's stdlib. PET
 * does not surface this flag (verified against bundled 2026.12 and upstream main),
 * so we check the filesystem.
 */
export function probeExternallyManagedMarker(
    sysPrefix: string | undefined,
    version: PythonVersion | undefined,
): boolean {
    if (!sysPrefix) {
        return false;
    }
    const candidates: string[] = [];
    if (version?.major !== undefined && version?.minor !== undefined) {
        candidates.push(path.join(sysPrefix, 'lib', `python${version.major}.${version.minor}`, 'EXTERNALLY-MANAGED'));
    }
    candidates.push(path.join(sysPrefix, 'Lib', 'EXTERNALLY-MANAGED')); // Windows layout
    return candidates.some((candidate) => pathExistsSync(candidate));
}

/** Assemble the input from an environment + context, then classify. */
export function categorizeEnvironment(
    env: PythonEnvironment,
    ctx: { workspaceFolders: string[]; customInterpreterDirs: string[]; hasModuleMetadata?: boolean },
): Categorization {
    return categorizePythonEnvironment({
        kind: env.nativeEnvKind,
        envType: env.envType,
        envName: env.envName,
        envPath: env.envPath,
        interpreterPath: env.path,
        project: env.nativeProject,
        hasModuleMetadata: ctx.hasModuleMetadata ?? false,
        externallyManagedMarker: probeExternallyManagedMarker(env.sysPrefix, env.version),
        workspaceFolders: ctx.workspaceFolders,
        customInterpreterDirs: ctx.customInterpreterDirs,
    });
}
