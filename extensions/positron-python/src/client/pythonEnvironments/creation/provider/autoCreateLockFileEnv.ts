/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import { CancellationToken, ProgressLocation, WorkspaceFolder } from 'vscode';
import { execObservable } from '../../../common/process/rawProcessApis';
import { createDeferred } from '../../../common/utils/async';
import { Common, CreateEnv } from '../../../common/utils/localize';
import { traceError, traceLog } from '../../../logging';
import { CreateEnvironmentProgress } from '../types';
import { getVenvExecutable, showPositronErrorMessageWithLogs } from '../common/commonUtils';
import { withProgress, showWarningMessage } from '../../../common/vscodeApis/windowApis';
import { launch } from '../../../common/vscodeApis/browserApis';
import { ensureUvInstalled, showUvInstallError } from '../../common/environmentManagers/uvPythonInstaller';
import { getPixi, Pixi } from '../../common/environmentManagers/pixi';
import { isWindows } from '../../../common/utils/platform';
import { IPythonRuntimeManager } from '../../../positron/manager';

const PIXI_INSTALL_DOCS_URL = 'https://pixi.sh/latest/installation/';

async function runToolCommand(
    command: string,
    args: string[],
    cwd: string,
    progress: CreateEnvironmentProgress,
    token?: CancellationToken,
): Promise<void> {
    progress.report({ message: CreateEnv.Venv.creating });
    const deferred = createDeferred<void>();
    traceLog('Running: ', [command, ...args]);
    const { proc, out, dispose } = execObservable(command, args, { mergeStdOutErr: true, token, cwd });

    out.subscribe(
        (value) => traceLog(value.out.split(/\r?\n/g).join(os.EOL).trimEnd()),
        (error) => deferred.reject(error),
        () => {
            dispose();
            if (proc?.exitCode !== 0) {
                deferred.reject(`${command} ${args.join(' ')} failed with exitCode: ${proc?.exitCode}`);
            } else {
                deferred.resolve();
            }
        },
    );
    return deferred.promise;
}

/**
 * Runs `uv sync` at the workspace root and selects the resulting `.venv` as the active
 * runtime. Installs uv first (with consent) if it is not already available.
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

    await withProgress(
        { location: ProgressLocation.Notification, title: CreateEnv.statusTitle, cancellable: true },
        async (progress: CreateEnvironmentProgress, token: CancellationToken) => {
            try {
                await runToolCommand('uv', ['sync'], workspace.uri.fsPath, progress, token);
                await pythonRuntimeManager.selectLanguageRuntimeFromPath(getVenvExecutable(workspace), true);
            } catch (error) {
                traceError('CreateEnv Trigger - Error running uv sync: ', error);
                await showPositronErrorMessageWithLogs(CreateEnv.Venv.errorCreatingEnvironment);
            }
        },
    );
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
 * Runs `pixi install` at the workspace root and selects the resulting default environment
 * as the active runtime. If pixi itself is not installed, points the user at pixi's install
 * docs instead -- there is no automated installer for pixi.
 */
export async function autoInstallPixiEnv(
    workspace: WorkspaceFolder,
    pythonRuntimeManager: IPythonRuntimeManager,
): Promise<void> {
    const pixi = await getPixi();
    if (!pixi) {
        const choice = await showWarningMessage(CreateEnv.Trigger.pixiNotInstalledMessage, Common.learnMore);
        if (choice === Common.learnMore) {
            launch(PIXI_INSTALL_DOCS_URL);
        }
        return;
    }

    await withProgress(
        { location: ProgressLocation.Notification, title: CreateEnv.statusTitle, cancellable: true },
        async (progress: CreateEnvironmentProgress, token: CancellationToken) => {
            try {
                await runToolCommand(pixi.command, ['install'], workspace.uri.fsPath, progress, token);
                const pythonPath = await resolvePixiPythonPath(pixi, workspace.uri.fsPath);
                if (pythonPath) {
                    await pythonRuntimeManager.selectLanguageRuntimeFromPath(pythonPath, true);
                } else {
                    traceError('CreateEnv Trigger - Could not resolve the pixi environment after install');
                    await showPositronErrorMessageWithLogs(CreateEnv.Venv.errorCreatingEnvironment);
                }
            } catch (error) {
                traceError('CreateEnv Trigger - Error running pixi install: ', error);
                await showPositronErrorMessageWithLogs(CreateEnv.Venv.errorCreatingEnvironment);
            }
        },
    );
}
