/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

function matchesGlobPattern(fileName: string, pattern: string): boolean {
	const baseName = fileName.substring(fileName.lastIndexOf('/') + 1);

	if (pattern.startsWith('*.')) {
		const extension = pattern.substring(1);
		return baseName.toLowerCase().endsWith(extension.toLowerCase());
	}

	return baseName === pattern;
}

export function isCompletionEnabled(document: vscode.TextDocument): boolean {
	/* If a user has explicitly disabled assistant via the old method, honour that here too. */
	const assistantEnabled = vscode.workspace
		.getConfiguration('positron.assistant')
		.get<boolean>('enable', true);
	if (!assistantEnabled) {
		return false;
	}

	const enableConfig = vscode.workspace
		.getConfiguration('nextEditSuggestions')
		.get<Record<string, boolean>>('enable');

	const languageId = document.languageId;

	if (Object.hasOwn(enableConfig, languageId)) {
		return enableConfig[languageId];
	}

	const fileName = document.fileName;
	for (const key of Object.keys(enableConfig)) {
		if (key !== '*' && matchesGlobPattern(fileName, key)) {
			return enableConfig[key];
		}
	}

	return enableConfig['*'] ?? true;
}
