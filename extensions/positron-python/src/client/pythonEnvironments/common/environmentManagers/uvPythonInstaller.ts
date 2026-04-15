/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { traceError, traceInfo } from '../../../logging';
import { exec } from '../externalDependencies';
import { isUvInstalled, getAvailablePythonVersions, isWindowsArm64 } from './uv';
import { Common, InterpreterQuickPickList } from '../../../common/utils/localize';
import { getWorkspaceFolders } from '../../../common/vscodeApis/workspaceApis';
import { createUvVenv } from '../../creation/provider/uvCreationProvider';

/**
 * Prompts the user for confirmation before installing uv.
 * @returns true if the user confirmed, false otherwise
 */
async function allowUvInstall(): Promise<boolean> {
    const choice = await vscode.window.showInformationMessage(
        InterpreterQuickPickList.UvInstall.confirmUvInstallMessage,
        { modal: true, detail: 'https://docs.astral.sh/uv/getting-started/installation/' },
        InterpreterQuickPickList.UvInstall.confirmUvInstallYes,
        InterpreterQuickPickList.UvInstall.confirmUvInstallNo,
    );
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
        return true;
    } catch (error) {
        traceError(`Failed to install uv: ${error}`);
        return false;
    }
}

/**
 * Installs a Python version using uv and returns the path to the installed Python.
 * @param version The version to install (e.g., "3.13.1" or "3.13")
 * @returns The path to the installed Python, or undefined if installation failed
 */
async function installPythonVersionAndGetPath(version: string): Promise<string | undefined> {
    traceInfo(`Installing Python ${version} via uv...`);

    try {
        // Use exec directly instead of installUvPython to avoid cache issues
        // when uv was just installed in the same session
        // On Windows ARM64, specify the python-platform to get ARM64 builds
        // See: https://github.com/astral-sh/uv/issues/12906
        const installArgs = isWindowsArm64()
            ? ['python', 'install', '--python-platform', 'windows-arm64', version]
            : ['python', 'install', version];
        await exec('uv', installArgs, { throwOnStdErr: false });
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
        label: InterpreterQuickPickList.UvInstall.pythonVersionLabel(v.version),
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
                const pythonPath = await installPythonVersionAndGetPath(version);
                if (!pythonPath) {
                    return { success: false, error: InterpreterQuickPickList.UvInstall.installFailed(version) };
                }

                // Offer to create venv if workspace is open
                const workspaces = getWorkspaceFolders();
                if (workspaces && workspaces.length > 0) {
                    const createVenv = await vscode.window.showQuickPick(
                        [
                            { label: InterpreterQuickPickList.UvInstall.yesRecommended, id: 'yes' },
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
                        // Venv creation failed - warn the user that we're falling back to base Python
                        vscode.window.showWarningMessage(InterpreterQuickPickList.UvInstall.venvCreationFailed);
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
