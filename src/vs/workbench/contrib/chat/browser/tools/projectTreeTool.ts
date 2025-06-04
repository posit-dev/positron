/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from '../../../../../base/common/glob.js';
import { relativePath } from '../../../../../base/common/resources.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { localize } from '../../../../../nls.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IExplorerService } from '../../../files/browser/files.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolResult, ToolProgress } from '../../common/languageModelToolsService.js';
import { ExplorerItem } from '../../../files/common/explorerModel.js';
import { SortOrder } from '../../../files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';

/**
 * Represents either a file (string) or a directory (tuple with string and children).
 */
type DirectoryItem = string | [string, DirectoryItem[]];

const projectTreeModelDescription = `
This tool returns the project tree of the current workspace as a JSON object, giving a structured overview of all files and directories. The tree is represented as a nested array: each entry is either a file (string) or a directory (a tuple with the directory name and an array of its children).

By default, files and directories listed in the \`files.exclude\` setting and other commonly ignored patterns are excluded. You can customize which files and directories are included or excluded using glob patterns.

If a user asks about a specific file or directory, ensure it is present in the tree. You can do this by:
- Setting the \`includes\` parameter to only include specific files or directories, and using \`replaceDefaultExcludes\` with custom \`excludes\` to avoid filtering them out.
- Or, omitting \`includes\` to include everything, and making sure the relevant file or directory is not excluded by any pattern (possibly by replacing the default excludes).

Use the \`maxResults\` parameter to limit the number of results.
Do not use this tool if no workspace folders are open.
`;

const DEFAULT_EXCLUDE_GLOBS = [
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

const DEFAULT_MAX_RESULTS = 5000;

export const ExtensionProjectTreeId = 'positron_getProjectTree';
export const InternalProjectTreeId = `${ExtensionProjectTreeId}_internal`;
export const ProjectTreeToolData: IToolData = {
	id: InternalProjectTreeId,
	displayName: localize('chat.tools.getProjectTree', "Get Project Tree"),
	source: { type: 'internal' },
	modelDescription: projectTreeModelDescription,
	tags: ['positron-assistant'],
	canBeReferencedInPrompt: false,
	inputSchema: {
		type: 'object',
		properties: {
			includes: {
				type: 'array',
				items: {
					type: 'string',
					description: localize('chat.tools.getProjectTree.includes', "A Glob pattern to include in the project tree. Only the files and folders matching these patterns will be considered."),
				},
				description: localize('chat.tools.getProjectTree.includesDescription', "Glob patterns to include in the project tree."),
				default: [],
			},
			excludes: {
				type: 'array',
				items: {
					type: 'string',
					description: localize('chat.tools.getProjectTree.excludes', "A Glob pattern to exclude from the project tree. Files and folders matching these patterns will be filtered out, even if they match an included Glob."),
				},
				description: localize('chat.tools.getProjectTree.excludesDescription', "Glob patterns to exclude from the project tree. These patterns will be applied in addition to the default excludes."),
				default: DEFAULT_EXCLUDE_GLOBS,
			},
			replaceDefaultExcludes: {
				type: 'boolean',
				description: localize('chat.tools.getProjectTree.replaceDefaultExcludes', "If true, the default excludes will be replaced with the provided excludes. Defaults to false, which means the provided excludes will be added to the default excludes."),
				default: false,
			},
			maxResults: {
				type: 'integer',
				description: localize('chat.tools.getProjectTree.maxResults', "Maximum number of results to return. Defaults to {0} results.", DEFAULT_MAX_RESULTS),
				default: DEFAULT_MAX_RESULTS,
			},
		},
	}
};

export class ProjectTreeTool implements IToolImpl {
	private readonly _sortOrder: SortOrder;
	private readonly _treeConfig: ProjectTreeToolParams;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IExplorerService private readonly _explorerService: IExplorerService,
	) {
		this._sortOrder = this._explorerService.sortOrderConfiguration.sortOrder;
		this._treeConfig = {};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			throw new Error(`Can't construct project tree because no workspace folders are open. Open a workspace folder before using this tool.`);
		}

		const params = invocation.parameters as ProjectTreeToolParams;
		this.setTreeConfig(params);

		const workspaceTrees: DirectoryItem[][] = [];
		const treeErrors: string[] = [];

		// Construct the project tree for each workspace folder
		for (const workspaceFolder of workspaceFolders) {
			const explorerRoot = this._explorerService.findClosestRoot(workspaceFolder.uri);
			if (!explorerRoot) {
				treeErrors.push(`No explorer root found for ${workspaceFolder.name}`);
				continue;
			}
			try {
				const tree = await this.constructDirectoryTree(explorerRoot, workspaceFolder.uri);
				if (!tree) {
					continue;
				}
				workspaceTrees.push(tree);
			} catch (error) {
				treeErrors.push(`Failed to generate tree for ${workspaceFolder.name}: ${error}`);
			}
		}

		if (treeErrors.length > 0) {
			throw new Error(`Errors occurred while generating the project tree:\n${treeErrors.join('\n')}`);
		}

		// TODO: limit the number of results returned based on maxResults

		return {
			content: workspaceTrees.map(dirTree => ({ kind: 'text', value: JSON.stringify(dirTree) })),
		};
	}

	async prepareToolInvocation(_parameters: any, _token: CancellationToken): Promise<IPreparedToolInvocation> {
		return {
			invocationMessage: localize('projectTreeTool.invocationMessage', "Constructing project tree"),
			pastTenseMessage: localize('projectTreeTool.pastTenseMessage', "Constructed project tree"),
		};
	}

	private setTreeConfig(treeConfig: ProjectTreeToolParams): void {
		this._treeConfig.includes = treeConfig.includes || [];
		this._treeConfig.excludes = treeConfig.replaceDefaultExcludes
			? treeConfig.excludes || []
			: [...new Set(DEFAULT_EXCLUDE_GLOBS.concat(treeConfig.excludes || []))];
		this._treeConfig.maxResults = treeConfig.maxResults || DEFAULT_MAX_RESULTS;
	}

	/**
	 * Determines if a given path should be included in the project tree based on include and exclude patterns.
	 * - If no includes are specified, all paths are included unless excluded.
	 * - If includes are specified, only paths matching an include pattern are considered.
	 * - If excludes are specified, any path matching an exclude pattern is excluded.
	 * @param path The path to check for inclusion in the project tree.
	 * @returns True if the path should be included in the project tree, false otherwise.
	 */
	private isIncludedPath(path: string): boolean {
		// If no includes are specified or if the path is included, isIncluded = true
		const isIncluded = this._treeConfig.includes && this._treeConfig.includes.length > 0
			? this._treeConfig.includes.some(pattern => glob.match(pattern, path))
			: true;

		// If excludes are specified and the path matches any of them, isExcluded = true
		// If no excludes are specified, isExcluded = false
		const isExcluded = this._treeConfig.excludes && this._treeConfig.excludes.length > 0
			? this._treeConfig.excludes.some(pattern => glob.match(pattern, path))
			: false;

		// TODO: also check the files.exclude setting in the workspace configuration
		// TODO: also check gitignore files if applicable

		// A path must be included and not excluded to be part of the project tree
		return isIncluded && !isExcluded;
	}

	private shouldIncludeItem(item: ExplorerItem, workspaceRoot: URI): boolean {
		if (item.resource.toString() === workspaceRoot.toString()) {
			return true; // Always include the workspace root
		}
		const itemPath = relativePath(workspaceRoot, item.resource);
		if (itemPath === undefined) {
			throw Error(`Could not determine relative path for ${item.name} in workspace ${workspaceRoot.toString()}`);
		}
		return this.isIncludedPath(itemPath);
	}

	private async constructDirectoryTree(item: ExplorerItem, workspaceRoot: URI): Promise<DirectoryItem[] | undefined> {
		if (!this.shouldIncludeItem(item, workspaceRoot)) {
			// Skip this item if it doesn't match the include/exclude criteria
			return undefined;
		}

		if (item.isDirectory) {
			if (!item.hasChildren) {
				return [[item.name, []]];
			}

			// Get the children of the directory item
			const children: DirectoryItem[] = [];
			const itemChildren = await item.fetchChildren(this._sortOrder);

			// Recursively construct the directory tree for each child item
			for (const child of itemChildren) {
				const childEntries = await this.constructDirectoryTree(child, workspaceRoot);
				if (childEntries === undefined) {
					continue;
				}
				children.push(...childEntries);
			}
			return [[item.name, children]];
		} else {
			return [item.name];
		}
	}
}

export interface ProjectTreeToolParams {
	includes?: string[];
	excludes?: string[];
	replaceDefaultExcludes?: boolean;
	maxResults?: number;
}
