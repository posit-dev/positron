/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { traceError, traceInfo, traceVerbose } from '../../../logging';
import { exec } from '../externalDependencies';
import { isUvInstalled } from './uv';
import { Common, InterpreterQuickPickList } from '../../../common/utils/localize';
import { MINIMUM_PYTHON_VERSION, MAXIMUM_PYTHON_VERSION_EXCLUSIVE } from '../../../common/constants';
import { getWorkspaceFolders } from '../../../common/vscodeApis/workspaceApis';
import { createUvVenv } from '../../creation/provider/uvCreationProvider';

/** Regex to extract version from uv python list output (e.g., "cpython-3.13.1-macos-aarch64-none" or "cpython-3.14.0a5-macos-aarch64-none") */
const UV_VERSION_REGEX = /cpython-(\d+\.\d+\.\d+(?:a|b|rc)?\d*)/i;

/** Regex to check if a version string is a pre-release (alpha, beta, or release candidate) */
const PRERELEASE_REGEX = /\d+\.\d+\.\d+(a|b|rc)\d+/i;

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
    /** The raw identifier from uv (e.g., "cpython-3.13.1-macos-aarch64-none") */
    identifier: string;
}

/**
 * Gets the command to install uv based on the current platform.
 * @returns Shell command string to install uv
 */
function getUvInstallCommand(): string {
    if (process.platform === 'win32') {
        return 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"';
    }
    return 'curl -LsSf https://astral.sh/uv/install.sh | sh';
}

/**
 * Installs uv using the official installer script.
 * @returns true if installation succeeded, false otherwise
 */
async function installUv(): Promise<boolean> {
    traceInfo('Installing uv...');

    const command = getUvInstallCommand();
    traceVerbose(`Running uv install command: ${command}`);

    try {
        if (process.platform === 'win32') {
            await exec('powershell', [
                '-ExecutionPolicy',
                'ByPass',
                '-c',
                'irm https://astral.sh/uv/install.ps1 | iex',
            ]);
        } else {
            await exec('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh']);
        }
        traceInfo('uv installed successfully');
        return true;
    } catch (error) {
        traceError(`Failed to install uv: ${error}`);
        return false;
    }
}

/**
 * Gets a list of available Python versions from uv.
 * Filters out pre-release versions and returns stable versions only.
 * @returns Array of available Python versions, sorted by version descending
 */
export async function getAvailablePythonVersions(): Promise<UvAvailablePython[]> {
    try {
        // Use `uv python list` to get available versions
        // Output format:
        //   cpython-3.13.1-macos-aarch64-none     /Users/.../.local/share/uv/python/cpython-3.13.1.../bin/python3.13
        //   cpython-3.12.8-macos-aarch64-none     <download available>
        const result = await exec('uv', ['python', 'list'], { throwOnStdErr: false });
        const output = result?.stdout.trim();

        if (!output) {
            return [];
        }

        const lines = output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        const versions: UvAvailablePython[] = [];
        const seenMinorVersions = new Set<string>();

        for (const line of lines) {
            // Skip non-cpython entries (e.g., pypy)
            if (!line.startsWith('cpython-')) {
                continue;
            }

            const versionMatch = line.match(UV_VERSION_REGEX);
            if (!versionMatch) {
                continue;
            }

            const version = versionMatch[1];

            // Skip pre-release versions
            if (PRERELEASE_REGEX.test(version)) {
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

            // Only show one entry per minor version
            if (seenMinorVersions.has(minorVersion)) {
                continue;
            }
            seenMinorVersions.add(minorVersion);

            // Extract the identifier (first column)
            const columns = line.split(/\s{2,}/);
            const identifier = columns[0].trim();

            // Check if installed (has a path, not "<download available>")
            const isInstalled = !line.includes('<download available>');

            let path: string | undefined;
            if (isInstalled && columns.length >= 2) {
                let pathColumn = columns[1].trim();
                // Strip " -> ..." symlink suffix if present
                const arrowIndex = pathColumn.indexOf(' -> ');
                if (arrowIndex !== -1) {
                    pathColumn = pathColumn.substring(0, arrowIndex);
                }
                if (pathColumn.length > 0) {
                    path = pathColumn;
                }
            }

            versions.push({
                version: minorVersion,
                isInstalled,
                path,
                identifier,
            });
        }

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
    } catch (error) {
        traceError(`Failed to get available Python versions: ${error}`);
        return [];
    }
}

/**
 * Installs a Python version using uv.
 * @param version The version to install (e.g., "3.13.1" or "3.13")
 * @returns The path to the installed Python, or undefined if installation failed
 */
async function installPythonVersion(version: string): Promise<string | undefined> {
    traceInfo(`Installing Python ${version} via uv...`);

    try {
        await exec('uv', ['python', 'install', version], { throwOnStdErr: false });
        traceInfo(`Python ${version} installed successfully`);

        // Get the path to the installed Python
        const result = await exec('uv', ['python', 'find', version], { throwOnStdErr: false });
        const pythonPath = result?.stdout.trim();

        if (pythonPath) {
            traceInfo(`Installed Python path: ${pythonPath}`);
            return pythonPath;
        }

        traceError('Could not find installed Python path');
        return undefined;
    } catch (error) {
        traceError(`Failed to install Python ${version}: ${error}`);
        return undefined;
    }
}

/**
 * Shows a quick pick for selecting a Python version to install.
 * @returns The selected version, or undefined if cancelled
 */
async function selectPythonVersion(): Promise<string | undefined> {
    const versions = await getAvailablePythonVersions();

    if (versions.length === 0) {
        vscode.window.showErrorMessage(InterpreterQuickPickList.UvInstall.noVersionsAvailable);
        return undefined;
    }

    interface VersionQuickPickItem extends vscode.QuickPickItem {
        version: string;
    }

    const items: VersionQuickPickItem[] = versions.map((v) => ({
        label: `Python ${v.version}`,
        description: v.isInstalled ? InterpreterQuickPickList.UvInstall.installed : undefined,
        detail: v.path,
        version: v.version,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: InterpreterQuickPickList.UvInstall.selectVersion,
        title: InterpreterQuickPickList.UvInstall.selectVersionTitle,
    });

    return selected?.version;
}

/**
 * Result of the Python installation process.
 */
export interface InstallPythonResult {
    /** Whether the installation was successful */
    success: boolean;
    /** The path to the installed Python, if successful */
    pythonPath?: string;
    /** Error message if installation failed */
    error?: string;
}

/**
 * Installs Python via uv and optionally creates a workspace venv.
 * Flow: install uv if needed -> pick version -> install Python -> offer venv creation
 */
export async function installPythonViaUv(): Promise<InstallPythonResult> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: InterpreterQuickPickList.UvInstall.installingPython },
        async (progress) => {
            try {
                // Install uv if needed
                if (!(await isUvInstalled())) {
                    progress.report({ message: InterpreterQuickPickList.UvInstall.installingUv });
                    if (!(await installUv())) {
                        return { success: false, error: InterpreterQuickPickList.UvInstall.uvInstallFailed };
                    }
                }

                // Select and install Python version
                progress.report({ message: InterpreterQuickPickList.UvInstall.selectingVersion });
                const version = await selectPythonVersion();
                if (!version) {
                    return { success: false, error: 'Cancelled' };
                }

                progress.report({ message: InterpreterQuickPickList.UvInstall.installingPythonVersion(version) });
                const pythonPath = await installPythonVersion(version);
                if (!pythonPath) {
                    return { success: false, error: InterpreterQuickPickList.UvInstall.installFailed(version) };
                }

                // Offer to create venv if workspace is open
                const workspaces = getWorkspaceFolders();
                if (workspaces && workspaces.length > 0) {
                    const createVenv = await vscode.window.showQuickPick(
                        [
                            { label: Common.bannerLabelYes, id: 'yes' },
                            { label: Common.bannerLabelNo, id: 'no' },
                        ],
                        { title: InterpreterQuickPickList.UvInstall.createVenvPrompt },
                    );

                    if (createVenv?.id === 'yes') {
                        progress.report({ message: InterpreterQuickPickList.UvInstall.creatingVenv });
                        const venvPython = await createUvVenv(workspaces[0], version, progress);
                        if (venvPython) {
                            vscode.window.showInformationMessage(InterpreterQuickPickList.UvInstall.venvCreated);
                            return { success: true, pythonPath: venvPython };
                        }
                    }
                }

                vscode.window.showInformationMessage(InterpreterQuickPickList.UvInstall.installSuccess(version));
                return { success: true, pythonPath };
            } catch (error) {
                traceError(`installPythonViaUv failed: ${error}`);
                return { success: false, error: String(error) };
            }
        },
    );
}
