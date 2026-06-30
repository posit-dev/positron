/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from './log';

/**
 * On PWB, Posit AI defaults to disabled so admins control AI access.
 * Applied once on first activation; skipped afterwards so user or admin choices
 * are never overwritten.
 *
 * Since package.json doesn't support conditional defaults, we use globalState
 * to track whether we've applied the PWB default. This ensures:
 * - First run on PWB: Posit AI is disabled (unless already configured)
 * - Admin configures via policy: their choice is respected because we can't overwrite admin policies
 * - User changes the setting: their choice is preserved
 * - Subsequent runs: we don't overwrite existing choices
 *
 * See: https://github.com/posit-dev/positron/issues/12954
 */
export async function applyPwbPositAIDefault(
	context: vscode.ExtensionContext,
	isRunningOnPwb = !!process.env.RS_SERVER_URL && vscode.env.uiKind === vscode.UIKind.Web
): Promise<void> {
	if (!isRunningOnPwb) {
		return;
	}

	const pwbDefaultAppliedKey = 'positAI.pwbDefaultApplied';
	if (context.globalState.get<boolean>(pwbDefaultAppliedKey)) {
		return;
	}

	const config = vscode.workspace.getConfiguration('positron.assistant.provider.positAI');
	const currentValue = config.get<boolean>('enable');

	if (currentValue !== false) {
		const enableInspect = config.inspect<boolean>('enable');
		const hasExplicitValue = enableInspect?.globalValue !== undefined ||
			enableInspect?.workspaceValue !== undefined ||
			enableInspect?.workspaceFolderValue !== undefined;

		if (!hasExplicitValue) {
			try {
				await config.update('enable', false, vscode.ConfigurationTarget.Global);
			} catch (e) {
				// Setting may be enforced by admin policy; log and continue
				log.warn(`Posit AI enablement enforced by admin policy and cannot be updated: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	}

	await context.globalState.update(pwbDefaultAppliedKey, true);
}
