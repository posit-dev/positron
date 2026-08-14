/* eslint-disable max-classes-per-file */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { traceInfo, traceVerbose, traceWarn } from '../logging';
import { IWorkspaceService } from '../common/application/types';
import { IInterpreterService } from '../interpreter/contracts';
import { PythonEnvironment } from '../pythonEnvironments/info';

export class PromiseHandles<T> {
    resolve!: (value: T | Promise<T>) => void;

    reject!: (error: unknown) => void;

    promise: Promise<T>;

    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function whenTimeout<T>(ms: number, fn: () => T): Promise<T> {
    await delay(ms);
    return fn();
}

/**
 * Returns the ConfigurationTarget and resource Uri for the current workspace state:
 * - No workspace folder: Global with undefined resource
 * - Multi-folder workspace (.code-workspace): Workspace with workspace file uri
 * - Single folder workspace: WorkspaceFolder with folder[0] uri
 */
export function getActiveInterpreterConfigTarget(workspaceService: IWorkspaceService): {
    configTarget: vscode.ConfigurationTarget;
    folderUri: vscode.Uri | undefined;
} {
    const { workspaceFolders } = workspaceService;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return { configTarget: vscode.ConfigurationTarget.Global, folderUri: undefined };
    }
    if (workspaceService.workspaceFile) {
        return { configTarget: vscode.ConfigurationTarget.Workspace, folderUri: workspaceService.workspaceFile };
    }
    return { configTarget: vscode.ConfigurationTarget.WorkspaceFolder, folderUri: workspaceFolders[0].uri };
}

// Check if the current workspace contains files matching any of the passed glob ptaterns
export async function hasFiles(includes: string[]): Promise<boolean> {
    // Create a single glob pattern e.g. ['a', 'b'] => '{a,b}'
    const include = `{${includes.join(',')}}`;
    traceVerbose(`Searching for _files_ with pattern: ${include}`);

    // Exclude node_modules for performance reasons
    const files = await vscode.workspace.findFiles(include, '**/node_modules/**', 1);
    traceVerbose(`Found _files_: ${files.map((file) => file.fsPath)}`);

    return files.length > 0;
}

/** Time budget for a single PET interpreter resolve request. */
export const RESOLVE_TIMEOUT_MS = 15_000;

/** Time budget for the interpreter refresh between resolve attempts. */
export const REFRESH_TIMEOUT_MS = 60_000;

/**
 * Race a promise against a timeout. Clears the timer once the race settles so
 * callers (and unit test runs) do not accumulate pending timers.
 */
async function raceWithTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => {
                    onTimeout();
                    resolve(undefined);
                }, ms);
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

/** A single bounded resolve attempt; errors and timeouts count as unresolved. */
async function resolveInterpreterOnce(
    interpreterService: IInterpreterService,
    pythonPath: string,
    resource?: vscode.Uri,
): Promise<PythonEnvironment | undefined> {
    try {
        return await raceWithTimeout(
            interpreterService.getInterpreterDetails(pythonPath, resource),
            RESOLVE_TIMEOUT_MS,
            () => traceWarn(`Timed out resolving interpreter ${pythonPath} after ${RESOLVE_TIMEOUT_MS}ms`),
        );
    } catch (err) {
        traceWarn(`Error resolving interpreter ${pythonPath}: ${err}`);
        return undefined;
    }
}

/**
 * Resolve an interpreter path to a PythonEnvironment, retrying once after an
 * interpreter refresh if the first attempt fails.
 *
 * A single resolve can transiently fail (or hang) when PET is under load or
 * has not yet discovered the environment, even for an interpreter that is
 * perfectly valid; see https://github.com/posit-dev/positron/issues/15128.
 * Each attempt is bounded by RESOLVE_TIMEOUT_MS and the refresh by
 * REFRESH_TIMEOUT_MS so a non-responsive PET cannot stall the caller
 * indefinitely. Returns undefined if the interpreter still does not resolve;
 * callers decide whether that is fatal.
 */
export async function resolveInterpreterWithRetry(
    interpreterService: IInterpreterService,
    pythonPath: string,
    resource?: vscode.Uri,
): Promise<PythonEnvironment | undefined> {
    const interpreter = await resolveInterpreterOnce(interpreterService, pythonPath, resource);
    if (interpreter) {
        return interpreter;
    }

    traceInfo(`Interpreter ${pythonPath} did not resolve; triggering an interpreter refresh and retrying...`);
    try {
        await raceWithTimeout(interpreterService.triggerRefresh(), REFRESH_TIMEOUT_MS, () =>
            traceWarn(`Timed out waiting for interpreter refresh after ${REFRESH_TIMEOUT_MS}ms`),
        );
    } catch (err) {
        traceWarn(`Interpreter refresh failed: ${err}`);
    }

    return resolveInterpreterOnce(interpreterService, pythonPath, resource);
}
