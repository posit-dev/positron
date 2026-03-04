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
 * Checks what Python version uv would install for a given version request.
 * Uses `uv python find` to determine the version without actually installing.
 * @param requestedVersion The version requested (e.g., "3.14", "3.13")
 * @returns Information about the Python version, or undefined if not found
 */
export async function getUvPythonVersionInfo(requestedVersion: string): Promise<UvPythonVersionInfo | undefined> {
    const uvUtils = await UvUtils.getUvUtils();
    if (!uvUtils) {
        return undefined;
    }

    try {
        // Use `uv python find` to see what version would be used
        const result = await exec(uvUtils.command, ['python', 'find', requestedVersion], { throwOnStdErr: false });
        const pythonPath = result?.stdout.trim();

        if (!pythonPath) {
            return undefined;
        }

        // Extract version from the path (e.g., "cpython-3.14.0a5-macos-aarch64-none")
        // The path typically contains the version in a format like:
        // /Users/.../uv/python/cpython-3.14.0a5-macos-aarch64-none/bin/python
        const versionMatch = pythonPath.match(/cpython-(\d+\.\d+\.\d+(?:a|b|rc)?\d*)/i);
        let version = requestedVersion;

        if (versionMatch) {
            version = versionMatch[1];
        } else {
            // Try to get the version by running the Python executable
            try {
                const versionResult = await exec(pythonPath, ['--version'], { throwOnStdErr: false });
                const versionOutput = versionResult?.stdout.trim() || versionResult?.stderr.trim();
                // Output format: "Python 3.14.0a5"
                const match = versionOutput?.match(/Python\s+(\d+\.\d+\.\d+(?:a|b|rc)?\d*)/i);
                if (match) {
                    version = match[1];
                }
            } catch (ex) {
                traceVerbose(`Could not get Python version from executable: ${ex}`);
            }
        }

        // Check if it's a pre-release (contains 'a' for alpha, 'b' for beta, or 'rc' for release candidate)
        const isPrerelease = /\d+\.\d+\.\d+(a|b|rc)\d+/i.test(version);

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
