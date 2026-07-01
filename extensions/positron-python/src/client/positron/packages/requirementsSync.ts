/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Keeps a workspace-root `requirements.txt` in sync after an explicit package
 * install or uninstall. Decoupled from the package operation itself: it only
 * edits an already-existing file, and any read/write failure surfaces a warning
 * but never fails the operation (mirrors the R `renv::snapshot()` behavior).
 */

import * as vscode from 'vscode';
import { IFileSystem } from '../../common/platform/types';
import { appendPackage, removePackage } from './requirementsEditor';
import { normalizePackageName } from './requirementsFile';

/**
 * Whether auto-updating `requirements.txt` after package operations is enabled.
 * Controlled by `packages.python.autoUpdateRequirements` (default: true). Read
 * live so a mid-session toggle takes effect without a reload.
 */
export function isAutoUpdateRequirementsEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('packages.python')
        .get<boolean>('autoUpdateRequirements', true);
}

/**
 * Apply `edit` to the file's content and write it back only if it changed. A
 * failure to read or write warns the user (the package op already succeeded)
 * and is otherwise swallowed.
 */
async function editRequirementsFile(
    fileSystem: IFileSystem,
    requirementsPath: string,
    edit: (content: string) => string,
): Promise<void> {
    try {
        const content = await fileSystem.readFile(requirementsPath);
        const updated = edit(content);
        if (updated !== content) {
            await fileSystem.writeFile(requirementsPath, updated);
        }
    } catch {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Failed to update requirements.txt. It may now be out of date.'),
        );
    }
}

/** Append each requested package that `getPackages` confirms is now installed. */
export async function addInstalledToRequirements(
    fileSystem: IFileSystem,
    requirementsPath: string,
    requestedNames: string[],
    installedNames: string[],
): Promise<void> {
    const installed = new Set(installedNames.map(normalizePackageName));
    const confirmed = requestedNames.filter((name) => installed.has(normalizePackageName(name)));
    if (confirmed.length === 0) {
        return;
    }
    await editRequirementsFile(fileSystem, requirementsPath, (content) =>
        confirmed.reduce((acc, name) => appendPackage(acc, name), content),
    );
}

/** Remove each requested package that `getPackages` confirms is now absent. */
export async function removeUninstalledFromRequirements(
    fileSystem: IFileSystem,
    requirementsPath: string,
    requestedNames: string[],
    installedNames: string[],
): Promise<void> {
    const installed = new Set(installedNames.map(normalizePackageName));
    const confirmed = requestedNames.filter((name) => !installed.has(normalizePackageName(name)));
    if (confirmed.length === 0) {
        return;
    }
    await editRequirementsFile(fileSystem, requirementsPath, (content) =>
        confirmed.reduce((acc, name) => removePackage(acc, name), content),
    );
}
