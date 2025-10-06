/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getModelConfigurations, SecretStorage } from '../config.js';

export const CLEAR_PROVIDERS_COMMAND = 'positron-assistant.clearModelProviders';

export function registerConfigurationCommands(context: vscode.ExtensionContext, storage: SecretStorage) {
	vscode.commands.registerCommand(CLEAR_PROVIDERS_COMMAND, async () => {
		// clear saved providers
		const modelConfigs = await getModelConfigurations(context, storage);
		modelConfigs.forEach((config) => {
			if (config.apiKey) {
				storage.delete(`apiKey-${config.id}`);
			}
		});
		context.globalState.update('positron.assistant.models', []);

		// clear chat sessions
		vscode.commands.executeCommand('workbench.action.chat.clearHistory');
	});
}
