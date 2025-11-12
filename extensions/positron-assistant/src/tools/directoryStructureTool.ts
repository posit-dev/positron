/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../extension.js';
import minimatch from 'minimatch';

type DirectoryInfo = {
	folder: vscode.WorkspaceFolder;
	directories: string[];
	totalDirectories: number;
};

interface DirectoryStructureInput {
	path?: string;
	maxDepth?: number;
	maxDirectories?: number;
	include?: string[];
	exclude?: string[];
	skipDefaultExcludes?: boolean;
}

export const DirectoryStructureTool = vscode.lm.registerTool<DirectoryStructureInput>(PositronAssistantToolName.DirectoryStructure, {
	prepareInvocation: async (_options, _token) => {
		return {
			invocationMessage: vscode.l10n.t('Getting directory structure'),
			pastTenseMessage: vscode.l10n.t('Got directory structure'),
		};
	},
	invoke: async (options, token) => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error(`Can't get directory structure because no workspace folders are open. Open a workspace folder before using this tool.`);
		}

		log.debug(`[${PositronAssistantToolName.DirectoryStructure}] Getting directory structure for ${workspaceFolders.length} workspace folders...`);

		const { path, maxDepth, maxDirectories, include, exclude, skipDefaultExcludes } = options.input;

		log.trace(`[${PositronAssistantToolName.DirectoryStructure}] Invoked with options: ${JSON.stringify(options.input, null, 2)}`);

		// Enforce maxDepth limits (default: 1, max: 3)
		const depth = maxDepth
			? Math.min(Math.max(maxDepth, 1), 3)
			: 1;

		// Enforce maxDirectories limits (default: 50, max: 100)
		const directoriesLimit = maxDirectories && maxDirectories < 100
			? maxDirectories
			: DEFAULT_MAX_DIRECTORIES;

		const includePatterns = include ?? [];
		const excludePatterns = exclude ?? [];
		const skipExcludes = skipDefaultExcludes ?? false;

		log.trace(`[${PositronAssistantToolName.DirectoryStructure}] Getting directory structure with options: ${JSON.stringify({
			path,
			maxDepth: depth,
			maxDirectories: directoriesLimit,
			include: includePatterns,
			exclude: excludePatterns,
			skipDefaultExcludes: skipExcludes,
		}, null, 2)}`);

		const workspaceTrees: DirectoryInfo[] = [];
		for (const folder of workspaceFolders) {
			const startUri = path
				? vscode.Uri.joinPath(folder.uri, path)
				: folder.uri;

			try {
				await vscode.workspace.fs.stat(startUri);
			} catch (error) {
				throw new Error(`Path "${path}" does not exist in workspace folder "${folder.name}".`);
			}

			const directories = await collectDirectories(
				startUri,
				folder.uri,
				0,
				depth,
				includePatterns,
				excludePatterns,
				skipExcludes,
				token
			);

			workspaceTrees.push({
				folder,
				directories,
				totalDirectories: directories.length
			});
		}

		const totalDirectories = workspaceTrees.reduce((sum, obj) => sum + obj.totalDirectories, 0);

		// If we applied default exclusions and results are sparse, check if there are excluded directories
		let excludedCount = 0;
		const sparseThreshold = Math.floor(directoriesLimit / 10);
		if (!skipExcludes && totalDirectories < sparseThreshold) {
			log.debug(`[${PositronAssistantToolName.DirectoryStructure}] Default exclusions were applied and results were very sparse. Searching directories again to determine how many directories were excluded...`);
			for (const folder of workspaceFolders) {
				const startUri = path
					? vscode.Uri.joinPath(folder.uri, path)
					: folder.uri;

				const allDirectories = await collectDirectories(
					startUri,
					folder.uri,
					0,
					depth,
					includePatterns,
					excludePatterns,
					true, // Skip default exclusions to get all directories
					token
				);
				excludedCount += allDirectories.length;
			}
			excludedCount -= totalDirectories;
		}

		log.debug(`[${PositronAssistantToolName.DirectoryStructure}] Directory structure collected with ${totalDirectories} directories across ${workspaceFolders.length} workspace folders.`);
		if (totalDirectories > directoriesLimit) {
			log.debug(`[${PositronAssistantToolName.DirectoryStructure}] Directory structure exceeds the limit of ${directoriesLimit} directories.`);
		}

		// Build output
		const itemLimit = Math.floor(directoriesLimit / workspaceTrees.length);
		const results = workspaceTrees.map(obj => obj.directories
			.sort((a, b) => a.length - b.length) // Shortest paths first
			.slice(0, itemLimit)
			.sort((a, b) => a.localeCompare(b)) // Resort alphabetically
			.map(dir => dir + '/') // Add trailing slash to indicate directories
			.join('\n'));

		const resultParts = results.map(r => new vscode.LanguageModelTextPart(r));

		// Add truncation message if needed
		if (totalDirectories > directoriesLimit) {
			const truncatedCount = Math.min(directoriesLimit, totalDirectories);
			const truncationMessage = `Directory structure collected with ${totalDirectories} directories; the first ${truncatedCount} are provided above.`;
			resultParts.push(new vscode.LanguageModelTextPart(truncationMessage));
		}

		// Inform the model if results were excluded
		if (excludedCount > 0) {
			const exclusionMessage = `${excludedCount} director${excludedCount === 1 ? 'y was' : 'ies were'} excluded. Set \`skipDefaultExcludes\` to \`true\` to see them.`;
			log.debug(`[${PositronAssistantToolName.DirectoryStructure}] ${exclusionMessage}`);
			resultParts.push(new vscode.LanguageModelTextPart(exclusionMessage));
		}

		return new vscode.LanguageModelToolResult(resultParts);
	}
});

async function collectDirectories(
	uri: vscode.Uri,
	workspaceRoot: vscode.Uri,
	currentDepth: number,
	maxDepth: number,
	includePatterns: string[],
	excludePatterns: string[],
	skipDefaultExcludes: boolean,
	token: vscode.CancellationToken
): Promise<string[]> {
	if (token.isCancellationRequested) {
		return [];
	}

	if (currentDepth > maxDepth) {
		return [];
	}

	const directories: string[] = [];

	try {
		const entries = await vscode.workspace.fs.readDirectory(uri);

		for (const [name, type] of entries) {
			if (type === vscode.FileType.Directory) {
				const dirUri = vscode.Uri.joinPath(uri, name);
				const relativePath = vscode.workspace.asRelativePath(dirUri, false);

				if (shouldIncludeDirectory(relativePath, includePatterns, excludePatterns, skipDefaultExcludes)) {
					directories.push(relativePath);

					if (currentDepth + 1 < maxDepth) {
						const subDirs = await collectDirectories(
							dirUri,
							workspaceRoot,
							currentDepth + 1,
							maxDepth,
							includePatterns,
							excludePatterns,
							skipDefaultExcludes,
							token
						);
						directories.push(...subDirs);
					}
				}
			}
		}
	} catch (error) {
		log.warn(`[${PositronAssistantToolName.DirectoryStructure}] Failed to read directory ${uri.fsPath}: ${error}`);
	}

	return directories;
}

function shouldIncludeDirectory(
	relativePath: string,
	includePatterns: string[],
	excludePatterns: string[],
	skipDefaultExcludes: boolean
): boolean {
	const pathWithSlash = relativePath + '/';

	if (includePatterns.length > 0) {
		const matchesInclude = includePatterns.some(pattern =>
			minimatch(relativePath, pattern) || minimatch(pathWithSlash, pattern)
		);
		if (!matchesInclude) {
			return false;
		}
	}

	const allExcludePatterns = skipDefaultExcludes
		? excludePatterns
		: [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns];

	const matchesExclude = allExcludePatterns.some(pattern =>
		minimatch(relativePath, pattern) || minimatch(pathWithSlash, pattern)
	);

	return !matchesExclude;
}

const DEFAULT_MAX_DIRECTORIES = 50;
const DEFAULT_EXCLUDE_PATTERNS = [
	'**/.build',
	'**/.build/**',
	'**/.git',
	'**/.git/**',
	'**/.devcontainer',
	'**/.devcontainer/**',
	'**/.hg',
	'**/.hg/**',
	'**/.ipynb_checkpoints',
	'**/.ipynb_checkpoints/**',
	'**/.pytest_cache',
	'**/.pytest_cache/**',
	'**/.svn',
	'**/.svn/**',
	'**/.venv',
	'**/.venv/**',
	'**/.Rproj.user',
	'**/.Rproj.user/**',
	'**/.vscode',
	'**/.vscode/**',
	'**/__pycache__',
	'**/__pycache__/**',
	'**/dist',
	'**/dist/**',
	'**/node_modules',
	'**/node_modules/**',
	'**/renv',
	'**/renv/**',
	'**/venv',
	'**/venv/**',
];
