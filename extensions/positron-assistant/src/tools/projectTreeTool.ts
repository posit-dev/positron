/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../extension.js';

/**
 * Represents either a file (string) or a directory (tuple with string and children).
 */
type DirectoryItem = string | [string, DirectoryItem[]];

type DirectoryInfo = {
	folder: vscode.WorkspaceFolder;
	items: DirectoryItem;
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

		const filePatterns = include ?? DEFAULT_INCLUDE_PATTERNS;
		const excludePatterns = exclude ?? [];
		const filterResultsEnabled = filterResults ?? DEFAULT_FILTER_RESULTS;
		const filesLimit = maxFiles ?? DEFAULT_MAX_FILES;

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
			const items = convertUrisToDirectoryItems(folder, matchedFileUris);
			workspaceTrees.push({ folder, items, totalFiles: matchedFileUris.length });
		}

		const totalFiles = workspaceTrees.reduce((sum, obj) => sum + obj.totalFiles, 0);

		log.debug(`[${PositronAssistantToolName.ProjectTree}] Project tree constructed with ${totalFiles} items across ${workspaceFolders.length} workspace folders.`);

		// Return a compressed description of the project tree if there are too many items
		if (totalFiles > filesLimit) {
			const itemLimit = Math.floor(filesLimit / workspaceTrees.length);
			log.debug(`[${PositronAssistantToolName.ProjectTree}] Project tree exceeds the limit of ${filesLimit} items. A summary will be returned for each workspace folder.`);
			const summarizedTree = await getSummarizedProjectTree(workspaceTrees, itemLimit);
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart(`Project tree contains ${totalFiles} files, which exceeds the limit of ${filesLimit}. Here is a summary of each workspace, including the first ${itemLimit} files and directories:`),
				new vscode.LanguageModelTextPart(JSON.stringify(summarizedTree)),
			]);
		}

		// Return the project tree as a JSON string to the model
		return new vscode.LanguageModelToolResult(
			workspaceTrees.map(obj => new vscode.LanguageModelTextPart(JSON.stringify(obj)))
		);
	}
});

/**
 * Constructs a summarized project tree from the workspace trees.
 * @param workspaceTrees An array of DirectoryInfo objects representing the workspace folders and their contents.
 * @param itemLimit The maximum number of items to include in the summary for each workspace.
 *                  This is split evenly between files and directories.
 *                  For example, if itemLimit is 10, it will include 5 files and 5 directories.
 * @returns A summarized project tree object.
 */
async function getSummarizedProjectTree(workspaceTrees: DirectoryInfo[], itemLimit: number) {
	if (workspaceTrees.length === 0) {
		return {};
	}

	const summary = new Map<string, { files: string[]; directories: string[]; totalFiles: number; workspaceUri: string }>();
	for (const workspace of workspaceTrees) {
		summary.set(workspace.folder.name, {
			totalFiles: workspace.totalFiles,
			files: [],
			directories: [],
			workspaceUri: workspace.folder.uri.toString(),
		});

		// Get the top-level items in the workspace folder
		const items = (await vscode.workspace.fs.readDirectory(workspace.folder.uri));
		if (items.length === 0) {
			continue;
		}

		// Separate files and directories
		const files: string[] = [];
		const directories: string[] = [];
		for (const [name, type] of items) {
			if (type === vscode.FileType.File) {
				files.push(name);
			} else if (type === vscode.FileType.Directory) {
				directories.push(name);
			}
		}

		// Sort files and directories alphabetically
		files.sort();
		directories.sort();

		// Use half the limit for files and half for directories
		const fileLimit = Math.floor(itemLimit / 2);
		const dirLimit = itemLimit - fileLimit;

		// Slice the files and directories to fit within the limits
		summary.get(workspace.folder.name)!.files = files.slice(0, fileLimit);
		summary.get(workspace.folder.name)!.directories = directories.slice(0, dirLimit);
	}

	return Object.fromEntries(summary);
}

/**
 * Convert an array of URIs to a directory structure for a workspace folder.
 * @param folder The workspace folder to which the URIs belong.
 * @param uris The URIs of items in the project tree.
 * @returns DirectoryItem representing the directory structure of the workspace folder.
 */
function convertUrisToDirectoryItems(folder: vscode.WorkspaceFolder, uris: vscode.Uri[]): DirectoryItem {
	// If there are no URIs, return an empty directory structure for the folder
	if (uris.length === 0) {
		return [folder.name, []];
	}

	// Sort the URIs alphabetically (folders and files are sorted together)
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
const DEFAULT_MAX_FILES = 500;
const DEFAULT_FILTER_RESULTS = true;
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
