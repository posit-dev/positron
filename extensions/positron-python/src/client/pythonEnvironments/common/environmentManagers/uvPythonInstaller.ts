/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
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
import {
    createGlobalEnvironment,
    globalEnvironmentErrorMessage,
    promptForGlobalEnvironment,
} from './globalEnvironment';

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
 * Echoed by the installer command only when the script exits 0. `exec` reports neither the exit
 * status nor a usable error, since it rejects only when the process cannot be spawned and the
 * installer writes its normal progress to stderr, so this marker is the only signal of success.
 */
export const UV_INSTALL_OK_MARKER = 'positron-uv-install-ok';

/**
 * Runs the official uv installer script. The caller is responsible for getting consent
 * first, so that nothing reports progress on an install the user has not agreed to.
 *
 * Note: This follows the official uv installation pattern (https://docs.astral.sh/uv/getting-started/installation/).
 * The scripts are fetched over HTTPS from astral.sh and executed directly. This is
 * the recommended installation method from the uv documentation. Users who require
 * additional verification should install uv manually before using this feature.
 *
 * @returns true if installation succeeded, false otherwise
 */
async function runUvInstaller(): Promise<boolean> {
    traceInfo('Installing uv...');

    try {
        const result =
            process.platform === 'win32'
                ? await exec('powershell', [
                      '-ExecutionPolicy',
                      'ByPass',
                      '-c',
                      // `$?` reports whether the install succeeded without making non-terminating
                      // errors fatal, which setting $ErrorActionPreference would, failing installs
                      // that used to work.
                      `irm https://astral.sh/uv/install.ps1 | iex; if ($?) { Write-Output "${UV_INSTALL_OK_MARKER}" }`,
                  ])
                : await exec('sh', [
                      '-c',
                      // Downloaded to a file rather than piped into `sh`, so a failed download is
                      // fatal to the marker: piped, the status is the downstream shell's, which
                      // exits 0 on empty stdin. `pipefail` and PIPESTATUS are out, since /bin/sh
                      // is dash on some Linux distros.
                      `script="$(mktemp)" && trap 'rm -f "$script"' EXIT && ` +
                          `curl -LsSf https://astral.sh/uv/install.sh -o "$script" && ` +
                          `sh "$script" && echo ${UV_INSTALL_OK_MARKER}`,
                  ]);

        if (!result.stdout.includes(UV_INSTALL_OK_MARKER)) {
            traceError(`Failed to install uv: ${result.stderr?.trim() || result.stdout.trim()}`);
            return false;
        }

        // The installer names the directory it wrote to. Logged on success too, so that "uv was
        // installed but could not be found." has something behind its Show logs button.
        const installerOutput = [result.stderr, result.stdout.replace(UV_INSTALL_OK_MARKER, '')]
            .map((output) => output?.trim())
            .filter((output) => output)
            .join('\n');
        traceInfo(`uv installed successfully${installerOutput ? `:\n${installerOutput}` : ''}`);
        // Clear caches so that subsequent calls detect the newly installed uv
        resetUvCache();
        return true;
    } catch (error) {
        traceError(`Failed to install uv: ${error}`);
        return false;
    }
}

/**
 * Outcome of making sure uv is available.
 *
 * `error` is a message the caller should surface; it is absent when the user simply
 * declined the install, which is not a failure worth a notification. Callers differ
 * in how they show it -- `installPythonViaUv()` returns it upward for
 * `handleInstallPythonResult` to display -- so this deliberately shows nothing itself.
 */
export type EnsureUvResult = { ok: true } | { ok: false; error?: string };

/**
 * Makes sure uv is available, prompting for consent and installing it if it is not.
 *
 * @param onInstalling Called only once uv is missing and the user has consented, so
 *   callers can report progress without claiming to install uv that is already there,
 *   or to be installing while the consent prompt is still on screen.
 */
export async function ensureUvInstalled(onInstalling?: () => void): Promise<EnsureUvResult> {
    if (await isUvInstalled()) {
        return { ok: true };
    }

    // Consent comes before the callback: while the prompt is up nothing is installing yet,
    // and a caller that reported progress here would be claiming work the user has not agreed to.
    if (!(await allowUvInstall())) {
        traceInfo('User declined uv installation');
        return { ok: false };
    }

    onInstalling?.();

    if (!(await runUvInstaller())) {
        // Not the same as uv landing somewhere unreachable, so this must not fall through to the
        // "installed but could not be found" message below.
        return { ok: false, error: InterpreterQuickPickList.UvInstall.uvInstallFailed };
    }

    // Verify uv is now reachable. The installer drops the binary at a known
    // location and updates shell rc files, but those PATH changes don't reach
    // the running extension host. isUvInstalled() also probes uv's known
    // install locations; if it still can't be found, surface an actionable
    // message instead of the misleading "no versions available" error later.
    if (!(await isUvInstalled())) {
        return { ok: false, error: InterpreterQuickPickList.UvInstall.uvNotFoundAfterInstall };
    }

    return { ok: true };
}

/**
 * Like ensureUvInstalled, but shows an "Installing uv" notification for as long as the
 * installer runs. Meant for callers that have no UI of their own for the install, such as
 * the New Folder flow, which only learns the outcome once the command returns.
 *
 * The notification opens only after the user has consented, so nothing claims to be
 * installing while the consent prompt is on screen. It is a notification rather than a
 * window-level indicator because notification toasts render above Positron modal dialogs.
 */
export async function ensureUvInstalledWithProgress(): Promise<EnsureUvResult> {
    let finishInstall: (() => void) | undefined;

    let result: EnsureUvResult;
    try {
        result = await ensureUvInstalled(() => {
            const installing = new Promise<void>((resolve) => {
                finishInstall = resolve;
            });
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: InterpreterQuickPickList.UvInstall.installingUv,
                },
                () => installing,
            );
        });
    } finally {
        // In a finally so a throw after the notification opened still closes it, rather than
        // leaving it claiming an install is running until the window is reloaded.
        finishInstall?.();
    }

    // The step below this only has room to say that the install failed. The notification is what
    // carries the way to find out why, through its Show logs button, which is why the flow does not
    // have to grow a log affordance of its own. A declined install has no error and shows nothing.
    if (!result.ok && result.error) {
        // Deliberately not awaited: the notification stays until the user dismisses it, and
        // awaiting it would hold this command open, leaving the step that called it stuck showing
        // an install still in progress.
        void showUvInstallError(result.error);
    }

    return result;
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

        // Get the path to the installed Python
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
 * Creates a uv venv at the given folder, reusing the Create Environment "use
 * existing / delete and recreate" flow when a `.venv` already exists there. uv
 * fails outright if a `.venv` already exists, so this collision must be handled.
 *
 * @param folder The open workspace folder to create the venv in.
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
                const uvReady = await ensureUvInstalled(() =>
                    progress.report({ message: InterpreterQuickPickList.UvInstall.installingUv }),
                );
                if (!uvReady.ok) {
                    return { success: false, error: uvReady.error };
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
                    const createVenv = await positron.window.showSimpleModalDialogPrompt(
                        InterpreterQuickPickList.UvInstall.createVenvTitle,
                        venvPrompt,
                        InterpreterQuickPickList.UvInstall.createVenvAccept,
                        InterpreterQuickPickList.UvInstall.createVenvSkip,
                    );

                    if (createVenv) {
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
                    // No folder open. The question this flow is really asking is where the
                    // environment should live, so lead with "Open Folder..." and only create
                    // the global environment at $WORKON_HOME/positron (default
                    // ~/.virtualenvs/positron) when the user asks for it. Nothing already at
                    // that path is reused, upgraded, or deleted.
                    const choice = await promptForGlobalEnvironment();

                    if (choice === 'openFolder') {
                        // The user asked to open a folder, so this window is done: if they
                        // pick one, the window reloads. Registering the interpreter here
                        // would start a session in a window they are leaving. The Python
                        // just installed persists on disk, so the folder's window picks it
                        // up. 'Cancelled' suppresses the error toast.
                        return { success: false, error: 'Cancelled' };
                    }

                    if (choice === 'create') {
                        progress.report({ message: InterpreterQuickPickList.UvInstall.creatingVenv });
                        const globalResult = await createGlobalEnvironment(selected.version);
                        if (globalResult.outcome === 'created') {
                            resolvedPath = globalResult.pythonPath;
                            venvWasCreated = true;
                        } else {
                            await showUvInstallError(globalEnvironmentErrorMessage(globalResult));
                        }
                    }

                    // 'dismiss' leaves resolvedPath on the base uv interpreter, which is the
                    // same fallback a failed creation takes.
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
