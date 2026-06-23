/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { log } from './extension.js';
import minimatch from 'minimatch';

const DEFAULT_BASE_URL = 'https://gateway.posit.ai';

function matchesGlobPattern(fileName: string, pattern: string): boolean {
	const baseName = fileName.substring(fileName.lastIndexOf('/') + 1);

	if (pattern.startsWith('*.')) {
		const extension = pattern.substring(1);
		return baseName.toLowerCase().endsWith(extension.toLowerCase());
	}

	return baseName === pattern;
}

export function getGatewayBaseUrl(): string {
	return vscode.workspace
		.getConfiguration('authentication.positai')
		.inspect<string>('baseUrl')?.globalValue
		?? DEFAULT_BASE_URL;
}

export function getSelectedCompletionModelId(): string {
	return vscode.workspace
		.getConfiguration('nextEditSuggestions')
		.get<string>('selectedCompletionModel') || '';
}

/**
 * Whether Positron's AI features are enabled. Gated on the Positron-owned
 * `ai.enabled` main switch. Next Edit Suggestions only work when AI is enabled.
 */
function isAIEnabled(): boolean {
	return vscode.workspace
		.getConfiguration('ai')
		.get<boolean>('enabled') === true;
}

function isFileExcludedFromAI(uri: vscode.Uri): boolean {
	const config = vscode.workspace.getConfiguration('positron.assistant');

	const patterns = config.get<string[]>('aiExcludes');
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

function isCompletionEnabledForFileType(document: vscode.TextDocument): boolean {
	const enableConfig = vscode.workspace
		.getConfiguration('nextEditSuggestions')
		.get<Record<string, boolean>>('enable');

	if (!enableConfig) {
		return true;
	}

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

/** Determines whether inline completions are enabled for a document.
 *
 * Checks are evaluated in order:
 * 1. `ai.enabled` -- main switch for Positron's AI features.
 * 2. `positron.assistant.aiExcludes` -- file excluded from all AI features.
 * 3. `nextEditSuggestions.enable` -- per-language ID, then filename glob.
 * 4. `nextEditSuggestions.enable` -- `*` wildcard.
 */
export function isCompletionEnabled(document: vscode.TextDocument): boolean {
	if (!isAIEnabled()) {
		log.debug('Inline completions are disabled because the ai.enabled setting is off.');
		return false;
	}

	if (isFileExcludedFromAI(document.uri)) {
		log.debug(`AI features are disabled for ${document.uri.fsPath} based on positron.assistant.aiExcludes configuration.`);
		return false;
	}

	const enabled = isCompletionEnabledForFileType(document);
	if (!enabled) {
		log.debug(`Inline completions are disabled for ${document.uri.fsPath} based on nextEditSuggestions.enable configuration.`);
	}
	return enabled;
}
