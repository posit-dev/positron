/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { traceError, traceInfo } from '../../../logging';
import { exec } from '../externalDependencies';
import { isUvInstalled, getAvailablePythonVersions, resetUvCache } from './uv';
import { Common, InterpreterQuickPickList } from '../../../common/utils/localize';
import { getWorkspaceFolders } from '../../../common/vscodeApis/workspaceApis';
import { createUvVenv } from '../../creation/provider/uvCreationProvider';
import { refreshEnvironments } from '../../../envExt/api.internal';

/**
 * Prompts the user for confirmation before installing uv.
 * @returns true if the user confirmed, false otherwise
 */
async function allowUvInstall(): Promise<boolean> {
    const choice = await vscode.window.showInformationMessage(
        InterpreterQuickPickList.UvInstall.confirmUvInstallMessage,
        { modal: true, detail: InterpreterQuickPickList.UvInstall.confirmUvInstallDetail },
        InterpreterQuickPickList.UvInstall.confirmUvInstallYes,
        Common.learnMore,
    );

    if (choice === Common.learnMore) {
        vscode.env.openExternal(vscode.Uri.parse('https://docs.astral.sh/uv/getting-started/installation/'));
        return allowUvInstall();
    }

    return choice === InterpreterQuickPickList.UvInstall.confirmUvInstallYes;
}

/**
 * Installs uv using the official installer script.
 *
 * Note: This follows the official uv installation pattern (https://docs.astral.sh/uv/getting-started/installation/).
 * The scripts are fetched over HTTPS from astral.sh and executed directly. This is
 * the recommended installation method from the uv documentation. Users who require
 * additional verification should install uv manually before using this feature.
 *
 * @returns true if installation succeeded, false otherwise
 */
async function installUv(): Promise<boolean> {
    const allowInstall = await allowUvInstall();
    if (!allowInstall) {
        traceInfo('User declined uv installation');
        return false;
    }

    traceInfo('Installing uv...');

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
        // Clear caches so that subsequent calls detect the newly installed uv
        resetUvCache();
        return true;
    } catch (error) {
        traceError(`Failed to install uv: ${error}`);
        return false;
    }
}

/**
 * Installs a Python version using uv and returns the path to the installed Python.
 * @param identifier The full uv identifier to install (e.g., "cpython-3.13.1-windows-aarch64-none")
 * @param version The display version (e.g., "3.13") for user-facing messages and finding the Python
 * @returns The path to the installed Python, or undefined if installation failed
 */
async function installPythonVersionAndGetPath(identifier: string, version: string): Promise<string | undefined> {
    traceInfo(`Installing Python ${version} via uv (${identifier})...`);

    try {
        // Use exec directly instead of installUvPython to avoid cache issues
        // when uv was just installed in the same session.
        // Use the full identifier (e.g., cpython-3.13.1-windows-aarch64-none) to ensure
        // we get the correct architecture on Windows ARM64.
        // See: https://github.com/astral-sh/uv/issues/12906
        const installResult = await exec('uv', ['python', 'install', identifier], { throwOnStdErr: false });

        // Check if installation failed by examining stderr
        // uv writes errors to stderr even when we use throwOnStdErr: false
        if (installResult?.stderr && installResult.stderr.length > 0) {
            traceError(`Python installation failed: ${installResult.stderr}`);
            return undefined;
        }

        traceInfo(`Python ${version} installed successfully`);

        // Get the path to the installed Python using the version
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
 * Gets the path to the global venv in the user's home directory.
 * @returns The path to ~/.venv (or equivalent on Windows)
 */
function getGlobalVenvPath(): string {
    return path.join(os.homedir(), '.venv');
}

/**
 * Creates a global virtual environment for use when no workspace is open.
 * The venv is created at ~/.venv so that `uv pip install` works from the home directory.
 * @param version The Python version (e.g., "3.13")
 * @param progress Progress reporter
 * @returns The path to the venv's Python executable, or undefined if creation failed
 */
async function createGlobalVenv(
    version: string,
    progress: vscode.Progress<{ message?: string }>,
): Promise<string | undefined> {
    const venvPath = getGlobalVenvPath();

    traceInfo(`Creating global venv at ${venvPath}...`);
    progress.report({ message: InterpreterQuickPickList.UvInstall.creatingVenv });

    try {
        // Create the venv using uv
        // --seed installs pip/setuptools for compatibility
        const args = ['venv', venvPath, '--seed', '-p', version];
        await exec('uv', args, { throwOnStdErr: false });

        // Return the path to the Python executable
        const pythonPath =
            process.platform === 'win32'
                ? path.join(venvPath, 'Scripts', 'python.exe')
                : path.join(venvPath, 'bin', 'python');

        traceInfo(`Global venv created at ${pythonPath}`);
        return pythonPath;
    } catch (error) {
        traceError(`Failed to create global venv: ${error}`);
        return undefined;
    }
}

/**
 * Shows a quick pick for selecting a Python version to install.
 * @returns An object with the selected version and identifier, or undefined if cancelled
 */
async function selectPythonVersion(): Promise<{ version: string; identifier: string } | undefined> {
    const versions = await getAvailablePythonVersions();

    if (versions.length === 0) {
        vscode.window.showErrorMessage(InterpreterQuickPickList.UvInstall.noVersionsAvailable);
        return undefined;
    }

    interface VersionQuickPickItem extends vscode.QuickPickItem {
        version: string;
        identifier: string;
    }

    const items: VersionQuickPickItem[] = versions.map((v) => ({
        label: InterpreterQuickPickList.UvInstall.pythonVersionLabel(v.version),
        description: v.isInstalled ? InterpreterQuickPickList.UvInstall.installed : undefined,
        detail: v.path,
        version: v.version,
        identifier: v.identifier,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: InterpreterQuickPickList.UvInstall.selectVersion,
        title: InterpreterQuickPickList.UvInstall.selectVersionTitle,
    });

    return selected ? { version: selected.version, identifier: selected.identifier } : undefined;
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
                        // User declined or installation failed - exit silently
                        return { success: false };
                    }
                }

                // Select and install Python version
                progress.report({ message: InterpreterQuickPickList.UvInstall.selectingVersion });
                const selected = await selectPythonVersion();
                if (!selected) {
                    return { success: false, error: 'Cancelled' };
                }

                progress.report({
                    message: InterpreterQuickPickList.UvInstall.installingPythonVersion(selected.version),
                });
                const pythonPath = await installPythonVersionAndGetPath(selected.identifier, selected.version);
                if (!pythonPath) {
                    return {
                        success: false,
                        error: InterpreterQuickPickList.UvInstall.installFailed(selected.version),
                    };
                }

                // Create venv - either in workspace or in global location
                const workspaces = getWorkspaceFolders();
                let venvPython: string | undefined;

                if (workspaces && workspaces.length > 0) {
                    // Workspace is open - offer to create venv there
                    const createVenv = await vscode.window.showQuickPick(
                        [
                            { label: InterpreterQuickPickList.UvInstall.yesRecommended, id: 'yes' },
                            { label: Common.bannerLabelNo, id: 'no' },
                        ],
                        { title: InterpreterQuickPickList.UvInstall.createVenvPrompt },
                    );

                    if (createVenv?.id === 'yes') {
                        progress.report({ message: InterpreterQuickPickList.UvInstall.creatingVenv });
                        venvPython = await createUvVenv(workspaces[0], selected.version, progress);
                        if (venvPython) {
                            vscode.window.showInformationMessage(InterpreterQuickPickList.UvInstall.venvCreated);
                        } else {
                            // Venv creation failed - warn the user
                            vscode.window.showWarningMessage(InterpreterQuickPickList.UvInstall.venvCreationFailed);
                        }
                    }
                } else {
                    // No workspace - create a global venv at ~/.venv
                    venvPython = await createGlobalVenv(selected.version, progress);
                    if (venvPython) {
                        vscode.window.showInformationMessage(
                            InterpreterQuickPickList.UvInstall.globalVenvCreated(getGlobalVenvPath()),
                        );
                    } else {
                        vscode.window.showWarningMessage(InterpreterQuickPickList.UvInstall.venvCreationFailed);
                    }
                }

                // Trigger a refresh of Python environments so the new interpreter is discovered
                // and properly identified as uv-managed
                progress.report({ message: InterpreterQuickPickList.UvInstall.refreshingEnvironments });
                await refreshEnvironments(undefined).catch((err) => {
                    traceError(`Failed to refresh environments: ${err}`);
                });

                // Return the venv Python if created, otherwise fall back to base Python
                const finalPythonPath = venvPython ?? pythonPath;
                vscode.window.showInformationMessage(
                    InterpreterQuickPickList.UvInstall.installSuccess(selected.version),
                );
                return { success: true, pythonPath: finalPythonPath };
            } catch (error) {
                traceError(`installPythonViaUv failed: ${error}`);
                return { success: false, error: String(error) };
            }
        },
    );
}
