/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';


export function activate(context: vscode.ExtensionContext) {
	const vars = vscode.workspace.getConfiguration('positron.environment');

	// Set the vars using the environment variable collection
	if (vars.get('enabled')) {
		const collection = context.environmentVariableCollection;
		collection.description = 'Global Positron environment variables';
		const variables = vars.get<Record<string, string>>('variables') ?? {};

		// Iterate through the configured environment variables and set them
		for (const key in variables) {
			if (Object.prototype.hasOwnProperty.call(variables, key)) {
				const value = variables[key];
				collection.replace(key, value);
			}
		}
	}
}
