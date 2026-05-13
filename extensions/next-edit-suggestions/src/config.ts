/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { log } from './extension.js';
import minimatch from 'minimatch';

function isFileExcludedFromAI(uri: vscode.Uri): boolean {
	const config = vscode.workspace.getConfiguration('positron.assistant');

	let patterns = config.get<string[]>('aiExcludes');
	const inspect = config.inspect<string[]>('aiExcludes');
	if (!inspect?.globalValue && !inspect?.workspaceValue) {
		patterns = config.get<string[]>('inlineCompletionExcludes');
	}

	if (!patterns || patterns.length === 0) {
		return false;
	}

	return patterns.some(pattern => {
		if (!pattern.includes('/')) {
			return minimatch(path.basename(uri.path), pattern, { dot: true });
		}
		return minimatch(uri.path, pattern, { dot: true });
	});
}

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

	/* Check if the file is excluded from AI features based on user configuration. */
	if (isFileExcludedFromAI(document.uri)) {
		log.debug(`AI features are disabled for ${document.uri.fsPath} based on user configuration.`);
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
