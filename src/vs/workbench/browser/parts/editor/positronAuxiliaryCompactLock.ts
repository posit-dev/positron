/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Whether an auxiliary editor part may apply a compact-mode change.
 *
 * Windows opened with `lockCompact` treat compact mode as part of what they
 * are, not as a preference: a window opened as a chromeless single-purpose
 * surface is chromeless because it is compact, so no stray editor or menu
 * action may switch compact off. Allowing
 * the change would re-show the status bar and editor tabs in a surface opened
 * without workbench chrome, and because compact mode is persisted the window
 * would come back degraded on every later restore.
 *
 * Exported so the policy is testable: its only caller is a closure inside
 * `createAuxiliaryEditorPart` that no test can reach.
 */
export function shouldAllowCompactChange(lockCompact: boolean | undefined): boolean {
	return lockCompact !== true;
}
