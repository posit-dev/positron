/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IS_RUNNING_ON_PWB } from './constants';
import { log } from './log';
import { ProviderCatalogOptions, resolveProvidersConfigPath, saveProviderEnabled } from './providerCatalog';

/** The levels this module logs at, so a test can supply its own sink. */
type PwbDefaultLogger = Pick<vscode.LogOutputChannel, 'debug' | 'info' | 'warn'>;

/**
 * On PWB, Posit AI Pass defaults to disabled so admins control AI access.
 * Applied once on first activation; skipped afterwards so user or admin choices
 * are never overwritten.
 *
 * Since package.json doesn't support conditional defaults, we use globalState
 * to track whether we've applied the PWB default. This ensures:
 * - First run on PWB: Posit AI Pass is disabled (unless already configured)
 * - Admin configures via policy: their choice is respected because we can't overwrite admin policies
 * - User changes the setting: their choice is preserved
 * - Subsequent runs: we don't overwrite existing choices
 *
 * Every branch logs which of those happened and to which file, so an admin
 * looking at a disabled Posit AI Pass can tell an applied default apart from
 * their own configuration without reverse-engineering providers.json.
 *
 * See: https://github.com/posit-dev/positron/issues/12954
 */
export async function applyPwbPositAIDefault(
	context: vscode.ExtensionContext,
	isRunningOnPwb = IS_RUNNING_ON_PWB,
	options?: ProviderCatalogOptions,
	logger: PwbDefaultLogger = log
): Promise<void> {
	if (!isRunningOnPwb) {
		return;
	}

	const pwbDefaultAppliedKey = 'positAI.pwbDefaultApplied';
	if (context.globalState.get<boolean>(pwbDefaultAppliedKey)) {
		// Debug, not info: this fires on every Workbench launch after the first,
		// and says nothing about the value in effect.
		logger.debug('Posit AI Pass: the Posit Workbench default was applied on an earlier run, skipping.');
		return;
	}

	const configPath = await resolveProvidersConfigPath(options);
	try {
		const wrote = await saveProviderEnabled('positai', false, /* onlyIfUnset */ true, options);
		if (wrote) {
			logger.info(
				`Posit AI Pass: applied the Posit Workbench default and set providers.positai.enabled to false in ${configPath}. `
				+ 'An admin or user can set "enabled" to true in that file to turn it back on.'
			);
		} else {
			logger.info(
				`Posit AI Pass: providers.positai.enabled is already set in ${configPath}, `
				+ 'so the Posit Workbench default was not applied.'
			);
		}
	} catch (error) {
		logger.warn(`Failed to write the Posit AI Pass PWB default to ${configPath}: ${error}`);
	}

	await context.globalState.update(pwbDefaultAppliedKey, true);
}
