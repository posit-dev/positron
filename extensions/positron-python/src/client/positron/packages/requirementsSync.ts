/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Keeps a workspace-root `requirements.txt` in sync after a package install or
 * uninstall through the package manager. Opt-in via
 * `packages.python.autoUpdateRequirements`: while the user hasn't set it, the
 * first change that would edit the file asks whether to enable it, and either
 * answer is saved to the user's settings. Only an already-existing file is
 * edited, and any failure warns without failing the package operation.
 */

import * as vscode from 'vscode';
import { IFileSystem } from '../../common/platform/types';
import { IServiceContainer } from '../../ioc/types';
import { traceError } from '../../logging';
import { addRequirement, removeRequirement, usesHashes } from './requirementsEditor';
import { normalizePackageName } from './requirementsFile';

export const AUTO_UPDATE_REQUIREMENTS_SECTION = 'packages.python';
export const AUTO_UPDATE_REQUIREMENTS_SETTING = 'autoUpdateRequirements';

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
 * True while Enable is applying `pendingChanges`. Changes made then are queued
 * behind it so they apply in order; otherwise an enabled sync writes directly.
 */
let applyingQueue = false;

/**
 * Sync `requirementsPath` after `change` has run. Only packages the kernel
 * confirms were actually installed (or are now absent) are edited, since a
 * failed terminal command is indistinguishable from a successful one.
 *
 * When the setting is enabled the edit is written before this resolves. When
 * the user hasn't set it, an opt-in prompt is shown without waiting for an
 * answer, so the package operation isn't held up. Changes made while the
 * prompt is showing are queued and applied in order if the user enables it.
 * An install into a file that uses hashes is never written: it warns instead.
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

        if (getSyncDecision(requirementsPath) === 'skip') {
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
        const decision = getSyncDecision(requirementsPath);
        const item = { requirementsPath, change: confirmed };
        if (decision === 'skip') {
            return;
        }
        if (applyingQueue && pendingChanges) {
            pendingChanges.push(item);
        } else if (decision === 'write') {
            // The setting was turned on while a prompt may still be showing:
            // apply its queue first, in order, so nothing queued is lost.
            await applyAll(fileSystem, [...(pendingChanges?.splice(0) ?? []), item]);
        } else if (confirmed.kind === 'install' && usesHashes(content)) {
            // Don't ask to enable an edit that would only warn.
            return;
        } else if (pendingChanges) {
            pendingChanges.push(item);
        } else {
            const pending = [item];
            pendingChanges = pending;
            void promptToEnable(serviceContainer, pending);
        }
    } catch (err) {
        warnSyncFailed(err);
    }
}

/**
 * Ask whether to keep `requirements.txt` in sync. Enable turns the setting on
 * in user settings and applies every change in `pending`, which may grow while
 * the prompt is showing. Don't Ask Again turns the setting off in user
 * settings. Closing the notification without choosing asks again next time.
 * Never rejects: a failure is reported as a warning.
 */
export async function promptToEnable(serviceContainer: IServiceContainer, pending: PendingChange[]): Promise<void> {
    try {
        const enable = vscode.l10n.t('Enable');
        const dontAskAgain = vscode.l10n.t("Don't Ask Again");
        const choice = await vscode.window.showInformationMessage(
            vscode.l10n.t(
                'Positron can keep requirements.txt in sync with packages you install and uninstall, in all workspaces. Lines it changes are marked with a "# added by Positron" or "# removed by Positron" comment. You can change this later in Settings.',
            ),
            enable,
            dontAskAgain,
        );
        if (choice !== enable && choice !== dontAskAgain) {
            return;
        }

        applyingQueue = choice === enable;
        await vscode.workspace
            .getConfiguration(AUTO_UPDATE_REQUIREMENTS_SECTION)
            .update(AUTO_UPDATE_REQUIREMENTS_SETTING, choice === enable, vscode.ConfigurationTarget.Global);
        if (choice === dontAskAgain) {
            return;
        }
        await applyAll(serviceContainer.get<IFileSystem>(IFileSystem), pending);
    } catch (err) {
        warnSyncFailed(err);
    } finally {
        // Cleared with no await after the last write, so a change can't be
        // queued after the queue has finished applying and then be lost.
        if (pendingChanges === pending) {
            pendingChanges = undefined;
            applyingQueue = false;
        }
    }
}

function applyChange(content: string, change: RequirementsChange): string {
    const edit = change.kind === 'install' ? addRequirement : removeRequirement;
    return change.packageNames.reduce((acc, name) => edit(acc, name), content);
}

/** Apply each item in order, warning about a failure without stopping. */
async function applyAll(fileSystem: IFileSystem, items: PendingChange[]): Promise<void> {
    for (const item of items) {
        try {
            await applyToFile(fileSystem, item);
        } catch (err) {
            warnSyncFailed(err);
        }
    }
}

/**
 * Apply `change` to the file as it is now, so edits saved while the kernel was
 * queried or the prompt was showing aren't overwritten. An install into a file
 * that uses hashes warns instead, since a bare unhashed entry breaks installs.
 */
async function applyToFile(fileSystem: IFileSystem, { requirementsPath, change }: PendingChange): Promise<void> {
    const content = await fileSystem.readFile(requirementsPath);
    if (change.kind === 'install' && usesHashes(content)) {
        warnHashedFile(change.packageNames);
        return;
    }
    const updated = applyChange(content, change);
    if (updated !== content) {
        await fileSystem.writeFile(requirementsPath, updated);
    }
}

/**
 * `write` when the user enabled syncing, `skip` when they disabled it, and
 * `prompt` when they haven't set it. Resolved for the file's folder, since the
 * setting is resource-scoped.
 */
function getSyncDecision(requirementsPath: string): 'write' | 'prompt' | 'skip' {
    const config = vscode.workspace.getConfiguration(
        AUTO_UPDATE_REQUIREMENTS_SECTION,
        vscode.Uri.file(requirementsPath),
    );
    const inspected = config.inspect<boolean>(AUTO_UPDATE_REQUIREMENTS_SETTING);
    const userSet = [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue].some(
        (value) => value !== undefined,
    );
    if (!userSet) {
        return 'prompt';
    }
    return config.get<boolean>(AUTO_UPDATE_REQUIREMENTS_SETTING) === true ? 'write' : 'skip';
}

function warnHashedFile(packageNames: string[]): void {
    void vscode.window.showWarningMessage(
        vscode.l10n.t(
            'requirements.txt uses hashes, so Positron did not add {0} to it. Add it with the tool that generated the file, such as pip-compile or uv.',
            packageNames.join(', '),
        ),
    );
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
