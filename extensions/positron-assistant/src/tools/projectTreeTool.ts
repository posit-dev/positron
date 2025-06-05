/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantToolName } from '../types.js';

/**
 * Represents either a file (string) or a directory (tuple with string and children).
 */
type DirectoryItem = string | [string, DirectoryItem[]];

interface ProjectTreeInput {
	include?: string[];
	exclude?: string[];
	replaceDefaultExcludes?: boolean;
	excludeSettings?: string;
	ignoreFiles?: boolean;
	maxResults?: number;
}

export const ProjectTreeTool = vscode.lm.registerTool<ProjectTreeInput>(PositronAssistantToolName.ProjectTree, {
	prepareInvocation: async (_options, _token) => {
		return {
			// The message shown when the code is actually executing.
			// Positron appends '...' to this message.
			invocationMessage: vscode.l10n.t('Constructing project tree'),
			pastTenseMessage: vscode.l10n.t('Constructed project tree'),
		};
	},
	/**
	 * Called to get the project tree.
	 * @param options The options for the tool invocation.
	 * @param token The cancellation token.
	 * @returns A vscode.LanguageModelToolResult containing the project tree.
	 */
	invoke: async (options, token) => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error(`Can't construct project tree because no workspace folders are open. Open a workspace folder before using this tool.`);
		}

		// Parse the input options
		const { include, exclude, replaceDefaultExcludes, excludeSettings, ignoreFiles, maxResults } = options.input;
		const filePatterns = include ?? DEFAULT_INCLUDE_PATTERNS;
		const excludePatterns = exclude ?? [];
		const findOptions: vscode.FindFiles2Options = {
			exclude: replaceDefaultExcludes ? excludePatterns : [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns],
			useIgnoreFiles: ignoreFiles === false ? undefined : DEFAULT_USE_IGNORE_FILES,
			maxResults: maxResults ?? DEFAULT_MAX_RESULTS,
			useExcludeSettings: excludeSettings ? getExcludeSettingOptions(excludeSettings) : DEFAULT_EXCLUDE_SETTING_OPTIONS,
		};

		// Construct the project tree
		const workspaceTrees: DirectoryItem[] = [];
		let workspaceItems = 0;
		for (const folder of workspaceFolders) {
			// NOTE: this will not include empty directories
			const matchedFiles = await vscode.workspace.findFiles2(
				filePatterns,
				findOptions,
				token
			);

			const items = convertUrisToDirectoryItems(folder, matchedFiles);
			workspaceTrees.push(items);
			workspaceItems += matchedFiles.length;
		}

		console.log('$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$');
		console.log(`Project tree constructed with ${workspaceItems} items across ${workspaceFolders.length} workspace folders.`);
		console.log(workspaceTrees);
		console.log('$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$');

		// TODO: handle maxResults more effectively, e.g., by truncating the results if they exceed maxResults
		// May want to use the default maxResults for findFiles2, and use a separate input option to manage the token limit

		// Return the project tree as a JSON string to the model
		return new vscode.LanguageModelToolResult(
			workspaceTrees.map(dirTree => new vscode.LanguageModelTextPart(JSON.stringify(dirTree)))
		);
	}
});

function convertUrisToDirectoryItems(folder: vscode.WorkspaceFolder, uris: vscode.Uri[]): DirectoryItem {
	if (uris.length === 0) {
		return [folder.name, []];
	}

	// Sort the URIs to ensure consistent ordering
	uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

	const root: Record<string, any> = {};
	for (const uri of uris) {
		// Get the path relative to the workspace folder, e.g. src/myfolder/myfile.txt
		const relativePath = vscode.workspace.asRelativePath(uri, false);

		// Split the relative path into segments, e.g. ['src', 'myfolder', 'myfile.txt']
		const segments = relativePath.split('/');
		let node = root;

		// Iterate through the segments to build the directory structure
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			const isLastSegment = i === segments.length - 1;
			if (isLastSegment) {
				node[segment] = null;
			} else {
				node[segment] = node[segment] || {};
				node = node[segment];
			}
		}
	}

	// Convert the nested object structure to an array of DirectoryItems
	const toDirectoryItems = (node: Record<string, any>): DirectoryItem[] =>
		Object.entries(node).map(([name, value]) =>
			value === null ? name : [name, toDirectoryItems(value)]
		);

	return [folder.name, toDirectoryItems(root)];
}

function getExcludeSettingOptions(excludeSetting: string) {
	switch (excludeSetting) {
		case '':
			return vscode.ExcludeSettingOptions.None;
		case 'filesExclude':
			return vscode.ExcludeSettingOptions.FilesExclude;
		case 'searchAndFilesExclude':
			return vscode.ExcludeSettingOptions.SearchAndFilesExclude;
		default:
			return DEFAULT_EXCLUDE_SETTING_OPTIONS;
	}
}

const DEFAULT_MAX_RESULTS = 1000;
const DEFAULT_USE_IGNORE_FILES = { local: true, parent: true, global: true };
const DEFAULT_EXCLUDE_SETTING_OPTIONS = vscode.ExcludeSettingOptions.SearchAndFilesExclude;
const DEFAULT_INCLUDE_PATTERNS = ['**/*'];
const DEFAULT_EXCLUDE_PATTERNS = [
	// Directories
	'**/.build/**',
	'**/.git/**',
	'**/.devcontainer/**',
	'**/.hg/**',
	'**/.ipynb_checkpoints/**',
	'**/.pytest_cache/**',
	'**/.svn/**',
	'**/.venv/**',
	'**/.Rproj.user/**',
	'**/.vscode/**',
	'**/__pycache__/**',
	'**/dist/**',
	'**/node_modules/**',
	'**/renv/**',
	'**/venv/**',
	// Files
	'.DS_Store',
	'.RData',
	'.Rhistory',
	'desktop.ini',
	'Thumbs.db',
	// Wildcards
	'**/*.a',
	'**/*.bak',
	'**/*.csv~',
	'**/*.js.map',
	'**/*.log',
	'**/*.o',
	'**/*.pyo',
	'**/*.so',
	'**/*.tmp',
];
