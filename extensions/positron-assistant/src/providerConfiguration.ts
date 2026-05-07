/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PROVIDER_ENABLE_SETTINGS_SEARCH } from './constants.js';

/**
 * Validates that at least one language model provider is enabled.
 * If no providers are enabled, shows a warning message with an option to open settings.
 */
export async function validateProvidersEnabled(): Promise<void> {
	const enabledProviders = await positron.ai.getEnabledProviders();
	if (enabledProviders.length === 0) {
		const openSettings = vscode.l10n.t('Open Settings');
		const selection = await vscode.window.showWarningMessage(
			vscode.l10n.t(
				'No language model providers are enabled for Positron Assistant. Please enable at least one provider in the settings.'
			),
			openSettings
		);
		if (selection === openSettings) {
			await vscode.commands.executeCommand('workbench.action.openSettings', PROVIDER_ENABLE_SETTINGS_SEARCH);
		}
	}
}
