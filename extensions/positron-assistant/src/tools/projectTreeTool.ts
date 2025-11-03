/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../extension.js';

/**
 * Represents either a file or a directory
 */
type DirectoryItem = string;

type DirectoryInfo = {
	folder: vscode.WorkspaceFolder;
	items: DirectoryItem[];
	totalFiles: number;
};

interface ProjectTreeInput {
	include?: string[];
	exclude?: string[];
	replaceDefaultExcludes?: boolean;
	excludeSettings?: string;
	ignoreFiles?: boolean;
	filterResults?: boolean;
	maxFiles?: number;
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

		log.debug(`[${PositronAssistantToolName.ProjectTree}] Constructing project tree for ${workspaceFolders.length} workspace folders...`);

		// Parse the input options
		const { include, exclude, replaceDefaultExcludes, excludeSettings, ignoreFiles, filterResults, maxFiles } = options.input;

		log.trace(`[${PositronAssistantToolName.ProjectTree}] Invoked with options: ${JSON.stringify(options.input, null, 2)}`);

		if (!include || include.length === 0) {
			throw new Error(`The 'include' parameter is required. Specify glob patterns to target specific files (e.g., ["src/**/*.py"], ["*.ts", "tests/**"]).`);
		}

		const filePatterns = include;
		const excludePatterns = exclude ?? [];
		const filterResultsEnabled = filterResults ?? DEFAULT_FILTER_RESULTS;
		// Don't allow more than the default max files, even if a higher value is provided,
		// to prevent excessive token usage.
		const filesLimit = maxFiles && maxFiles < DEFAULT_MAX_FILES
			? maxFiles
			: DEFAULT_MAX_FILES;

		let findOptions: vscode.FindFiles2Options;
		if (filterResultsEnabled) {
			findOptions = {
				exclude: replaceDefaultExcludes ? excludePatterns : [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns],
				useIgnoreFiles: ignoreFiles === false ? undefined : DEFAULT_USE_IGNORE_FILES,
				useExcludeSettings: excludeSettings ? getExcludeSettingOptions(excludeSettings) : DEFAULT_EXCLUDE_SETTING_OPTIONS,
			};
		} else {
			findOptions = {
				exclude: undefined,
				useIgnoreFiles: {
					local: false,
					parent: false,
					global: false,
				},
				useExcludeSettings: vscode.ExcludeSettingOptions.None,
			};
		}


		log.trace(`[${PositronAssistantToolName.ProjectTree}] Constructing project tree with options: ${JSON.stringify({
			include: filePatterns,
			exclude: findOptions.exclude,
			useIgnoreFiles: findOptions.useIgnoreFiles,
			useExcludeSettings: findOptions.useExcludeSettings,
			filterResults: filterResultsEnabled,
			maxFiles: filesLimit,
		}, null, 2)}`);

		// Construct the project tree
		const workspaceTrees: DirectoryInfo[] = [];
		for (const folder of workspaceFolders) {
			// NOTE: this will not include empty directories :/
			const matchedFileUris = await vscode.workspace.findFiles2(
				filePatterns,
				findOptions,
				token
			);
			const items = matchedFileUris.map(uri => vscode.workspace.asRelativePath(uri, false));
			workspaceTrees.push({ folder, items, totalFiles: matchedFileUris.length });
		}

		const totalFiles = workspaceTrees.reduce((sum, obj) => sum + obj.totalFiles, 0);

		log.debug(`[${PositronAssistantToolName.ProjectTree}] Project tree constructed with ${totalFiles} items across ${workspaceFolders.length} workspace folders.`);
		if (totalFiles > filesLimit) {
			log.debug(`[${PositronAssistantToolName.ProjectTree}] Project tree exceeds the limit of ${filesLimit} items. A summary will be returned for each workspace folder.`);
		}

		// Return a compressed description of the project tree if there are too many items
		const itemLimit = Math.floor(filesLimit / workspaceTrees.length);
		const results = workspaceTrees.map(obj => obj.items
			.sort((a, b) => a.length - b.length) // Shortest paths first
			.slice(0, itemLimit) // Remove deepest paths to fit within the limit
			.sort((a, b) => a.localeCompare(b)) // Resort alphabetically
			.join('\n'));

		return new vscode.LanguageModelToolResult(results.map(r => new vscode.LanguageModelTextPart(r)));
	}
});

/**
 * Convert from the tool input excludeSettings to the vscode.ExcludeSettingOptions
 * @param excludeSetting The exclude setting from the tool input.
 * @returns The corresponding vscode.ExcludeSettingOptions value.
 */
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

// Default values for the project tree tool options
const DEFAULT_MAX_FILES = 50;
const DEFAULT_FILTER_RESULTS = true;
const DEFAULT_USE_IGNORE_FILES = { local: true, parent: true, global: true };
const DEFAULT_EXCLUDE_SETTING_OPTIONS = vscode.ExcludeSettingOptions.SearchAndFilesExclude;
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
	'package-lock.json',
	'yarn.lock',
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
