/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { traceError, traceInfo } from '../../../logging';
import { exec } from '../externalDependencies';
import { isUvInstalled, getAvailablePythonVersions, resetUvCache, isWindowsArm64, execUv } from './uv';
import { Commands } from '../../../common/constants';
import { Common, InterpreterQuickPickList } from '../../../common/utils/localize';
import { getWorkspaceFolders } from '../../../common/vscodeApis/workspaceApis';
import { createUvVenv } from '../../creation/provider/uvCreationProvider';
import { ExistingVenvAction, deleteEnvironment, pickExistingVenvAction } from '../../creation/provider/venvUtils';
import { getVenvExecutable, hasVenv } from '../../creation/common/commonUtils';
import { MultiStepAction } from '../../../common/vscodeApis/windowApis';
import { refreshEnvironments } from '../../../envExt/api.internal';

/**
 * Shows an error notification for the uv Python install flow with a button that
 * opens the Python Language Pack output channel, so users can inspect the logs to
 * see what went wrong.
 * @param message The error message to display.
 */
export async function showUvInstallError(message: string): Promise<void> {
    const selection = await vscode.window.showErrorMessage(message, Common.showLogs);
    if (selection === Common.showLogs) {
        await vscode.commands.executeCommand(Commands.ViewOutput);
    }
}

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
 * @param version The version to install (e.g., "3.13.1" or "3.13")
 * @param identifier Optional full identifier for Windows ARM64 (e.g., "cpython-3.13.1-windows-aarch64-none")
 * @returns The path to the installed Python, or undefined if installation failed
 */
async function installPythonVersionAndGetPath(version: string, identifier?: string): Promise<string | undefined> {
    traceInfo(`Installing Python ${version} via uv...`);

    try {
        // Use exec directly instead of installUvPython to avoid cache issues
        // when uv was just installed in the same session.
        // On Windows ARM64, use the full identifier to ensure we get ARM64 builds.
        // See: https://github.com/astral-sh/uv/issues/12906
        const installTarget = identifier ?? version;
        await execUv('uv', ['python', 'install', installTarget], { throwOnStdErr: false });

        // Get the path to the installed Python. Route through execUv so uv does not wrap the
        // path in ANSI color codes (uv honors FORCE_COLOR/CLICOLOR_FORCE even when piped),
        // which would corrupt the interpreter path we parse below.
        const result = await execUv('uv', ['python', 'find', version], { throwOnStdErr: false });
        const pythonPath = result?.stdout.trim();

        if (pythonPath) {
            traceInfo(`Python ${version} installed successfully at ${pythonPath}`);
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
        await execUv('uv', args, { throwOnStdErr: false });

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
 * Creates a uv venv at the given folder, reusing the Create Environment "use
 * existing / delete and recreate" flow when a `.venv` already exists there. uv
 * fails outright if a `.venv` already exists, so this collision must be handled.
 *
 * @param folder The folder to create the venv in (the open workspace, or a
 *   home-directory stand-in for the global `~/.venv` case).
 * @param create Creates the venv once any existing one has been resolved.
 * @returns `venvPython` is the venv's Python executable (from a fresh create or
 *   an existing env the user chose to keep), or undefined if creation failed or
 *   the user backed out. `attempted` reports whether creation actually ran, so
 *   callers only show success/failure messages when a create was tried.
 */
async function createVenvHandlingExisting(
    folder: vscode.WorkspaceFolder,
    create: () => Promise<string | undefined>,
): Promise<{ venvPython: string | undefined; attempted: boolean }> {
    try {
        const existingVenvAction = (await hasVenv(folder))
            ? await pickExistingVenvAction(folder)
            : ExistingVenvAction.Create;

        if (existingVenvAction === ExistingVenvAction.UseExisting) {
            return { venvPython: getVenvExecutable(folder), attempted: false };
        }
        if (existingVenvAction === ExistingVenvAction.Recreate) {
            if (!(await deleteEnvironment(folder, undefined))) {
                // Delete failed - warn the user but don't abort the overall install.
                // Python itself was installed successfully; fall back to the base interpreter.
                return { venvPython: undefined, attempted: true };
            }
        }
        return { venvPython: await create(), attempted: true };
    } catch (ex) {
        // User backed out of the existing-venv prompt - skip venv creation and
        // fall back to the base interpreter.
        if (ex !== MultiStepAction.Back && ex !== MultiStepAction.Cancel) {
            throw ex;
        }
        return { venvPython: undefined, attempted: false };
    }
}

/**
 * Shows a quick pick for selecting a Python version to install.
 * @returns The selected version (and identifier on Windows ARM64), or undefined if cancelled
 */
async function selectPythonVersion(): Promise<
    { version: string; identifier?: string; isInstalled: boolean; path?: string } | undefined
> {
    const versions = await getAvailablePythonVersions();

    if (versions.length === 0) {
        await showUvInstallError(InterpreterQuickPickList.UvInstall.noVersionsAvailable);
        return undefined;
    }

    interface VersionQuickPickItem extends vscode.QuickPickItem {
        version: string;
        identifier: string;
        isInstalled: boolean;
        path?: string;
    }

    const uninstalled = versions.filter((v) => !v.isInstalled);
    const installed = versions.filter((v) => v.isInstalled);

    const items: (VersionQuickPickItem | vscode.QuickPickItem)[] = uninstalled.map((v) => ({
        label: InterpreterQuickPickList.UvInstall.pythonVersionLabel(v.version),
        version: v.version,
        identifier: v.identifier,
        isInstalled: false,
    }));

    if (installed.length > 0) {
        items.push({
            label: InterpreterQuickPickList.UvInstall.alreadyInstalledSeparator,
            kind: vscode.QuickPickItemKind.Separator,
        });
        for (const v of installed) {
            items.push({
                label: InterpreterQuickPickList.UvInstall.pythonVersionLabel(v.version),
                detail: v.path,
                version: v.version,
                identifier: v.identifier,
                isInstalled: true,
                path: v.path,
            });
        }
    }

    const selected = await vscode.window.showQuickPick(items as VersionQuickPickItem[], {
        placeHolder: InterpreterQuickPickList.UvInstall.selectVersion,
        title: InterpreterQuickPickList.UvInstall.selectVersionTitle,
    });

    if (!selected) {
        return undefined;
    }

    // On Windows ARM64, return the identifier so we can install the correct architecture
    // On other platforms, just return the version
    return isWindowsArm64()
        ? {
              version: selected.version,
              identifier: selected.identifier,
              isInstalled: selected.isInstalled,
              path: selected.path,
          }
        : { version: selected.version, isInstalled: selected.isInstalled, path: selected.path };
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
    let installedVersion: string | undefined;
    let wasAlreadyInstalled = false;
    let venvWasCreated = false;

    const result = await vscode.window.withProgress(
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
                    // Verify uv is now reachable. The installer drops the binary at a known
                    // location and updates shell rc files, but those PATH changes don't reach
                    // the running extension host. isUvInstalled() also probes uv's known
                    // install locations; if it still can't be found, surface an actionable
                    // message instead of the misleading "no versions available" error later.
                    if (!(await isUvInstalled())) {
                        return { success: false, error: InterpreterQuickPickList.UvInstall.uvNotFoundAfterInstall };
                    }
                }

                // Select and install Python version
                progress.report({ message: InterpreterQuickPickList.UvInstall.selectingVersion });
                const selected = await selectPythonVersion();
                if (!selected) {
                    return { success: false, error: 'Cancelled' };
                }

                let resolvedPath: string | undefined;
                if (selected.isInstalled && selected.path) {
                    // Version is already installed - skip the install step
                    resolvedPath = selected.path;
                    wasAlreadyInstalled = true;
                    progress.report({
                        message: InterpreterQuickPickList.UvInstall.alreadyInstalledMessage(selected.version),
                    });
                } else {
                    progress.report({
                        message: InterpreterQuickPickList.UvInstall.installingPythonVersion(selected.version),
                    });
                    resolvedPath = await installPythonVersionAndGetPath(selected.version, selected.identifier);
                    if (!resolvedPath) {
                        return {
                            success: false,
                            error: InterpreterQuickPickList.UvInstall.installFailed(selected.version),
                        };
                    }
                }

                // Create venv - either in workspace or in global location
                const workspaces = getWorkspaceFolders();

                if (workspaces && workspaces.length > 0) {
                    const venvPrompt = wasAlreadyInstalled
                        ? InterpreterQuickPickList.UvInstall.createVenvPromptAlreadyInstalled(
                              selected.version,
                              workspaces[0].name,
                          )
                        : InterpreterQuickPickList.UvInstall.createVenvPrompt(selected.version, workspaces[0].name);
                    const createVenv = await vscode.window.showInformationMessage(
                        venvPrompt,
                        InterpreterQuickPickList.UvInstall.yesRecommended,
                        Common.bannerLabelNo,
                    );

                    if (createVenv === InterpreterQuickPickList.UvInstall.yesRecommended) {
                        progress.report({ message: InterpreterQuickPickList.UvInstall.creatingVenv });
                        const workspace = workspaces[0];
                        const venvResult = await createVenvHandlingExisting(workspace, () =>
                            createUvVenv(workspace, selected.version, progress),
                        );
                        if (venvResult.venvPython) {
                            resolvedPath = venvResult.venvPython;
                            venvWasCreated = venvResult.attempted;
                        } else if (venvResult.attempted) {
                            progress.report({ message: InterpreterQuickPickList.UvInstall.venvCreationFailed });
                        }
                    }
                } else {
                    // No workspace - create (or reuse) a global venv at ~/.venv. The existing-venv
                    // helpers are workspace-folder based, so wrap the home directory in a
                    // WorkspaceFolder to reuse the same use-existing / recreate handling.
                    const homeFolder: vscode.WorkspaceFolder = {
                        uri: vscode.Uri.file(os.homedir()),
                        name: 'home',
                        index: 0,
                    };
                    const venvResult = await createVenvHandlingExisting(homeFolder, () =>
                        createGlobalVenv(selected.version, progress),
                    );
                    if (venvResult.venvPython) {
                        resolvedPath = venvResult.venvPython;
                        venvWasCreated = venvResult.attempted;
                    } else if (venvResult.attempted) {
                        progress.report({ message: InterpreterQuickPickList.UvInstall.venvCreationFailed });
                    }
                }

                // Trigger a refresh of Python environments so the new interpreter is discovered
                // and properly identified as uv-managed
                progress.report({ message: InterpreterQuickPickList.UvInstall.refreshingEnvironments });
                await refreshEnvironments(undefined).catch((err) => {
                    traceError(`Failed to refresh environments: ${err}`);
                });

                installedVersion = selected.version;
                return { success: true, pythonPath: resolvedPath };
            } catch (error) {
                traceError(`installPythonViaUv failed: ${error}`);
                return { success: false, error: String(error) };
            }
        },
    );

    if (result.success && installedVersion) {
        if (!wasAlreadyInstalled) {
            // Python was freshly installed - always notify
            vscode.window.showInformationMessage(InterpreterQuickPickList.UvInstall.installSuccess(installedVersion));
        } else if (venvWasCreated) {
            // Python was already installed but a new venv was created
            vscode.window.showInformationMessage(InterpreterQuickPickList.UvInstall.configureSuccess(installedVersion));
        }
        // Already installed + no venv created: nothing changed, no notification needed
    }

    return result;
}
