// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fse from 'fs-extra';
import * as path from 'path';
import { traceError, traceInfo, traceVerbose } from '../../common/logging';
import { isWindows } from '../../common/utils/platformUtils';

/**
 * Represents the status of conda sourcing in the current environment
 */
export class CondaSourcingStatus {
    /**
     * Creates a new CondaSourcingStatus instance
     * @param condaPath Path to the conda installation
     * @param condaFolder Path to the conda installation folder (derived from condaPath)
     * @param isActiveOnLaunch Whether conda was activated before VS Code launch
     * @param globalSourcingScript Path to the global sourcing script (if exists)
     * @param shellSourcingScripts List of paths to shell-specific sourcing scripts
     */
    constructor(
        public readonly condaPath: string,
        public readonly condaFolder: string,
        public isActiveOnLaunch?: boolean,
        public globalSourcingScript?: string,
        public shellSourcingScripts?: string[],
    ) {}

    /**
     * Returns a formatted string representation of the conda sourcing status
     */
    toString(): string {
        const lines: string[] = [];
        lines.push('Conda Sourcing Status:');
        lines.push(`├─ Conda Path: ${this.condaPath}`);
        lines.push(`├─ Conda Folder: ${this.condaFolder}`);
        lines.push(`├─ Active on Launch: ${this.isActiveOnLaunch ?? 'false'}`);

        if (this.globalSourcingScript) {
            lines.push(`├─ Global Sourcing Script: ${this.globalSourcingScript}`);
        }

        if (this.shellSourcingScripts?.length) {
            lines.push('└─ Shell-specific Sourcing Scripts:');
            this.shellSourcingScripts.forEach((script, index, array) => {
                const isLast = index === array.length - 1;
                if (script) {
                    // Only include scripts that exist
                    lines.push(`   ${isLast ? '└─' : '├─'} ${script}`);
                }
            });
        } else {
            lines.push('└─ No Shell-specific Sourcing Scripts Found');
        }

        return lines.join('\n');
    }
}

/**
 * Constructs the conda sourcing status for a given conda installation
 * @param condaPath The path to the conda executable
 * @returns A CondaSourcingStatus object containing:
 *          - Whether conda was active when VS Code launched
 *          - Path to global sourcing script (if found)
 *          - Paths to shell-specific sourcing scripts (if found)
 *
 * This function checks:
 * 1. If conda is already active in the current shell (CONDA_SHLVL)
 * 2. Location of the global activation script
 * 3. Location of shell-specific activation scripts
 */
export async function constructCondaSourcingStatus(condaPath: string): Promise<CondaSourcingStatus> {
    const condaFolder = path.dirname(path.dirname(condaPath));
    let sourcingStatus = new CondaSourcingStatus(condaPath, condaFolder);

    // The `conda_shlvl` value indicates whether conda is properly initialized in the current shell:
    // - `-1`: Conda has never been sourced
    // - `undefined`: No shell level information available
    // - `0 or higher`: Conda is properly sourced in the shell
    const condaShlvl = process.env.CONDA_SHLVL;
    if (condaShlvl && parseInt(condaShlvl) >= 0) {
        sourcingStatus.isActiveOnLaunch = true;
        // if activation already occurred, no need to find further scripts
        return sourcingStatus;
    }

    // Attempt to find the GLOBAL conda sourcing script
    const globalSourcingScript: string | undefined = await findGlobalSourcingScript(sourcingStatus.condaFolder);
    if (globalSourcingScript) {
        sourcingStatus.globalSourcingScript = globalSourcingScript;
        // note: future iterations could decide to exit here instead of continuing to generate all the other activation scripts
    }

    // find and save all of the shell specific sourcing scripts
    sourcingStatus.shellSourcingScripts = await findShellSourcingScripts(sourcingStatus);

    return sourcingStatus;
}

/**
 * Finds the global conda activation script for the given conda installation
 * @param condaPath The path to the conda executable
 * @returns The path to the global activation script if it exists, undefined otherwise
 *
 * On Windows, this will look for 'Scripts/activate.bat'
 * On Unix systems, this will look for 'bin/activate'
 */
export async function findGlobalSourcingScript(condaFolder: string): Promise<string | undefined> {
    const sourcingScript = isWindows()
        ? path.join(condaFolder, 'Scripts', 'activate.bat')
        : path.join(condaFolder, 'bin', 'activate');

    if (await fse.pathExists(sourcingScript)) {
        traceInfo(`Found global conda sourcing script at: ${sourcingScript}`);
        return sourcingScript;
    } else {
        traceInfo(`No global conda sourcing script found.  at: ${sourcingScript}`);
        return undefined;
    }
}

export async function findShellSourcingScripts(sourcingStatus: CondaSourcingStatus): Promise<string[]> {
    const logs: string[] = [];
    logs.push('=== Conda Sourcing Shell Script Search ===');

    let ps1Script: string | undefined;
    let shScript: string | undefined;
    let cmdActivate: string | undefined;

    try {
        // Search for PowerShell hook script (conda-hook.ps1)
        logs.push('Searching for PowerShell hook script...');
        try {
            ps1Script = await getCondaHookPs1Path(sourcingStatus.condaFolder);
            logs.push(`  Path: ${ps1Script ?? '✗ Not found'}`);
        } catch (err) {
            logs.push(
                `  Error during PowerShell script search: ${err instanceof Error ? err.message : 'Unknown error'}`,
            );
        }

        // Search for Shell script (conda.sh)
        logs.push('\nSearching for Shell script...');
        try {
            shScript = await getCondaShPath(sourcingStatus.condaFolder);
            logs.push(`  Path: ${shScript ?? '✗ Not found'}`);
        } catch (err) {
            logs.push(`  Error during Shell script search: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }

        // Search for Windows CMD script (activate.bat)
        logs.push('\nSearching for Windows CMD script...');
        try {
            cmdActivate = await getCondaBatActivationFile(sourcingStatus.condaPath);
            logs.push(`  Path: ${cmdActivate ?? '✗ Not found'}`);
        } catch (err) {
            logs.push(`  Error during CMD script search: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    } catch (error) {
        logs.push(`\nCritical error during script search: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        logs.push('\nSearch Summary:');
        logs.push(`  PowerShell: ${ps1Script ? '✓' : '✗'}`);
        logs.push(`  Shell: ${shScript ? '✓' : '✗'}`);
        logs.push(`  CMD: ${cmdActivate ? '✓' : '✗'}`);
        logs.push('============================');

        // Log everything at once
        traceVerbose(logs.join('\n'));
    }

    return [ps1Script, shScript, cmdActivate] as string[];
}

/**
 * Returns the best guess path to conda-hook.ps1 given a conda executable path.
 *
 * Searches for conda-hook.ps1 in these locations (relative to the conda root):
 *   - shell/condabin/
 *   - Library/shell/condabin/
 *   - condabin/
 *   - etc/profile.d/
 */
export async function getCondaHookPs1Path(condaFolder: string): Promise<string | undefined> {
    // Create the promise for finding the hook path
    const hookPathPromise = (async () => {
        const condaRootCandidates: string[] = [
            path.join(condaFolder, 'shell', 'condabin'),
            path.join(condaFolder, 'Library', 'shell', 'condabin'),
            path.join(condaFolder, 'condabin'),
            path.join(condaFolder, 'etc', 'profile.d'),
        ];

        const checks = condaRootCandidates.map(async (hookSearchDir) => {
            const candidate = path.join(hookSearchDir, 'conda-hook.ps1');
            if (await fse.pathExists(candidate)) {
                traceInfo(`Conda hook found at: ${candidate}`);
                return candidate;
            }
            return undefined;
        });
        const results = await Promise.all(checks);
        const found = results.find(Boolean);
        if (found) {
            return found as string;
        }
        return undefined;
    })();

    return hookPathPromise;
}

/**
 * Helper function that checks for a file in a list of locations.
 * Returns the first location where the file exists, or undefined if not found.
 */
async function findFileInLocations(locations: string[], description: string): Promise<string | undefined> {
    for (const location of locations) {
        if (await fse.pathExists(location)) {
            traceInfo(`${description} found in ${location}`);
            return location;
        }
    }
    return undefined;
}

/**
 * Returns the path to conda.sh given a conda executable path.
 *
 * Searches for conda.sh in these locations (relative to the conda root):
 * - etc/profile.d/conda.sh
 * - shell/etc/profile.d/conda.sh
 * - Library/etc/profile.d/conda.sh
 * - lib/pythonX.Y/site-packages/conda/shell/etc/profile.d/conda.sh
 * - site-packages/conda/shell/etc/profile.d/conda.sh
 * Also checks some system-level locations
 */
async function getCondaShPath(condaFolder: string): Promise<string | undefined> {
    // Create the promise for finding the conda.sh path
    const shPathPromise = (async () => {
        // First try standard conda installation locations
        const standardLocations = [
            path.join(condaFolder, 'etc', 'profile.d', 'conda.sh'),
            path.join(condaFolder, 'shell', 'etc', 'profile.d', 'conda.sh'),
            path.join(condaFolder, 'Library', 'etc', 'profile.d', 'conda.sh'),
        ];

        // Check standard locations first
        const standardLocation = await findFileInLocations(standardLocations, 'conda.sh');
        if (standardLocation) {
            return standardLocation;
        }

        // If not found in standard locations, try pip install locations
        // First, find all python* directories in lib
        let pythonDirs: string[] = [];
        const libPath = path.join(condaFolder, 'lib');
        try {
            const dirs = await fse.readdir(libPath);
            pythonDirs = dirs.filter((dir) => dir.startsWith('python'));
        } catch (err) {
            traceVerbose(`No lib directory found at ${libPath}, ${err}`);
        }

        const pipInstallLocations = [
            ...pythonDirs.map((ver) =>
                path.join(condaFolder, 'lib', ver, 'site-packages', 'conda', 'shell', 'etc', 'profile.d', 'conda.sh'),
            ),
            path.join(condaFolder, 'site-packages', 'conda', 'shell', 'etc', 'profile.d', 'conda.sh'),
        ];

        // Check pip install locations
        const pipLocation = await findFileInLocations(pipInstallLocations, 'conda.sh');
        if (pipLocation) {
            traceError(
                'WARNING: conda.sh was found in a pip install location. ' +
                    'This is not a supported configuration and may be deprecated in the future. ' +
                    'Please install conda in a standard location. ' +
                    'See https://docs.conda.io/projects/conda/en/latest/user-guide/install/index.html for proper installation instructions.',
            );
            return pipLocation;
        }
        return undefined;
    })();

    return shPathPromise;
}

/**
 * Returns the path to the Windows batch activation file (activate.bat) for conda
 * @param condaPath The path to the conda executable
 * @returns The path to activate.bat if it exists in the same directory as conda.exe, undefined otherwise
 *
 * This file is used specifically for CMD.exe activation on Windows systems.
 * It should be located in the same directory as the conda executable.
 */
async function getCondaBatActivationFile(condaPath: string): Promise<string | undefined> {
    const cmdActivate = path.join(path.dirname(condaPath), 'activate.bat');
    if (await fse.pathExists(cmdActivate)) {
        return cmdActivate;
    }
    return undefined;
}

/**
 * Returns the path to the local conda activation script
 * @param condaPath The path to the conda executable
 * @returns Promise that resolves to:
 *          - The path to the local 'activate' script if it exists in the same directory as conda
 *          - undefined if the script is not found
 *
 * This function checks for a local 'activate' script in the same directory as the conda executable.
 * This script is used for direct conda activation without shell-specific configuration.
 */

const knownSourcingScriptCache: string[] = [];
export async function getLocalActivationScript(condaPath: string): Promise<string | undefined> {
    // Define all possible paths to check
    const paths = [
        // Direct path
        isWindows() ? path.join(condaPath, 'Scripts', 'activate') : path.join(condaPath, 'bin', 'activate'),
        // One level up
        isWindows()
            ? path.join(path.dirname(condaPath), 'Scripts', 'activate')
            : path.join(path.dirname(condaPath), 'bin', 'activate'),
        // Two levels up
        isWindows()
            ? path.join(path.dirname(path.dirname(condaPath)), 'Scripts', 'activate')
            : path.join(path.dirname(path.dirname(condaPath)), 'bin', 'activate'),
    ];

    // Check each path in sequence
    for (const sourcingScript of paths) {
        // Check if any of the paths are in the cache
        if (knownSourcingScriptCache.includes(sourcingScript)) {
            traceVerbose(`Found local activation script in cache at: ${sourcingScript}`);
            return sourcingScript;
        }
        try {
            const exists = await fse.pathExists(sourcingScript);
            if (exists) {
                traceInfo(`Found local activation script at: ${sourcingScript}, adding to cache.`);
                knownSourcingScriptCache.push(sourcingScript);
                return sourcingScript;
            }
        } catch (err) {
            traceError(`Error checking for local activation script at ${sourcingScript}: ${err}`);
            continue;
        }
    }

    traceVerbose('No local activation script found in any of the expected locations');
    return undefined;
}
