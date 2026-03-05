/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import { cache } from '../../../common/utils/decorators';
import { traceVerbose } from '../../../logging';
import { exec, pathExists, readFile, resolveSymbolicLink } from '../externalDependencies';
import { isTestExecution } from '../../../common/constants';
import { getPyvenvConfigPathsFrom } from './simplevirtualenvs';
import { splitLines } from '../../../common/stringUtils';

/** Regex to extract version from uv python list output (e.g., "cpython-3.14.0a5-macos-aarch64-none") */
const UV_VERSION_REGEX = /cpython-(\d+\.\d+\.\d+(?:a|b|rc)?\d*)/i;

/** Regex to check if a version string is a pre-release (alpha, beta, or release candidate) */
const PRERELEASE_REGEX = /\d+\.\d+\.\d+(a|b|rc)\d+/i;

/** Check if a version string represents a pre-release version */
function isVersionPrerelease(version: string): boolean {
    return PRERELEASE_REGEX.test(version);
}

/** Wraps the "uv" utility, and exposes its functionality. */
class UvUtils {
    private static uvPromise: Promise<UvUtils | undefined>;

    constructor(public readonly command: string) {}

    public static async getUvUtils(): Promise<UvUtils | undefined> {
        if (UvUtils.uvPromise === undefined || isTestExecution()) {
            UvUtils.uvPromise = UvUtils.locate();
        }
        return UvUtils.uvPromise;
    }

    private static async locate(): Promise<UvUtils | undefined> {
        const uvPath = 'uv';
        traceVerbose(`Probing uv binary ${uvPath}`);
        const uv = new UvUtils(uvPath);
        const uvDir = await uv.getUvDir();
        if (uvDir !== undefined) {
            traceVerbose(`Found uv binary ${uvPath}`);
            return uv;
        }
        traceVerbose(`No uv binary found`);
        return undefined;
    }

    @cache(-1)
    public async getUvDir(): Promise<string | undefined> {
        try {
            const result = await exec(this.command, ['python', 'dir'], { throwOnStdErr: true });
            return result?.stdout.trim();
        } catch (ex) {
            traceVerbose(ex);
            return undefined;
        }
    }

    @cache(-1)
    public async getUvBinDir(): Promise<string | undefined> {
        try {
            const result = await exec(this.command, ['python', 'dir', '--bin'], { throwOnStdErr: true });
            return result?.stdout.trim();
        } catch (ex) {
            traceVerbose(ex);
            return undefined;
        }
    }
}

/**
 * Checks if the given interpreter belongs to a uv-managed environment.
 * @param interpreterPath Absolute path to the python interpreter.
 * @returns {boolean} Returns true if the interpreter belongs to a uv environment.
 */
export async function isUvEnvironment(interpreterPath: string): Promise<boolean> {
    const uvUtils = await UvUtils.getUvUtils();
    if (!uvUtils) {
        return false;
    }

    const uvDir = await uvUtils.getUvDir();
    if (!uvDir) {
        return false;
    }

    // Check if interpreter is directly in the uv directory
    const normalizedInterpreterPath = path.normalize(interpreterPath);
    const normalizedUvDir = path.normalize(uvDir);
    if (normalizedInterpreterPath.startsWith(normalizedUvDir)) {
        return true;
    }

    // Check if it's a symlink pointing to the uv directory
    try {
        const resolvedPath = await resolveSymbolicLink(interpreterPath);
        if (
            resolvedPath &&
            resolvedPath !== interpreterPath &&
            path.normalize(resolvedPath).startsWith(normalizedUvDir)
        ) {
            return true;
        }
    } catch (ex) {
        traceVerbose(ex);
    }

    // Check if there's a pyvenv.cfg file with a uv key
    const configPaths = getPyvenvConfigPathsFrom(interpreterPath);
    for (const configPath of configPaths) {
        if (await pathExists(configPath)) {
            try {
                const content = await readFile(configPath);
                const lines = splitLines(content);

                for (const line of lines) {
                    const parts = line.split('=');
                    if (parts.length === 2) {
                        const key = parts[0].toLowerCase().trim();
                        if (key === 'uv') {
                            return true;
                        }
                    }
                }
            } catch (ex) {
                traceVerbose(`Error reading pyvenv.cfg: ${ex}`);
            }
        }
    }

    return false;
}

/**
 * Checks if uv is installed.
 * @returns {boolean} Returns true if uv is installed.
 */
export async function isUvInstalled(): Promise<boolean> {
    const uvUtils = await UvUtils.getUvUtils();
    return uvUtils !== undefined;
}

/**
 * Information about a Python version that uv would install.
 */
export interface UvPythonVersionInfo {
    /** The full version string (e.g., "3.14.0a5") */
    version: string;
    /** Whether this is a pre-release version (alpha, beta, or release candidate) */
    isPrerelease: boolean;
    /** The path to the Python executable */
    path?: string;
}

/**
 * Options for getUvPythonVersionInfo
 */
export interface GetUvPythonVersionInfoOptions {
    /** If true, skip local pre-release versions and prefer downloadable stable versions */
    skipLocalPrereleases?: boolean;
}

/**
 * Checks what Python version uv would install for a given version request.
 * Uses `uv python list` to see available versions without actually installing.
 * @param requestedVersion The version requested (e.g., "3.14", "3.13")
 * @param options Options for version lookup
 * @returns Information about the Python version, or undefined if not found
 */
export async function getUvPythonVersionInfo(
    requestedVersion: string,
    options?: GetUvPythonVersionInfoOptions,
): Promise<UvPythonVersionInfo | undefined> {
    const uvUtils = await UvUtils.getUvUtils();
    if (!uvUtils) {
        return undefined;
    }

    try {
        // Use `uv python list VERSION` to see available versions
        // Output format:
        //   cpython-3.15.0a6-macos-aarch64-none    <download available>
        //   cpython-3.13.7-macos-aarch64-none     /usr/local/bin/python3.13 -> ...
        const result = await exec(uvUtils.command, ['python', 'list', requestedVersion], { throwOnStdErr: false });
        const output = result?.stdout.trim();

        if (!output) {
            return undefined;
        }

        const lines = output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length === 0) {
            return undefined;
        }

        // Helper to check if a line represents a pre-release version
        const isLinePrerelease = (line: string): boolean => {
            const match = line.match(UV_VERSION_REGEX);
            return match ? isVersionPrerelease(match[1]) : false;
        };

        // Find the appropriate version based on options
        let selectedLine: string;
        if (options?.skipLocalPrereleases) {
            // When skipping local pre-releases, prefer:
            // 1. First local stable version
            // 2. First downloadable stable version
            // 3. Fall back to first line (may be pre-release)
            const localStableLine = lines.find(
                (line) => !line.includes('<download available>') && !isLinePrerelease(line),
            );
            const downloadableStableLine = lines.find(
                (line) => line.includes('<download available>') && !isLinePrerelease(line),
            );
            selectedLine = localStableLine ?? downloadableStableLine ?? lines[0];
        } else {
            // Default behavior: prefer local versions
            const localLine = lines.find((line) => !line.includes('<download available>'));
            selectedLine = localLine ?? lines[0];
        }

        // Format: "cpython-3.15.0a6-macos-aarch64-none    <download available>"
        // or:     "cpython-3.13.7-macos-aarch64-none     /usr/local/bin/python3.13 -> ..."
        const versionMatch = selectedLine.match(UV_VERSION_REGEX);
        if (!versionMatch) {
            traceVerbose(`Could not parse version from uv python list output: ${selectedLine}`);
            return undefined;
        }
        const version = versionMatch[1];

        const isPrerelease = isVersionPrerelease(version);

        // Check if this version is locally installed
        const isLocal = !selectedLine.includes('<download available>');

        // Extract path if this is a local install
        let pythonPath: string | undefined;
        if (isLocal) {
            // Extract path from format like:
            //   "cpython-3.13.7-macos-aarch64-none     /usr/local/bin/python3.13 -> ..."
            //   "cpython-3.13.7-windows-x86_64-none   C:\Program Files\Python\python.exe"
            // Split on 2+ spaces to separate columns, then strip " -> ..." suffix
            const columns = selectedLine.split(/\s{2,}/);
            if (columns.length >= 2) {
                let pathColumn = columns[1].trim();
                const arrowIndex = pathColumn.indexOf(' -> ');
                if (arrowIndex !== -1) {
                    pathColumn = pathColumn.substring(0, arrowIndex);
                }
                if (pathColumn.length > 0) {
                    pythonPath = pathColumn;
                }
            }
        }

        return {
            version,
            isPrerelease,
            path: pythonPath,
        };
    } catch (ex) {
        traceVerbose(`Error checking uv Python version: ${ex}`);
        return undefined;
    }
}

/**
 * Runs `uv self update` to update uv to the latest version.
 * @returns true if the update succeeded, false otherwise
 */
export async function updateUv(): Promise<boolean> {
    const uvUtils = await UvUtils.getUvUtils();
    if (!uvUtils) {
        return false;
    }

    try {
        traceVerbose('Running uv self update...');
        await exec(uvUtils.command, ['self', 'update'], { throwOnStdErr: false });
        traceVerbose('uv self update completed successfully');
        return true;
    } catch (ex) {
        traceVerbose(`Error running uv self update: ${ex}`);
        return false;
    }
}

/**
 * Installs a Python version using uv.
 * @param version The version to install (e.g., "3.13.7", "3.14")
 * @returns true if the installation succeeded, false otherwise
 */
export async function installUvPython(version: string): Promise<boolean> {
    const uvUtils = await UvUtils.getUvUtils();
    if (!uvUtils) {
        return false;
    }

    try {
        traceVerbose(`Running uv python install ${version}...`);
        await exec(uvUtils.command, ['python', 'install', version], { throwOnStdErr: false });
        traceVerbose(`uv python install ${version} completed successfully`);
        return true;
    } catch (ex) {
        traceVerbose(`Error running uv python install: ${ex}`);
        return false;
    }
}

/**
 * Find all places uv puts global interpreters. These can differ by OS and env vars.
 * @returns {Set<string>} Set of directories where uv interpreters are located.
 */
export async function getUvDirs(): Promise<Set<string>> {
    const dirs = new Set<string>();
    const uvUtils = await UvUtils.getUvUtils();
    if (!uvUtils) {
        return dirs;
    }

    const [uvBinDir, uvDir] = await Promise.all([uvUtils.getUvBinDir(), uvUtils.getUvDir()]);
    if (uvBinDir) {
        dirs.add(uvBinDir);
    }
    if (uvDir) {
        dirs.add(uvDir);
        // Recurse one level deeper to include any subdirectories that might contain interpreters
        try {
            const entries = await fs.promises.readdir(uvDir, { withFileTypes: true });
            const subdirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(uvDir, entry.name));
            for (const subdir of subdirs) {
                dirs.add(subdir);
            }
        } catch (ex) {
            traceVerbose(`Error listing uv subdirectories: ${ex}`);
        }
    }
    return dirs;
}
