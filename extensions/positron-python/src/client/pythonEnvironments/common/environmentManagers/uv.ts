/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { cache } from '../../../common/utils/decorators';
import { clearCache } from '../../../common/utils/cacheUtils';
import { traceError, traceVerbose } from '../../../logging';
import { exec, pathExists, readFile, resolveSymbolicLink } from '../externalDependencies';
import { isTestExecution, MINIMUM_PYTHON_VERSION, MAXIMUM_PYTHON_VERSION_EXCLUSIVE } from '../../../common/constants';
import { getPyvenvConfigPathsFrom } from './simplevirtualenvs';
import { splitLines } from '../../../common/stringUtils';
import { CreateEnv } from '../../../common/utils/localize';

/** Regex to extract version from uv python list output (e.g., "cpython-3.14.0a5-macos-aarch64-none") */
export const UV_VERSION_REGEX = /cpython-(\d+\.\d+\.\d+(?:a|b|rc)?\d*)/i;

/** Regex to check if a version string is a pre-release (alpha, beta, or release candidate) */
export const PRERELEASE_REGEX = /\d+\.\d+\.\d+(a|b|rc)\d+/i;

/** Check if a version string represents a pre-release version */
export function isVersionPrerelease(version: string): boolean {
    return PRERELEASE_REGEX.test(version);
}

/**
 * Runs a uv subcommand with color output disabled. uv honors FORCE_COLOR/CLICOLOR_FORCE
 * even when its stdout is piped (both are commonly set in CI), which wraps the paths and
 * tokens we parse in ANSI escape codes and corrupts them. `--color never` overrides
 * those env vars. See uvPackageManager, which passes the same flag to `uv pip` commands.
 */
export function execUv(
    command: string,
    args: string[],
    options: Parameters<typeof exec>[2] = {},
): ReturnType<typeof exec> {
    return exec(command, ['--color', 'never', ...args], options);
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

    public static resetCache(): void {
        UvUtils.uvPromise = undefined as unknown as Promise<UvUtils | undefined>;
    }

    private static async locate(): Promise<UvUtils | undefined> {
        // Probe `uv` on PATH first, then fall back to uv's known install locations.
        // The official installer drops the binary at ~/.local/bin/uv (or ~/.cargo/bin/uv)
        // and only updates shell rc files, so a freshly installed uv is not reachable on
        // the already-running extension host's PATH. Probing the known locations lets us
        // find it without waiting for a restart.
        for (const candidate of ['uv', ...UvUtils.knownInstallLocations()]) {
            // Absolute-path candidates come from known install locations; only probe ones
            // that actually exist on disk to avoid spawning processes for missing paths.
            if (path.isAbsolute(candidate) && !(await pathExists(candidate))) {
                continue;
            }
            traceVerbose(`Probing uv binary ${candidate}`);
            if (await UvUtils.canRun(candidate)) {
                traceVerbose(`Found uv binary ${candidate}`);
                return new UvUtils(candidate);
            }
        }
        traceVerbose(`No uv binary found`);
        return undefined;
    }

    /** Default locations the official uv installer writes the binary to. */
    private static knownInstallLocations(): string[] {
        const home = os.homedir();
        const binary = process.platform === 'win32' ? 'uv.exe' : 'uv';
        return [path.join(home, '.local', 'bin', binary), path.join(home, '.cargo', 'bin', binary)];
    }

    /**
     * Probes whether the given uv command is runnable. Runs `uv python dir` directly
     * rather than through the cached `getUvDir()`, whose cache key ignores the command
     * and would otherwise return a stale result across candidate probes.
     */
    private static async canRun(command: string): Promise<boolean> {
        try {
            const result = await execUv(command, ['python', 'dir'], { throwOnStdErr: true });
            return result?.stdout.trim() !== undefined;
        } catch (ex) {
            traceVerbose(ex);
            return false;
        }
    }

    @cache(-1)
    public async getUvDir(): Promise<string | undefined> {
        try {
            const result = await execUv(this.command, ['python', 'dir'], { throwOnStdErr: true });
            return result?.stdout.trim();
        } catch (ex) {
            traceVerbose(ex);
            return undefined;
        }
    }

    @cache(-1)
    public async getUvBinDir(): Promise<string | undefined> {
        try {
            const result = await execUv(this.command, ['python', 'dir', '--bin'], { throwOnStdErr: true });
            return result?.stdout.trim();
        } catch (ex) {
            traceVerbose(ex);
            return undefined;
        }
    }
}

/**
 * Resets all uv-related caches so that a newly installed uv can be detected.
 * Call this after installing uv.
 */
export function resetUvCache(): void {
    clearCache();
    UvUtils.resetCache();
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
 * Check if running on Windows ARM64.
 * On Windows ARM64, uv defaults to x64 Python which causes architecture mismatch warnings.
 * See: https://github.com/astral-sh/uv/issues/12906
 */
export function isWindowsArm64(): boolean {
    return process.platform === 'win32' && os.arch() === 'arm64';
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
 * Extracts the interpreter path from a `uv python list` output line, stripping any
 * " -> ..." symlink suffix. Returns undefined for "<download available>" rows or lines
 * without a path column.
 *   "cpython-3.13.7-macos-aarch64-none   /usr/local/bin/python3.13 -> ..." -> "/usr/local/bin/python3.13"
 *   "cpython-3.13.7-windows-x86_64-none  C:\\Program Files\\Python\\python.exe"
 */
function parseUvPythonPath(line: string): string | undefined {
    if (line.includes('<download available>')) {
        return undefined;
    }
    // Columns are separated by 2+ spaces; the path is the second column.
    const pathColumn = line
        .split(/\s{2,}/)[1]
        ?.trim()
        .split(' -> ')[0]
        .trim();
    return pathColumn || undefined;
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
        const result = await execUv(uvUtils.command, ['python', 'list', requestedVersion], { throwOnStdErr: false });
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

        return {
            version,
            isPrerelease,
            path: parseUvPythonPath(selectedLine),
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
        await execUv(uvUtils.command, ['self', 'update'], { throwOnStdErr: false });
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
        await execUv(uvUtils.command, ['python', 'install', version], { throwOnStdErr: false });
        traceVerbose(`uv python install ${version} completed successfully`);
        return true;
    } catch (ex) {
        traceVerbose(`Error running uv python install: ${ex}`);
        return false;
    }
}

/**
 * Result of attempting to get a stable Python version after updating uv.
 */
export type GetStablePythonResult =
    | { success: true; version: string; wasInstalled: boolean }
    | { success: false; error: 'update_failed' | 'install_failed' | 'no_stable_version'; version?: string };

/**
 * Updates uv and attempts to find/install a stable Python version.
 * This handles the flow: update uv -> check for stable -> install if needed.
 *
 * @param requestedVersion The version requested (e.g., "3.14", "3.13")
 * @param onProgress Optional callback for progress updates
 * @returns Result indicating success with version info, or failure with error type
 */
export async function getStablePythonAfterUpdate(
    requestedVersion: string,
    onProgress?: (message: string) => void,
): Promise<GetStablePythonResult> {
    // Update uv
    onProgress?.(CreateEnv.Uv.updatingUv);
    traceVerbose('Running uv self update...');
    const updateSuccess = await updateUv();
    if (!updateSuccess) {
        traceError('Failed to update uv');
        return { success: false, error: 'update_failed' };
    }
    traceVerbose('uv updated successfully, checking for stable Python version...');

    // Look for a stable version, skipping local pre-releases
    const stableVersionInfo = await getUvPythonVersionInfo(requestedVersion, {
        skipLocalPrereleases: true,
    });

    if (!stableVersionInfo || stableVersionInfo.isPrerelease) {
        // No stable version available
        traceError(
            `No stable Python version available for ${requestedVersion}, only pre-release ${
                stableVersionInfo?.version ?? 'unknown'
            }`,
        );
        return { success: false, error: 'no_stable_version', version: stableVersionInfo?.version };
    }

    // Found a stable version - install it if not already local
    if (!stableVersionInfo.path) {
        onProgress?.(CreateEnv.Uv.installingPython(stableVersionInfo.version));
        traceVerbose(`Installing Python ${stableVersionInfo.version}...`);
        const installSuccess = await installUvPython(stableVersionInfo.version);
        if (!installSuccess) {
            traceError(`Failed to install Python ${stableVersionInfo.version}`);
            return { success: false, error: 'install_failed', version: stableVersionInfo.version };
        }
        traceVerbose(`Using stable Python ${stableVersionInfo.version}`);
        return { success: true, version: stableVersionInfo.version, wasInstalled: true };
    }

    traceVerbose(`Using existing stable Python ${stableVersionInfo.version}`);
    return { success: true, version: stableVersionInfo.version, wasInstalled: false };
}

/**
 * Information about an available Python version from uv.
 */
export interface UvAvailablePython {
    /** The version string in MAJOR.MINOR format (e.g., "3.13") */
    version: string;
    /** Whether this version is already installed locally */
    isInstalled: boolean;
    /** The path to the Python executable if installed */
    path?: string;
    /** The raw identifier from uv (e.g., "cpython-3.13.1-macos-aarch64-none"), needed for Windows ARM64 */
    identifier: string;
}

/**
 * Gets a list of available Python versions from uv.
 * Filters out pre-release versions and returns stable versions only.
 * @returns Array of available Python versions, sorted by version descending
 */
export async function getAvailablePythonVersions(): Promise<UvAvailablePython[]> {
    const uvUtils = await UvUtils.getUvUtils();
    if (!uvUtils) {
        return [];
    }

    try {
        // Use `uv python list` to get available versions
        // Output format:
        //   cpython-3.13.1-macos-aarch64-none     /Users/.../.local/share/uv/python/cpython-3.13.1.../bin/python3.13
        //   cpython-3.12.8-macos-aarch64-none     <download available>
        // --managed-python restricts the listing to uv-managed Pythons. This still includes the
        // "<download available>" rows for installable versions, but excludes system Pythons (e.g.
        // /usr/bin/python3, Homebrew). For this "Install Python via uv" flow, only uv-managed
        // installs should count as already installed; a system Python is shown as installable.
        // On Windows ARM64, use --all-arches to see ARM64 builds (uv defaults to x64)
        // See: https://github.com/astral-sh/uv/issues/12906
        const args = isWindowsArm64()
            ? ['python', 'list', '--managed-python', '--all-arches']
            : ['python', 'list', '--managed-python'];
        const result = await execUv(uvUtils.command, args, { throwOnStdErr: false });
        const output = result?.stdout.trim();

        if (!output) {
            return [];
        }

        const lines = output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        // Keyed by minor version (e.g. "3.13") so we keep one entry per minor version.
        const versionsByMinor = new Map<string, UvAvailablePython>();

        // On Windows ARM64, we use --all-arches which returns both x64 and arm64 versions.
        // We need to prefer arm64 versions. The identifier contains the arch, e.g.:
        //   cpython-3.13.1-windows-x86_64-none
        //   cpython-3.13.1-windows-aarch64-none (ARM64)
        const preferArm64 = isWindowsArm64();

        for (const line of lines) {
            // Skip non-cpython entries (e.g., pypy)
            if (!line.startsWith('cpython-')) {
                continue;
            }

            // On Windows ARM64, skip x86_64 versions if we're looking for ARM64
            if (preferArm64 && line.includes('-x86_64-')) {
                continue;
            }

            const versionMatch = line.match(UV_VERSION_REGEX);
            if (!versionMatch) {
                continue;
            }

            const version = versionMatch[1];

            // Skip pre-release versions
            if (isVersionPrerelease(version)) {
                continue;
            }

            // Extract major.minor version (e.g., "3.13" from "3.13.1")
            const versionParts = version.split('.').map(Number);
            const majorVersion = versionParts[0];
            const minorVersionNum = versionParts[1];

            // Skip versions below minimum supported
            if (
                majorVersion < MINIMUM_PYTHON_VERSION.major ||
                (majorVersion === MINIMUM_PYTHON_VERSION.major && minorVersionNum < MINIMUM_PYTHON_VERSION.minor)
            ) {
                continue;
            }

            // Skip versions at or above maximum supported (exclusive)
            if (
                majorVersion > MAXIMUM_PYTHON_VERSION_EXCLUSIVE.major ||
                (majorVersion === MAXIMUM_PYTHON_VERSION_EXCLUSIVE.major &&
                    minorVersionNum >= MAXIMUM_PYTHON_VERSION_EXCLUSIVE.minor)
            ) {
                continue;
            }

            const minorVersion = `${majorVersion}.${minorVersionNum}`;

            // Extract the identifier (first column)
            const identifier = line.split(/\s{2,}/)[0].trim();

            // Check if installed (has a path, not "<download available>")
            const isInstalled = !line.includes('<download available>');

            const pythonPath = parseUvPythonPath(line);

            // Only keep one entry per minor version. uv lists patches newest-first, so the
            // first entry for a minor version is often a newer "<download available>" patch
            // while an older patch of the same minor version is actually installed. Prefer the
            // installed entry (and its path) so the quick pick reflects what is really installed.
            const existing = versionsByMinor.get(minorVersion);
            if (existing) {
                if (!existing.isInstalled && isInstalled) {
                    existing.isInstalled = true;
                    existing.path = pythonPath;
                }
                continue;
            }

            versionsByMinor.set(minorVersion, {
                version: minorVersion,
                isInstalled,
                path: pythonPath,
                identifier,
            });
        }

        const versions = Array.from(versionsByMinor.values());

        // Sort by version descending (newest first)
        versions.sort((a, b) => {
            const aParts = a.version.split('.').map(Number);
            const bParts = b.version.split('.').map(Number);

            // Compare major version
            if (aParts[0] !== bParts[0]) {
                return bParts[0] - aParts[0];
            }
            // Compare minor version
            if (aParts[1] !== bParts[1]) {
                return bParts[1] - aParts[1];
            }
            return 0;
        });

        return versions;
    } catch (ex) {
        traceVerbose(`Failed to get available Python versions: ${ex}`);
        return [];
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
