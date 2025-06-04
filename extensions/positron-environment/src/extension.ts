/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getPandocPath } from './pandoc.js';

/**
 * Interface for the environment variable action. Mirrors the definition in the
 * configuration schema.
 */
interface EnvironmentVariableAction {
	/** The action to take */
	action: 'replace' | 'append' | 'prepend';

	/** The name of the variable */
	name: string;

	/** The value to replace, append, or remove */
	value: string;
};

/**
 * Apply the configuration for the environment variables.
 *
 * @param context The extension context.
 */
function applyConfiguration(context: vscode.ExtensionContext) {

	const vars = vscode.workspace.getConfiguration('positron.environment');

	// Clear the initial collection to remove any old values
	const collection = context.environmentVariableCollection;
	collection.clear();

	// Add the built-in variables to the collection. We always add these even if
	// the configuration-based variables are not enabled.
	addBuiltinVars(context);

	// Set the vars using the environment variable collection
	if (!vars.get('enabled')) {
		return;
	}

	// Set the collection description
	collection.description = vscode.l10n.t('Global Positron environment variables');

	// Get the configured environment variables
	const actions = vars.get<Array<EnvironmentVariableAction>>('variables') ?? [];
	for (const action of actions) {
		switch (action.action) {
			case 'replace':
				collection.replace(action.name, action.value);
				break;
			case 'append':
				collection.append(action.name, action.value);
				break;
			case 'prepend':
				collection.prepend(action.name, action.value);
				break;
		}
	}
}

/**
 * Activate the extension. Main entry point; called when the extension is
 * activated.
 *
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Apply the initial configuration values.
	applyConfiguration(context);

	// Register a listener for when the configuration changes and reapply
	// the configuration.
	const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('positron.environment')) {
			applyConfiguration(context);
		}
	});

	context.subscriptions.push(disposable);
}

/**
 * Adds built-in environment variables to the global environment variable
 * collection.
 *
 * @param context
 */
export function addBuiltinVars(context: vscode.ExtensionContext) {
	const collection = context.environmentVariableCollection;
	const pandocPath = getPandocPath();

	// Advertise the location of the Pandoc executable.
	if (pandocPath) {
		collection.replace('RSTUDIO_PANDOC', pandocPath);
	}
}
