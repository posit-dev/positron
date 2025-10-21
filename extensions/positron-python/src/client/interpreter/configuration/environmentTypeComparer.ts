// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// --- Start Positron ---
/* eslint-disable import/no-duplicates */

import * as path from 'path';
// --- End Positron ---
import { injectable, inject } from 'inversify';
import { Resource } from '../../common/types';
import { Architecture } from '../../common/utils/platform';
import { isActiveStateEnvironmentForWorkspace } from '../../pythonEnvironments/common/environmentManagers/activestate';
import { isParentPath } from '../../pythonEnvironments/common/externalDependencies';
import {
    EnvironmentType,
    PythonEnvironment,
    virtualEnvTypes,
    workspaceVirtualEnvTypes,
} from '../../pythonEnvironments/info';
import { PythonVersion } from '../../pythonEnvironments/info/pythonVersion';
import { IInterpreterHelper } from '../contracts';
import { IInterpreterComparer } from './types';
import { getActivePyenvForDirectory } from '../../pythonEnvironments/common/environmentManagers/pyenv';
import { arePathsSame } from '../../common/platform/fs-paths';

// --- Start Positron ---
import { getPyenvDir } from '../../pythonEnvironments/common/environmentManagers/pyenv';
import { readFileSync, pathExistsSync, checkParentDirs } from '../../pythonEnvironments/common/externalDependencies';
import { MAXIMUM_PYTHON_VERSION_EXCLUSIVE, MINIMUM_PYTHON_VERSION } from '../../common/constants';
// --- End Positron ---

export enum EnvLocationHeuristic {
    /**
     * Environments inside the workspace.
     */
    Local = 1,
    /**
     * Environments outside the workspace.
     */
    Global = 2,
}

@injectable()
export class EnvironmentTypeComparer implements IInterpreterComparer {
    private workspaceFolderPath: string;

    private preferredPyenvInterpreterPath = new Map<string, string | undefined>();

    constructor(@inject(IInterpreterHelper) private readonly interpreterHelper: IInterpreterHelper) {
        this.workspaceFolderPath = this.interpreterHelper.getActiveWorkspaceUri(undefined)?.folderUri.fsPath ?? '';
    }

    /**
     * Compare 2 Python environments, sorting them by assumed usefulness.
     * Return 0 if both environments are equal, -1 if a should be closer to the beginning of the list, or 1 if a comes after b.
     *
     * The comparison guidelines are:
     * 1. Local environments first (same path as the workspace root);
     * 2. Global environments next (anything not local), with conda environments at a lower priority, and "base" being last;
     * 3. Globally-installed interpreters (/usr/bin/python3, Microsoft Store).
     *
     * Always sort with newest version of Python first within each subgroup.
     */
    public compare(a: PythonEnvironment, b: PythonEnvironment): number {
        if (isProblematicCondaEnvironment(a)) {
            return 1;
        }
        if (isProblematicCondaEnvironment(b)) {
            return -1;
        }
        // --- Start Positron ---
        // Unsupported versions are always less useful
        if (!isVersionSupported(a.version)) {
            return 1;
        }
        if (!isVersionSupported(b.version)) {
            return -1;
        }
        // --- End Positron ---
        // Check environment location.
        const envLocationComparison = compareEnvironmentLocation(a, b, this.workspaceFolderPath);
        if (envLocationComparison !== 0) {
            return envLocationComparison;
        }

        if (a.envType === EnvironmentType.Pyenv && b.envType === EnvironmentType.Pyenv) {
            const preferredPyenv = this.preferredPyenvInterpreterPath.get(this.workspaceFolderPath);
            if (preferredPyenv) {
                if (arePathsSame(preferredPyenv, b.path)) {
                    return 1;
                }
                if (arePathsSame(preferredPyenv, a.path)) {
                    return -1;
                }
            }
        }

        // Check environment type.
        const envTypeComparison = compareEnvironmentType(a, b);
        if (envTypeComparison !== 0) {
            return envTypeComparison;
        }

        // Check Python version.
        const versionComparison = comparePythonVersionDescending(a.version, b.version);
        if (versionComparison !== 0) {
            return versionComparison;
        }

        // If we have the "base" Conda env, put it last in its Python version subgroup.
        if (isBaseCondaEnvironment(a)) {
            return 1;
        }

        if (isBaseCondaEnvironment(b)) {
            return -1;
        }

        // Check alphabetical order.
        const nameA = getSortName(a, this.interpreterHelper);
        const nameB = getSortName(b, this.interpreterHelper);
        if (nameA === nameB) {
            return 0;
        }

        return nameA > nameB ? 1 : -1;
    }

    public async initialize(resource: Resource): Promise<void> {
        const workspaceUri = this.interpreterHelper.getActiveWorkspaceUri(resource);
        const cwd = workspaceUri?.folderUri.fsPath;
        if (!cwd) {
            return;
        }
        const preferredPyenvInterpreter = await getActivePyenvForDirectory(cwd);
        this.preferredPyenvInterpreterPath.set(cwd, preferredPyenvInterpreter);
    }

    public getRecommended(interpreters: PythonEnvironment[], resource: Resource): PythonEnvironment | undefined {
        // When recommending an intepreter for a workspace, we either want to return a local one
        // or fallback on a globally-installed interpreter, and we don't want want to suggest a global environment
        // because we would have to add a way to match environments to a workspace.
        const workspaceUri = this.interpreterHelper.getActiveWorkspaceUri(resource);
        // --- Start Positron ---
        const pyenvVersion = interpreters.some((i) => i.envType === EnvironmentType.Pyenv)
            ? getPyenvVersion(workspaceUri?.folderUri.fsPath)
            : undefined;
        // --- End Positron ---

        const filteredInterpreters = interpreters.filter((i) => {
            if (isProblematicCondaEnvironment(i)) {
                return false;
            }
            // --- Start Positron ---
            // Never recommend interpreters with unsupported versions.
            if (!isVersionSupported(i.version)) {
                return false;
            }
            // --- End Positron ---
            if (
                i.envType === EnvironmentType.ActiveState &&
                (!i.path ||
                    !workspaceUri ||
                    !isActiveStateEnvironmentForWorkspace(i.path, workspaceUri.folderUri.fsPath))
            ) {
                return false;
            }
            if (getEnvLocationHeuristic(i, workspaceUri?.folderUri.fsPath || '') === EnvLocationHeuristic.Local) {
                return true;
            }
            if (!workspaceVirtualEnvTypes.includes(i.envType) && virtualEnvTypes.includes(i.envType)) {
                // These are global virtual envs so we're not sure if these envs were created for the workspace, skip them.
                return false;
            }
            if (i.version?.major === 2) {
                return false;
            }
            // --- Start Positron ---
            // if we have a pyenv version number, only recommend interpreters that match the specified pyenv version.
            if (i.version?.raw === pyenvVersion && i.envType === EnvironmentType.Pyenv) {
                return true;
            }
            if (pyenvVersion && i.envType === EnvironmentType.Pyenv) {
                // pyenvVersion may also be the name of a virtual environment, rather than a version number
                // Do not recommend pyenv interpreters that do not match the specified pyenv version.
                return isVirtualEnvName(pyenvVersion) && i.envName === pyenvVersion;
            }
            // --- End Positron ---
            return true;
        });
        filteredInterpreters.sort(this.compare.bind(this));
        return filteredInterpreters.length ? filteredInterpreters[0] : undefined;
    }
}

function getSortName(info: PythonEnvironment, interpreterHelper: IInterpreterHelper): string {
    const sortNameParts: string[] = [];
    const envSuffixParts: string[] = [];

    // Sort order for interpreters is:
    // * Version
    // * Architecture
    // * Interpreter Type
    // * Environment name
    if (info.version) {
        sortNameParts.push(info.version.raw);
    }
    if (info.architecture) {
        sortNameParts.push(getArchitectureSortName(info.architecture));
    }
    if (info.companyDisplayName && info.companyDisplayName.length > 0) {
        sortNameParts.push(info.companyDisplayName.trim());
    } else {
        sortNameParts.push('Python');
    }

    if (info.envType) {
        const name = interpreterHelper.getInterpreterTypeDisplayName(info.envType);
        if (name) {
            envSuffixParts.push(name);
        }
    }
    if (info.envName && info.envName.length > 0) {
        envSuffixParts.push(info.envName);
    }

    const envSuffix = envSuffixParts.length === 0 ? '' : `(${envSuffixParts.join(': ')})`;
    return `${sortNameParts.join(' ')} ${envSuffix}`.trim();
}

function getArchitectureSortName(arch?: Architecture) {
    // Strings are choosen keeping in mind that 64-bit gets preferred over 32-bit.
    switch (arch) {
        case Architecture.x64:
            return 'x64';
        case Architecture.x86:
            return 'x86';
        default:
            return '';
    }
}

function isBaseCondaEnvironment(environment: PythonEnvironment): boolean {
    return (
        environment.envType === EnvironmentType.Conda &&
        (environment.envName === 'base' || environment.envName === 'miniconda')
    );
}

export function isProblematicCondaEnvironment(environment: PythonEnvironment): boolean {
    return environment.envType === EnvironmentType.Conda && environment.path === 'python';
}

/**
 * Compare 2 Python versions in decending order, most recent one comes first.
 */
// --- Start Positron ---
// We export this function for Positron to use in sortInterpreters function.
export function comparePythonVersionDescending(a: PythonVersion | undefined, b: PythonVersion | undefined): number {
    // --- End Positron ---
    if (!a) {
        return 1;
    }

    if (!b) {
        return -1;
    }

    if (a.raw === b.raw) {
        return 0;
    }

    if (a.major === b.major) {
        if (a.minor === b.minor) {
            if (a.patch === b.patch) {
                return a.build.join(' ') > b.build.join(' ') ? -1 : 1;
            }
            return a.patch > b.patch ? -1 : 1;
        }
        return a.minor > b.minor ? -1 : 1;
    }

    return a.major > b.major ? -1 : 1;
}

/**
 * Compare 2 environment locations: return 0 if they are the same, -1 if a comes before b, 1 otherwise.
 */
function compareEnvironmentLocation(a: PythonEnvironment, b: PythonEnvironment, workspacePath: string): number {
    const aHeuristic = getEnvLocationHeuristic(a, workspacePath);
    const bHeuristic = getEnvLocationHeuristic(b, workspacePath);

    return Math.sign(aHeuristic - bHeuristic);
}

/**
 * Return a heuristic value depending on the environment type.
 */
export function getEnvLocationHeuristic(environment: PythonEnvironment, workspacePath: string): EnvLocationHeuristic {
    if (
        workspacePath.length > 0 &&
        ((environment.envPath && isParentPath(environment.envPath, workspacePath)) ||
            (environment.path && isParentPath(environment.path, workspacePath)))
    ) {
        return EnvLocationHeuristic.Local;
    }
    return EnvLocationHeuristic.Global;
}

/**
 * Compare 2 environment types: return 0 if they are the same, -1 if a comes before b, 1 otherwise.
 */
function compareEnvironmentType(a: PythonEnvironment, b: PythonEnvironment): number {
    // --- Start Positron ---
    // if (!a.type && !b.type && a.envType !== EnvironmentType.Pyenv && b.envType !== EnvironmentType.Pyenv) {
    // Don't lump Pyenv environments together with all other global interpreters.
    // --- End Positron ---
    if (!a.type && !b.type) {
        if (a.envType === EnvironmentType.Pyenv && b.envType !== EnvironmentType.Pyenv) {
            return -1;
        }
        if (a.envType !== EnvironmentType.Pyenv && b.envType === EnvironmentType.Pyenv) {
            return 1;
        }

        return 0;
    }
    const envTypeByPriority = getPrioritizedEnvironmentType();
    return Math.sign(envTypeByPriority.indexOf(a.envType) - envTypeByPriority.indexOf(b.envType));
}

function getPrioritizedEnvironmentType(): EnvironmentType[] {
    return [
        // Prioritize non-Conda environments.
        // --- Start Positron ---
        EnvironmentType.Uv,
        // --- End Positron ---
        EnvironmentType.Poetry,
        EnvironmentType.Pipenv,
        EnvironmentType.VirtualEnvWrapper,
        EnvironmentType.Hatch,
        EnvironmentType.Venv,
        EnvironmentType.VirtualEnv,
        EnvironmentType.ActiveState,
        EnvironmentType.Conda,
        EnvironmentType.Pyenv,
        EnvironmentType.MicrosoftStore,
        EnvironmentType.Global,
        EnvironmentType.System,
        // --- Start Positron ---
        EnvironmentType.Custom,
        // --- End Positron ---
        EnvironmentType.Unknown,
    ];
}
// --- Start Positron ---
/**
 * Return true if the version name is not of the form x.y.z. This typically means it's a virtual environment name.
 */
function isVirtualEnvName(versionName: string): boolean {
    const pattern = /[0-9]+\.[0-9]+\.[0-9]/;
    return !versionName.match(pattern);
}

/**
 * Return the path to the local pyenv version file, or the global pyenv version file if the local version file does not exist.
 * If neither file exists, return undefined.
 */
export function getPyenvVersion(workspacePath: string | undefined): string | undefined {
    const localPyenvVersion = workspacePath ? path.join(workspacePath, '.python-version') : '';
    if (pathExistsSync(localPyenvVersion)) {
        return readFileSync(localPyenvVersion).trim();
    }
    // if the local pyenv version file does not exist in the workspace, we need to check parents of the workspace
    if (workspacePath) {
        const parentPyenvVersion = checkParentDirs(workspacePath, '.python-version', {
            resolveSymlinks: true,
            maxDepth: 10,
        });
        if (parentPyenvVersion) {
            return readFileSync(parentPyenvVersion).trim();
        }
    }

    const globalPyenvVersion = path.join(getPyenvDir(), 'version');
    if (pathExistsSync(globalPyenvVersion)) {
        return readFileSync(globalPyenvVersion).trim();
    }
    return undefined;
}

/**
 * Check if a version is supported (i.e. >= the minimum supported version and < the maximum).
 * Returns false if the version could not be determined.
 */
export function isVersionSupported(version: PythonVersion | undefined): boolean {
    return (
        version !== undefined &&
        comparePythonVersionDescending(MINIMUM_PYTHON_VERSION, version) >= 0 &&
        comparePythonVersionDescending(MAXIMUM_PYTHON_VERSION_EXCLUSIVE, version) < 0
    );
}
// --- End Positron ---
