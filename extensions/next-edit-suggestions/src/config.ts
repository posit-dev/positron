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
		.get<Record<string, boolean>>('enabled');

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
 * 1. `positron.assistant.aiExcludes` -- file excluded from all AI features.
 * 2. `nextEditSuggestions.enabled` -- per-language ID, then filename glob.
 * 3. `nextEditSuggestions.enabled` -- `*` wildcard.
 */
export function isCompletionEnabled(document: vscode.TextDocument): boolean {
	if (isFileExcludedFromAI(document.uri)) {
		log.debug(`AI features are disabled for ${document.uri.fsPath} based on positron.assistant.aiExcludes configuration.`);
		return false;
	}

	const enabled = isCompletionEnabledForFileType(document);
	if (!enabled) {
		log.debug(`Inline completions are disabled for ${document.uri.fsPath} based on nextEditSuggestions.enabled configuration.`);
	}
	return enabled;
}

/**
 * Migrates the renamed `nextEditSuggestions.enable` setting to `nextEditSuggestions.enabled`.
 */
export async function migrateEnabledSetting(log: vscode.LogOutputChannel): Promise<void> {
	const config = vscode.workspace.getConfiguration('nextEditSuggestions');
	const oldValue = config.inspect<Record<string, boolean>>('enable');
	const newValue = config.inspect<Record<string, boolean>>('enabled');
	if (!oldValue) {
		return;
	}

	const scopes = [
		{ old: oldValue.globalValue, current: newValue?.globalValue, target: vscode.ConfigurationTarget.Global },
		{ old: oldValue.workspaceValue, current: newValue?.workspaceValue, target: vscode.ConfigurationTarget.Workspace },
	];

	for (const scope of scopes) {
		if (scope.old === undefined) {
			continue;
		}
		try {
			if (scope.current === undefined) {
				await config.update('enabled', scope.old, scope.target);
			}
			await config.update('enable', undefined, scope.target);
			log.info(`Migrated nextEditSuggestions.enable to nextEditSuggestions.enabled.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.warn(`Failed to migrate nextEditSuggestions.enable: ${message}`);
		}
	}
}
