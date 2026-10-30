/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Keeps a workspace-root `requirements.txt` in sync after an explicit package
 * install or uninstall from the Packages pane. Opt-in via
 * `packages.python.autoUpdateRequirements`: while the user hasn't set it, the
 * first change that would edit the file asks once per workspace whether to
 * enable it. Only an already-existing file is edited, and any failure warns
 * without failing the package operation.
 */

import * as vscode from 'vscode';
import { IFileSystem } from '../../common/platform/types';
import { IPersistentStateFactory } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { traceError } from '../../logging';
import { addRequirement, removeRequirement } from './requirementsEditor';
import { normalizePackageName } from './requirementsFile';

export const AUTO_UPDATE_REQUIREMENTS_SECTION = 'packages.python';
export const AUTO_UPDATE_REQUIREMENTS_SETTING = 'autoUpdateRequirements';
export const PROMPT_DISMISSED_STATE_KEY = 'positron.packages.autoUpdateRequirementsPromptDismissed';

/** A completed package operation whose requested packages may need syncing. */
export interface RequirementsChange {
    kind: 'install' | 'uninstall';
    packageNames: string[];
}

/** A confirmed change waiting on the opt-in prompt. */
export interface PendingChange {
    requirementsPath: string;
    change: RequirementsChange;
}

/**
 * Changes made while the prompt is on screen, in order. Defined only while a
 * prompt is showing, so concurrent operations queue instead of stacking prompts.
 */
let pendingChanges: PendingChange[] | undefined;

/**
 * Sync `requirementsPath` after `change` has run. Only packages the kernel
 * confirms were actually installed (or are now absent) are edited, since a
 * failed terminal command is indistinguishable from a successful one.
 *
 * When the setting is enabled the edit is written before this resolves. When
 * the user hasn't set it, an opt-in prompt is shown without waiting for an
 * answer, so the package operation isn't held up. Changes made while the
 * prompt is showing are queued and applied in order if the user enables it.
 */
export async function syncWorkspaceRequirements(
    serviceContainer: IServiceContainer,
    requirementsPath: string,
    change: RequirementsChange,
    getInstalledNames: () => Promise<string[]>,
): Promise<void> {
    const fileSystem = serviceContainer.get<IFileSystem>(IFileSystem);
    try {
        // Judge the change against the file as it will be once queued changes
        // apply, so undoing a queued install is queued too.
        let content = await fileSystem.readFile(requirementsPath);
        for (const item of pendingChanges ?? []) {
            if (item.requirementsPath === requirementsPath) {
                content = applyChange(content, item.change);
            }
        }
        if (applyChange(content, change) === content) {
            return;
        }

        if (getSyncDecision(serviceContainer, requirementsPath) === 'skip') {
            return;
        }

        const installed = new Set((await getInstalledNames()).map(normalizePackageName));
        const confirmed: RequirementsChange = {
            kind: change.kind,
            packageNames: change.packageNames.filter(
                (name) => installed.has(normalizePackageName(name)) === (change.kind === 'install'),
            ),
        };
        if (applyChange(content, confirmed) === content) {
            return;
        }

        // Decide again: the prompt may have been answered during the query.
        const decision = getSyncDecision(serviceContainer, requirementsPath);
        if (decision === 'skip') {
            return;
        }
        if (pendingChanges) {
            // Queue even when just enabled: Enable may still be writing the
            // queue, and it applies items appended while it runs, in order.
            pendingChanges.push({ requirementsPath, change: confirmed });
        } else if (decision === 'write') {
            await applyToFile(fileSystem, { requirementsPath, change: confirmed });
        } else {
            const pending = [{ requirementsPath, change: confirmed }];
            pendingChanges = pending;
            void promptToEnable(serviceContainer, pending);
        }
    } catch (err) {
        warnSyncFailed(err);
    }
}

/**
 * Ask whether to keep `requirements.txt` in sync. Enable turns the setting on
 * for the user and applies every change in `pending`, which may grow while the
 * prompt is showing. Not Now stops asking in this workspace. Closing the
 * notification without choosing asks again next time. Never rejects: a
 * failure is reported as a warning.
 */
export async function promptToEnable(serviceContainer: IServiceContainer, pending: PendingChange[]): Promise<void> {
    try {
        const enable = vscode.l10n.t('Enable');
        const notNow = vscode.l10n.t('Not Now');
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t(
                'Positron can keep requirements.txt in sync with packages you install and uninstall. Lines it changes are marked with a "# added by Positron" or "# removed by Positron" comment.',
            ),
            enable,
            notNow,
        );

        if (choice === notNow) {
            await serviceContainer
                .get<IPersistentStateFactory>(IPersistentStateFactory)
                .createWorkspacePersistentState<boolean>(PROMPT_DISMISSED_STATE_KEY, false)
                .updateValue(true);
            return;
        }
        if (choice !== enable) {
            return;
        }

        await vscode.workspace
            .getConfiguration(AUTO_UPDATE_REQUIREMENTS_SECTION)
            .update(AUTO_UPDATE_REQUIREMENTS_SETTING, true, vscode.ConfigurationTarget.Global);
        const fileSystem = serviceContainer.get<IFileSystem>(IFileSystem);
        for (const item of pending) {
            try {
                await applyToFile(fileSystem, item);
            } catch (err) {
                warnSyncFailed(err);
            }
        }
    } catch (err) {
        warnSyncFailed(err);
    } finally {
        // Cleared with no await after the last write, so a change can't be
        // queued after the queue has finished applying and then be lost.
        if (pendingChanges === pending) {
            pendingChanges = undefined;
        }
    }
}

function applyChange(content: string, change: RequirementsChange): string {
    const edit = change.kind === 'install' ? addRequirement : removeRequirement;
    return change.packageNames.reduce((acc, name) => edit(acc, name), content);
}

/**
 * Apply `change` to the file as it is now, so edits saved while the kernel was
 * queried or the prompt was showing aren't overwritten.
 */
async function applyToFile(fileSystem: IFileSystem, { requirementsPath, change }: PendingChange): Promise<void> {
    const content = await fileSystem.readFile(requirementsPath);
    const updated = applyChange(content, change);
    if (updated !== content) {
        await fileSystem.writeFile(requirementsPath, updated);
    }
}

/**
 * `write` when the user enabled syncing, `prompt` when they haven't set the
 * setting and haven't dismissed the prompt for this workspace, else `skip`.
 * Resolved for the file's folder, since the setting is resource-scoped.
 */
function getSyncDecision(serviceContainer: IServiceContainer, requirementsPath: string): 'write' | 'prompt' | 'skip' {
    const config = vscode.workspace.getConfiguration(
        AUTO_UPDATE_REQUIREMENTS_SECTION,
        vscode.Uri.file(requirementsPath),
    );
    const inspected = config.inspect<boolean>(AUTO_UPDATE_REQUIREMENTS_SETTING);
    const userSet = [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue].some(
        (value) => value !== undefined,
    );
    if (userSet) {
        return config.get<boolean>(AUTO_UPDATE_REQUIREMENTS_SETTING) === true ? 'write' : 'skip';
    }
    const dismissed = serviceContainer
        .get<IPersistentStateFactory>(IPersistentStateFactory)
        .createWorkspacePersistentState<boolean>(PROMPT_DISMISSED_STATE_KEY, false).value;
    return dismissed ? 'skip' : 'prompt';
}

function warnSyncFailed(err: unknown): void {
    traceError(`Failed to update requirements.txt: ${err}`);
    void vscode.window.showWarningMessage(
        vscode.l10n.t(
            'The package operation succeeded, but requirements.txt could not be updated and may be out of date: {0}',
            err instanceof Error ? err.message : String(err),
        ),
    );
}
