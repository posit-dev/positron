/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import { CancellationToken, QuickPickItem, WorkspaceFolder } from 'vscode';
import { execObservable } from '../../../common/process/rawProcessApis';
import { createDeferred } from '../../../common/utils/async';
import { CreateEnv } from '../../../common/utils/localize';
import { traceError, traceLog } from '../../../logging';
import { CreateEnvironmentProgress } from '../types';
import { isUvInstalled } from '../../common/environmentManagers/uv';
import { executeCommand } from '../../../common/vscodeApis/commandApis';
import { showQuickPickWithBack } from '../../../common/vscodeApis/windowApis';
import { Commands } from '../../../common/constants';
import { getPipRequirementsFiles } from './venvUtils';
import { UV_PROVIDER_ID } from './uvCreationProvider';
import { hasPyprojectToml } from '../common/createEnvTriggerUtils.js';

export interface AutoCreateVenvContext {
    hasRequirements: boolean;
    hasPyprojectToml: boolean;
    uvAvailable: boolean;
}

export async function detectAutoCreateContext(workspace: WorkspaceFolder): Promise<AutoCreateVenvContext> {
    const [reqFiles, uvAvailable, tomlExists] = await Promise.all([
        getPipRequirementsFiles(workspace),
        isUvInstalled(),
        hasPyprojectToml(workspace),
    ]);

    return {
        hasRequirements: (reqFiles?.length ?? 0) > 0,
        hasPyprojectToml: tomlExists,
        uvAvailable,
    };
}

export function describeDepFiles(ctx: AutoCreateVenvContext): string {
    if (ctx.hasRequirements && ctx.hasPyprojectToml) {
        return CreateEnv.Venv.requirementsAndPyprojectToml;
    }
    if (ctx.hasPyprojectToml) {
        return 'pyproject.toml';
    }
    return 'requirements.txt';
}

export function describeTool(ctx: AutoCreateVenvContext): string {
    return ctx.uvAvailable ? 'uv' : 'venv';
}

interface DepSource {
    label: string;
    args: string[];
}

function reqFileArgs(files: string[]): string[] {
    const args = ['pip', 'install'];
    for (const f of files) {
        args.push('-r', f);
    }
    return args;
}

async function collectDepSources(workspace: WorkspaceFolder): Promise<DepSource[]> {
    const sources: DepSource[] = [];

    const reqFiles = await getPipRequirementsFiles(workspace);
    if (reqFiles && reqFiles.length > 0) {
        for (const f of reqFiles) {
            const relPath = path.relative(workspace.uri.fsPath, f);
            sources.push({
                label: relPath,
                args: reqFileArgs([f]),
            });
        }
    }

    if (await hasPyprojectToml(workspace)) {
        sources.push({
            label: 'pyproject.toml',
            args: ['pip', 'install', '-e', '.'],
        });
    }

    return sources;
}

async function pickDepInstallArgs(sources: DepSource[]): Promise<string[][]> {
    if (sources.length === 0) {
        return [];
    }

    if (sources.length === 1) {
        return [sources[0].args];
    }

    const items: QuickPickItem[] = sources.map((s) => ({ label: s.label, picked: true }));
    const selection = await showQuickPickWithBack(items, {
        placeHolder: CreateEnv.Trigger.selectDepSource,
        ignoreFocusOut: true,
        canPickMany: true,
    });
    if (!selection || (Array.isArray(selection) && selection.length === 0)) {
        return [];
    }
    const selected = Array.isArray(selection) ? selection : [selection];
    const selectedLabels = new Set(selected.map((s) => s.label));
    const chosen = sources.filter((s) => selectedLabels.has(s.label));
    return chosen.map((s) => s.args);
}

async function runSingleInstall(args: string[], workspace: WorkspaceFolder, token?: CancellationToken): Promise<void> {
    const deferred = createDeferred<void>();
    const outputLines: string[] = [];
    traceLog('Running uv dep install: ', ['uv', ...args]);
    const { proc, out, dispose } = execObservable('uv', args, {
        mergeStdOutErr: true,
        token,
        cwd: workspace.uri.fsPath,
    });

    out.subscribe(
        (value) => {
            const output = value.out.split(/\r?\n/g).join(os.EOL);
            outputLines.push(output);
            traceLog(output.trimEnd());
        },
        (error) => {
            traceError('Error while installing dependencies via uv: ', error);
            deferred.reject(error);
        },
        () => {
            dispose();
            if (proc?.exitCode !== 0) {
                const detail = outputLines.join('').trimEnd();
                const msg = detail
                    ? `uv pip install failed with exitCode: ${proc?.exitCode}\n${detail}`
                    : `uv pip install failed with exitCode: ${proc?.exitCode}`;
                deferred.reject(msg);
            } else {
                deferred.resolve();
            }
        },
    );
    return deferred.promise;
}

/**
 * Install dependencies into an existing uv-managed venv using `uv pip install`.
 * If `depInstallArgs` is provided, uses those directly (pre-resolved by the
 * auto-create flow). Otherwise, resolves which deps to install interactively.
 * Each source is installed independently so a failure in one does not block the others.
 */
export async function uvInstallDeps(
    workspace: WorkspaceFolder,
    progress: CreateEnvironmentProgress,
    token?: CancellationToken,
    depInstallArgs?: string[][],
): Promise<void> {
    progress.report({ message: CreateEnv.Trigger.installingDeps });

    const allArgs = depInstallArgs ?? (await pickDepInstallArgs(await collectDepSources(workspace)));
    if (allArgs.length === 0) {
        return;
    }

    const errors: string[] = [];
    for (const args of allArgs) {
        try {
            await runSingleInstall(args, workspace, token);
        } catch (err) {
            traceError('Failed to install dep source: ', err);
            errors.push(String(err));
        }
    }

    if (errors.length > 0) {
        throw errors.join('\n\n');
    }
}

/**
 * Auto-create a venv and install dependencies for a workspace.
 *
 * Routes through the existing Create Environment command so that creation
 * events fire (suppressing the "new venv" notification), the runtime is
 * auto-selected, and dependencies are installed.
 *
 * - uv available: uses the uv provider with auto-selected Python version
 *   and dep installation.
 * - uv not available: opens the standard Create Environment wizard so the
 *   user can pick an interpreter.
 */
export async function autoCreateVenvWithDeps(
    workspace: WorkspaceFolder,
    ctx: AutoCreateVenvContext,
): Promise<string | undefined> {
    // Resolve which deps to install BEFORE creating the venv,
    // so the user can cancel without a venv being created.
    const sources = await collectDepSources(workspace);
    const depArgs = await pickDepInstallArgs(sources);

    const options: Record<string, unknown> = {
        workspaceFolder: workspace,
        installPackages: depArgs.length > 0,
        ignoreSourceControl: true,
        selectEnvironment: true,
    };

    if (depArgs.length > 0) {
        options.depInstallArgs = depArgs;
    }

    if (ctx.uvAvailable) {
        options.providerId = UV_PROVIDER_ID;
        options.uvPythonVersion = 'auto';
    }

    const result = await executeCommand(Commands.Create_Environment, options);
    return (result as { path?: string })?.path;
}
