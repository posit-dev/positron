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
import { EnvironmentType, PythonEnvironment } from '../../pythonEnvironments/info';
import { PythonVersion } from '../../pythonEnvironments/info/pythonVersion';
import { IInterpreterHelper } from '../contracts';
import { IInterpreterComparer } from './types';
import { getActivePyenvForDirectory } from '../../pythonEnvironments/common/environmentManagers/pyenv';
import { arePathsSame } from '../../common/platform/fs-paths';

// --- Start Positron ---
import { getPyenvDir } from '../../pythonEnvironments/common/environmentManagers/pyenv';
import { readFileSync, pathExistsSync, checkParentDirs } from '../../pythonEnvironments/common/externalDependencies';
import { MAXIMUM_PYTHON_VERSION_EXCLUSIVE, MINIMUM_PYTHON_VERSION } from '../../common/constants';
import { categorizeEnvironment } from '../../positron/interpreterCategorization';
import { getCustomEnvDirs } from '../../positron/interpreterSettings';
import { getWorkspaceFolderPaths } from '../../common/vscodeApis/workspaceApis';
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
    // --- Start Positron ---
    // Removed the workspaceFolderPath field: it was resolved once in the constructor, from a
    // resource-less getActiveWorkspaceUri() call that returns nothing in a multi-root workspace.
    // Sorting context is now resolved per sort in getComparator().
    // private workspaceFolderPath: string;
    // --- End Positron ---

    private preferredPyenvInterpreterPath = new Map<string, string | undefined>();

    constructor(@inject(IInterpreterHelper) private readonly interpreterHelper: IInterpreterHelper) {}

    // --- Start Positron ---
    /**
     * Return a comparator that sorts environments for a resource, newest Python first within
     * each category.
     *
     * The categorization context is resolved once here rather than per comparison: it reads
     * configuration, and {@link categorizeEnvironment} probes the filesystem for the PEP 668
     * marker, neither of which belongs in a pairwise comparison.
     *
     * @param resource The resource whose workspace folder decides the preferred pyenv version.
     */
    public getComparator(resource: Resource): (a: PythonEnvironment, b: PythonEnvironment) => number {
        const sortKey = categorizationSortKeys();
        const workspacePath = this.interpreterHelper.getActiveWorkspaceUri(resource)?.folderUri.fsPath ?? '';
        const preferredPyenv = this.preferredPyenvInterpreterPath.get(workspacePath);
        return (a, b) => this.compare(a, b, sortKey, preferredPyenv);
    }
    // --- End Positron ---

    /**
     * Compare 2 Python environments, sorting them by assumed usefulness.
     * Return 0 if both environments are equal, -1 if a should be closer to the beginning of the list, or 1 if a comes after b.
     *
     * Environments are ranked primarily by {@link categorizeEnvironment}'s sort key: project
     * environments first, then global environments, then base interpreters, then externally
     * managed interpreters (e.g. the conda "base" env, system Pythons).
     *
     * Always sort with newest version of Python first within each subgroup.
     */
    // --- Start Positron ---
    // Takes the categorization sort keys and preferred pyenv path resolved by getComparator(),
    // instead of reading constructor-time workspace state.
    // public compare(a: PythonEnvironment, b: PythonEnvironment): number {
    private compare(
        a: PythonEnvironment,
        b: PythonEnvironment,
        sortKey: (env: PythonEnvironment) => number,
        preferredPyenv: string | undefined,
    ): number {
        // --- End Positron ---
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
        // Check environment category (project / global / base / externally managed).
        const categoryComparison = Math.sign(sortKey(a) - sortKey(b));
        if (categoryComparison !== 0) {
            return categoryComparison;
        }

        if (a.envType === EnvironmentType.Pyenv && b.envType === EnvironmentType.Pyenv) {
            if (preferredPyenv) {
                if (arePathsSame(preferredPyenv, b.path)) {
                    return 1;
                }
                if (arePathsSame(preferredPyenv, a.path)) {
                    return -1;
                }
            }
        }

        // Check Python version.
        const versionComparison = comparePythonVersionDescending(a.version, b.version);
        if (versionComparison !== 0) {
            return versionComparison;
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
        // --- Start Positron ---
        // filteredInterpreters.sort(this.compare.bind(this));
        filteredInterpreters.sort(this.getComparator(resource));
        // --- End Positron ---
        return filteredInterpreters.length ? filteredInterpreters[0] : undefined;
    }
}

// --- Start Positron ---
/**
 * Build a memoized categorization sort key lookup for a single sorting pass.
 *
 * Every open workspace folder counts as a project location and the user's custom interpreter
 * dirs outrank other global environments, matching the runtime picker (see
 * getRuntimeSourceAndShortName in positron/runtime.ts). Keys are memoized per environment because
 * {@link categorizeEnvironment} probes the filesystem, and a sort compares each environment
 * repeatedly.
 */
function categorizationSortKeys(): (env: PythonEnvironment) => number {
    const ctx = {
        workspaceFolders: getWorkspaceFolderPaths(),
        customInterpreterDirs: getCustomEnvDirs(),
    };
    const keys = new Map<PythonEnvironment, number>();
    return (env: PythonEnvironment) => {
        let key = keys.get(env);
        if (key === undefined) {
            key = categorizeEnvironment(env, ctx).sortKey;
            keys.set(env, key);
        }
        return key;
    };
}
// --- End Positron ---

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

// --- Start Positron ---
export function isProblematicCondaEnvironment(environment: PythonEnvironment): boolean {
    if (environment.envType !== EnvironmentType.Conda) {
        return false;
    }
    // Check if Python is not installed in the conda environment:
    // - JS locator case: path is just 'python'
    // - Native locator case: path is a predicted full path that doesn't exist
    const executablePath = environment.path;
    if (executablePath === 'python') {
        return true;
    }
    // For full paths, check if the file actually exists
    if (executablePath && executablePath !== '' && !pathExistsSync(executablePath)) {
        // If the predicted path doesn't exist, also check the standard conda installation locations
        // This handles cases where conda installs Python at <env>/bin/python but we predicted <env>/python
        if (environment.envPath) {
            const unixStylePath = path.join(environment.envPath, 'bin', 'python');
            const windowsStylePath = path.join(environment.envPath, 'Scripts', 'python.exe');

            // If Python exists at either standard location, this is NOT a problematic environment
            if (pathExistsSync(unixStylePath) || pathExistsSync(windowsStylePath)) {
                return false;
            }
        }
        return true;
    }
    return false;
}
// --- End Positron ---

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
 * Also returns true if the version could not be determined.
 */
export function isVersionSupported(version: PythonVersion | undefined): boolean {
    return (
        !version ||
        (comparePythonVersionDescending(MINIMUM_PYTHON_VERSION, version) >= 0 &&
            comparePythonVersionDescending(MAXIMUM_PYTHON_VERSION_EXCLUSIVE, version) < 0)
    );
}
// --- End Positron ---
