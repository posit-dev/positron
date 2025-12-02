/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../extension.js';
import minimatch from 'minimatch';

/**
 * Represents either a file or a directory
 */
type DirectoryItem = string;

type DirectoryInfo = {
	folder: vscode.WorkspaceFolder;
	items: DirectoryItem[];
	totalItems: number;
};

interface ProjectTreeInput {
	include?: string[];
	exclude?: string[];
	skipDefaultExcludes?: boolean;
	maxItems?: number;
	directoriesOnly?: boolean;
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

		const { include, exclude, skipDefaultExcludes, maxItems, directoriesOnly } = options.input;

		log.trace(`[${PositronAssistantToolName.ProjectTree}] Invoked with options: ${JSON.stringify(options.input, null, 2)}`);

		if (!include || include.length === 0) {
			throw new Error(`The 'include' parameter is required. Specify glob patterns to target specific files (e.g., ["src/**/*.py"], ["*.ts", "tests/**"]).`);
		}

		const globPatterns = include;
		const excludePatterns = exclude ?? [];
		const skipExcludes = skipDefaultExcludes ?? false;
		const itemsLimit = maxItems && maxItems < DEFAULT_MAX_ITEMS
			? maxItems
			: DEFAULT_MAX_ITEMS;

		let findOptions: vscode.FindFiles2Options;
		if (skipExcludes) {
			// Skip all automatic exclusions, only use explicit exclude patterns
			findOptions = {
				exclude: excludePatterns.length > 0 ? excludePatterns : undefined,
				useIgnoreFiles: {
					local: false,
					parent: false,
					global: false,
				},
				useExcludeSettings: vscode.ExcludeSettingOptions.None,
			};
		} else {
			// Apply all exclusions: default patterns + .gitignore + VS Code settings
			findOptions = {
				exclude: [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns],
				useIgnoreFiles: DEFAULT_USE_IGNORE_FILES,
				useExcludeSettings: DEFAULT_EXCLUDE_SETTING_OPTIONS,
			};
		}


		log.trace(`[${PositronAssistantToolName.ProjectTree}] Constructing project tree with options: ${JSON.stringify({
			include: globPatterns,
			exclude: findOptions.exclude,
			useIgnoreFiles: findOptions.useIgnoreFiles,
			useExcludeSettings: findOptions.useExcludeSettings,
			skipDefaultExcludes: skipExcludes,
			maxItems: itemsLimit,
		}, null, 2)}`);

		// Construct the project tree
		const workspaceTrees: DirectoryInfo[] = [];
		for (const folder of workspaceFolders) {
			if (directoriesOnly) {
				const directories = await collectDirectories(
					folder.uri,
					globPatterns,
					skipExcludes ? excludePatterns : [...DEFAULT_DIRECTORY_EXCLUDE_PATTERNS, ...excludePatterns],
					token
				);
				workspaceTrees.push({ folder, items: directories, totalItems: directories.length });
			} else {
				// NOTE: this will not include empty directories :/
				const matchedFileUris = await vscode.workspace.findFiles2(
					globPatterns,
					findOptions,
					token
				);
				const items = matchedFileUris.map(uri => vscode.workspace.asRelativePath(uri, false));
				workspaceTrees.push({ folder, items, totalItems: matchedFileUris.length });
			}
		}

		const totalItems = workspaceTrees.reduce((sum, obj) => sum + obj.totalItems, 0);

		// If we applied default exclusions and results are very sparse, check if there are any excluded results.
		let hasExcludedResults = false;
		const sparseThreshold = Math.floor(itemsLimit / 10);
		if (!skipExcludes && totalItems < sparseThreshold) {
			log.debug(`[${PositronAssistantToolName.ProjectTree}] Default exclusions were applied and results were very sparse. Checking if any items were excluded...`);
			for (const folder of workspaceFolders) {
				if (directoriesOnly) {
					const dirs = await collectDirectories(
						folder.uri,
						globPatterns,
						excludePatterns,
						token,
						totalItems + 1
					);
					hasExcludedResults = dirs.length > totalItems;
				} else {
					const matchedUris = await vscode.workspace.findFiles2(
						globPatterns,
						{
							exclude: excludePatterns.length > 0 ? excludePatterns : undefined,
							useIgnoreFiles: {
								local: false,
								parent: false,
								global: false,
							},
							useExcludeSettings: vscode.ExcludeSettingOptions.None,
							maxResults: totalItems + 1,
						},
						token
					);
					hasExcludedResults = matchedUris.length > totalItems;
				}
				if (hasExcludedResults) {
					break;
				}
			}
		}

		log.debug(`[${PositronAssistantToolName.ProjectTree}] Project tree constructed with ${totalItems} items across ${workspaceFolders.length} workspace folders.`);
		if (totalItems > itemsLimit) {
			log.debug(`[${PositronAssistantToolName.ProjectTree}] Project tree exceeds the limit of ${itemsLimit} items. A summary will be returned for each workspace folder.`);
		}

		// Return a compressed description of the project tree if there are too many items
		const itemLimit = Math.floor(itemsLimit / workspaceTrees.length);
		const results = workspaceTrees.map(obj => obj.items
			.sort((a, b) => a.length - b.length) // Shortest paths first
			.slice(0, itemLimit) // Remove deepest paths to fit within the limit
			.sort((a, b) => a.localeCompare(b)) // Resort alphabetically
			.join('\n'));

		const resultParts = results.map(r => new vscode.LanguageModelTextPart(r));

		if (totalItems > itemsLimit) {
			const truncatedCount = Math.min(itemsLimit, totalItems);
			const truncationMessage = `Project tree constructed with ${totalItems} items; the first ${truncatedCount} are provided above.`;
			resultParts.push(new vscode.LanguageModelTextPart(truncationMessage));
		}

		if (hasExcludedResults) {
			const exclusionMessage = 'Results were excluded. Set `skipDefaultExcludes` to `true` to include them.';
			log.debug(`[${PositronAssistantToolName.ProjectTree}] ${exclusionMessage}`);
			resultParts.push(new vscode.LanguageModelTextPart(exclusionMessage));
		}

		return new vscode.LanguageModelToolResult(resultParts);
	}
});

// Default values for the project tree tool options
const DEFAULT_MAX_ITEMS = 50;
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

const DIRECTORY_SUFFIX = '/**';
const DEFAULT_DIRECTORY_EXCLUDE_PATTERNS = DEFAULT_EXCLUDE_PATTERNS
	.filter(p => p.endsWith(DIRECTORY_SUFFIX))
	.map(p => p.slice(0, -DIRECTORY_SUFFIX.length));

async function collectDirectories(
	workspaceUri: vscode.Uri,
	includePatterns: string[],
	excludePatterns: string[],
	token: vscode.CancellationToken,
	limit?: number
): Promise<string[]> {
	const directories: string[] = [];

	async function traverse(uri: vscode.Uri): Promise<void> {
		if (token.isCancellationRequested || (limit && directories.length >= limit)) {
			return;
		}

		try {
			const entries = await vscode.workspace.fs.readDirectory(uri);

			for (const [name, type] of entries) {
				if (limit && directories.length >= limit) {
					return;
				}
				if (type === vscode.FileType.Directory) {
					const dirUri = vscode.Uri.joinPath(uri, name);
					const relativePath = vscode.workspace.asRelativePath(dirUri, false);

					if (isExcluded(relativePath, excludePatterns)) {
						continue;
					}

					if (matchesInclude(relativePath, includePatterns)) {
						directories.push(relativePath + '/');
					}

					await traverse(dirUri);
				}
			}
		} catch (error) {
			log.warn(`[${PositronAssistantToolName.ProjectTree}] Failed to read directory ${uri.fsPath}: ${error}`);
		}
	}

	await traverse(workspaceUri);
	return directories;
}

function matchesInclude(relativePath: string, includePatterns: string[]): boolean {
	if (includePatterns.length === 0) {
		return true;
	}
	const pathWithSlash = relativePath + '/';
	return includePatterns.some(pattern =>
		minimatch(relativePath, pattern) || minimatch(pathWithSlash, pattern)
	);
}

function isExcluded(relativePath: string, excludePatterns: string[]): boolean {
	const pathWithSlash = relativePath + '/';
	return excludePatterns.some(pattern =>
		minimatch(relativePath, pattern) || minimatch(pathWithSlash, pattern)
	);
}
