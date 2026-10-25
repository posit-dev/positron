/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import { CancellationToken, ProgressLocation, WorkspaceFolder } from 'vscode';
import { execObservable } from '../../../common/process/rawProcessApis';
import { ObservableExecutionResult } from '../../../common/process/types';
import { createDeferred } from '../../../common/utils/async';
import { Common, CreateEnv, Interpreters } from '../../../common/utils/localize';
import { traceError, traceLog } from '../../../logging';
import { CreateEnvironmentProgress } from '../types';
import { getVenvExecutable, showPositronErrorMessageWithLogs } from '../common/commonUtils';
import { withProgress, showWarningMessage } from '../../../common/vscodeApis/windowApis';
import { launch } from '../../../common/vscodeApis/browserApis';
import { ensureUvInstalled, showUvInstallError } from '../../common/environmentManagers/uvPythonInstaller';
import { Pixi } from '../../common/environmentManagers/pixi';
import { execObservableLocatedUv } from '../../common/environmentManagers/uv';
import { isWindows } from '../../../common/utils/platform';
import { IPythonRuntimeManager } from '../../../positron/manager';
import { holdCreatingEnvironment } from '../createEnvironment';

const PIXI_INSTALL_DOCS_URL = 'https://pixi.sh/latest/installation/';

/**
 * Runs `command` in `cwd`, logging its output. Rejects with the output on a non-zero exit.
 */
export async function runToolCommand(
    command: string,
    args: string[],
    cwd: string,
    token?: CancellationToken,
): Promise<void> {
    traceLog('Running: ', [command, ...args]);
    const result = execObservable(command, args, { mergeStdOutErr: true, token, cwd });
    return waitForToolCommand(result, `${command} ${args.join(' ')}`);
}

/**
 * Like `runToolCommand`, but runs the located uv binary so a uv installed this session is found.
 */
export async function runUvCommand(args: string[], cwd: string, token?: CancellationToken): Promise<void> {
    traceLog('Running: ', ['uv', ...args]);
    const result = await execObservableLocatedUv(args, { mergeStdOutErr: true, token, cwd });
    return waitForToolCommand(result, `uv ${args.join(' ')}`);
}

function waitForToolCommand(
    { proc, out, dispose }: ObservableExecutionResult<string>,
    description: string,
): Promise<void> {
    const deferred = createDeferred<void>();
    const outputLines: string[] = [];
    out.subscribe(
        (value) => {
            const output = value.out.split(/\r?\n/g).join(os.EOL);
            outputLines.push(output);
            traceLog(output.trimEnd());
        },
        (error) => deferred.reject(error),
        () => {
            dispose();
            if (proc?.exitCode !== 0) {
                const message = `${description} failed with exitCode: ${proc?.exitCode}`;
                const detail = outputLines.join('').trimEnd();
                deferred.reject(detail ? `${message}\n${detail}` : message);
            } else {
                deferred.resolve();
            }
        },
    );
    return deferred.promise;
}

/**
 * Runs `uv sync` at the workspace root and selects the resulting `.venv` as the active
 * runtime. Returns whether it succeeded.
 */
export async function syncUvEnv(
    workspace: WorkspaceFolder,
    pythonRuntimeManager: IPythonRuntimeManager,
): Promise<boolean> {
    return withProgress(
        { location: ProgressLocation.Notification, title: CreateEnv.statusTitle, cancellable: true },
        async (progress: CreateEnvironmentProgress, token: CancellationToken) => {
            progress.report({ message: CreateEnv.Venv.creating });
            try {
                const venvPython = getVenvExecutable(workspace);
                // Hold the creation flag until the console has started, so the new-environment
                // prompt does not offer a second console for this environment (#16584).
                const runtimeId = await holdCreatingEnvironment(async () => {
                    await runUvCommand(['sync'], workspace.uri.fsPath, token);
                    return pythonRuntimeManager.selectLanguageRuntimeFromPath(venvPython, true);
                });
                if (!runtimeId) {
                    // The hold dropped the new-environment prompt, so say why no console started. The
                    // venv exists, so still report success.
                    await showPositronErrorMessageWithLogs(Interpreters.environmentSessionStartFailed(venvPython));
                }
                return true;
            } catch (error) {
                traceError('CreateEnv Trigger - Error running uv sync: ', error);
                return false;
            }
        },
    );
}

/**
 * Installs uv first (with consent) if it is not already available, then syncs the
 * workspace's uv.lock environment.
 */
export async function autoSyncUvEnv(
    workspace: WorkspaceFolder,
    pythonRuntimeManager: IPythonRuntimeManager,
): Promise<void> {
    const ensured = await ensureUvInstalled();
    if (!ensured.ok) {
        if (ensured.error) {
            await showUvInstallError(ensured.error);
        }
        return;
    }

    if (!(await syncUvEnv(workspace, pythonRuntimeManager))) {
        await showPositronErrorMessageWithLogs(CreateEnv.Venv.errorCreatingEnvironment);
    }
}

async function resolvePixiPythonPath(pixi: Pixi, cwd: string): Promise<string | undefined> {
    const info = await pixi.getPixiInfo(cwd);
    const defaultEnv = info?.environments_info.find((e) => e.name === 'default') ?? info?.environments_info[0];
    if (!defaultEnv) {
        return undefined;
    }
    return isWindows() ? path.join(defaultEnv.prefix, 'python.exe') : path.join(defaultEnv.prefix, 'bin', 'python');
}

/**
 * Tells the user pixi is needed for this project and points at pixi's install docs;
 * there is no automated installer for pixi.
 */
export async function showPixiNotInstalledWarning(): Promise<void> {
    const choice = await showWarningMessage(CreateEnv.Trigger.pixiNotInstalledMessage, Common.learnMore);
    if (choice === Common.learnMore) {
        launch(PIXI_INSTALL_DOCS_URL);
    }
}

/**
 * Runs `pixi install` at the workspace root and selects the resulting default environment
 * as the active runtime.
 */
export async function autoInstallPixiEnv(
    workspace: WorkspaceFolder,
    pixi: Pixi,
    pythonRuntimeManager: IPythonRuntimeManager,
): Promise<void> {
    await withProgress(
        { location: ProgressLocation.Notification, title: CreateEnv.statusTitle, cancellable: true },
        async (progress: CreateEnvironmentProgress, token: CancellationToken) => {
            progress.report({ message: CreateEnv.Venv.creating });
            try {
                // Hold the creation flag until the console has started, so the new-environment
                // prompt does not offer a second console for this environment (#16584).
                const { pythonPath, runtimeId } = await holdCreatingEnvironment(async () => {
                    await runToolCommand(pixi.command, ['install'], workspace.uri.fsPath, token);
                    const resolved = await resolvePixiPythonPath(pixi, workspace.uri.fsPath);
                    return {
                        pythonPath: resolved,
                        runtimeId: resolved
                            ? await pythonRuntimeManager.selectLanguageRuntimeFromPath(resolved, true)
                            : undefined,
                    };
                });
                if (!pythonPath) {
                    traceError('CreateEnv Trigger - Could not resolve the pixi environment after install');
                    await showPositronErrorMessageWithLogs(CreateEnv.Venv.errorCreatingEnvironment);
                } else if (!runtimeId) {
                    // The hold dropped the new-environment prompt, so say why no console started.
                    await showPositronErrorMessageWithLogs(Interpreters.environmentSessionStartFailed(pythonPath));
                }
            } catch (error) {
                traceError('CreateEnv Trigger - Error running pixi install: ', error);
                await showPositronErrorMessageWithLogs(CreateEnv.Venv.errorCreatingEnvironment);
            }
        },
    );
}
