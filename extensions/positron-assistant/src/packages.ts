/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Structure representing a language model tool as returned by the API
 */
interface LanguageModelToolInfo {
	id: string;
	name: string;
	displayName?: string;
	tags?: string[];
	sourceProviderName?: string;
}

/**
 * Gets the installed packages for the specified language using language model tools.
 *
 * @param languageId The language ID ('r' or 'python')
 * @returns A promise resolving to an object containing installed package information
 */
export async function getInstalledPackages(languageId?: string): Promise<{
	r?: string[];
	python?: string[];
}> {
	const result: { r?: string[]; python?: string[] } = {};

	// Determine which languages to query
	const languagesToCheck = languageId ? [languageId.toLowerCase()] : ['r', 'python'];

	// Process each language in parallel
	const promises = languagesToCheck.map(async language => {
		try {
			const packages = await getPackagesForLanguage(language);
			if (packages && packages.length > 0) {
				result[language as 'r' | 'python'] = packages;
			}
		} catch (error) {
			console.error(`Error getting ${language} packages:`, error);
		}
	});

	await Promise.all(promises);
	return result;
}

/**
 * Gets installed packages for a specific language using language model tools.
 *
 * @param languageId The language ID ('r' or 'python')
 * @returns A promise resolving to an array of package names
 */
async function getPackagesForLanguage(languageId: string): Promise<string[] | undefined> {
	// Get all language model tools
	const tools = await vscode.commands.executeCommand<LanguageModelToolInfo[]>(
		'vscode.lm.getLanguageModelTools'
	);

	if (!tools) {
		return undefined;
	}

	// Find the getAttachedPackages tool for the specified language
	const toolName = 'getAttachedPackages';
	const tool = tools.find(t =>
		t.name === toolName &&
		t.tags?.includes('positron-assistant') &&
		// The tools are registered under the extensions that match the language
		(languageId === 'r' && t.sourceProviderName === 'positron.positron-r' ||
			languageId === 'python' && t.sourceProviderName === 'positron.positron-python')
	);

	if (!tool) {
		console.log(`No ${toolName} tool found for ${languageId}`);
		return undefined;
	}

	try {
		// Invoke the tool with empty input (or we could pass an empty object {})
		const response = await vscode.commands.executeCommand<string>(
			'vscode.lm.invokeLanguageModelTool',
			tool.id,
			{}
		);

		if (!response) {
			return undefined;
		}

		// Parse the response, which should be a JSON string
		return JSON.parse(response);
	} catch (error) {
		console.error(`Error invoking ${toolName} for ${languageId}:`, error);
		return undefined;
	}
}

/**
 * Gets a specific package version for the specified language.
 *
 * @param languageId The language ID ('r' or 'python')
 * @param packageName The name of the package to check
 * @returns A promise resolving to the package version string or undefined if not found
 */
export async function getPackageVersion(
	languageId: string,
	packageName: string
): Promise<string | undefined> {
	// Get all language model tools
	const tools = await vscode.commands.executeCommand<LanguageModelToolInfo[]>(
		'vscode.lm.getLanguageModelTools'
	);

	if (!tools) {
		return undefined;
	}

	// Find the getInstalledPackageVersion tool for the specified language
	const toolName = 'getInstalledPackageVersion';
	const tool = tools.find(t =>
		t.name === toolName &&
		t.tags?.includes('positron-assistant') &&
		(languageId === 'r' && t.sourceProviderName === 'positron.positron-r' ||
			languageId === 'python' && t.sourceProviderName === 'positron.positron-python')
	);

	if (!tool) {
		console.log(`No ${toolName} tool found for ${languageId}`);
		return undefined;
	}

	try {
		// Invoke the tool with the package name as input
		const response = await vscode.commands.executeCommand<string>(
			'vscode.lm.invokeLanguageModelTool',
			tool.id,
			{ packageName }
		);

		// The tool returns NULL (or a string "NULL") if the package is not installed
		if (!response || response === 'NULL') {
			return undefined;
		}

		return response;
	} catch (error) {
		console.error(`Error getting version for ${packageName} in ${languageId}:`, error);
		return undefined;
	}
}
