/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { localize } from '../../../../../nls.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IExplorerService } from '../../../files/browser/files.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolResult } from '../../common/languageModelToolsService.js';
import { ExplorerItem } from '../../../files/common/explorerModel.js';
import { SortOrder } from '../../../files/common/files.js';
import { IToolInputProcessor } from '../../common/tools/tools.js';

/**
 * Represents either a file (string) or a directory (tuple with string and children).
 */
type DirectoryItem = string | [string, DirectoryItem[]];

const projectTreeModelDescription = `
This tool lists the project tree of the current workspace as a JSON object.
The project tree is represented as a nested array, where each entry can be either a file (string) or a directory (tuple with the directory name and an array of its children).
This tool ignores node_modules, __pycache__, dist directories, certain files like .DS_Store, Thumbs.db, and desktop.ini. and files with certain extensions like *.o, *.a, *.so, *.pyo.
This tool does not provide information for specific files or directories, but rather gives an overview of the entire project structure.
This tool only needs to be called once per conversation, unless files or directories are added, removed, moved, or renamed in the workspace.
`;

export const ExtensionProjectTreeId = 'positron_getProjectTree';
export const InternalProjectTreeId = `${ExtensionProjectTreeId}_internal`;
export const ProjectTreeToolData: IToolData = {
	id: InternalProjectTreeId,
	displayName: localize('chat.tools.getProjectTree', "Get Project Tree"),
	source: { type: 'internal' },
	modelDescription: projectTreeModelDescription,
	tags: ['positron-assistant'],
	canBeReferencedInPrompt: false,
};

export class ProjectTreeTool implements IToolImpl {
	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IExplorerService private readonly _explorerService: IExplorerService,
	) { }

	async invoke(invocation: IToolInvocation, countTokens: CountTokensCallback, token: CancellationToken): Promise<IToolResult> {
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			return {
				content: [],
				toolResultMessage: 'No workspace folders found.'
			};
		}

		const workspaceTrees: DirectoryItem[][] = [];
		const treeErrors: string[] = [];
		const sortOrder = this._explorerService.sortOrderConfiguration.sortOrder;

		for (const workspaceFolder of workspaceFolders) {
			const explorerRoot = this._explorerService.findClosestRoot(workspaceFolder.uri);
			if (!explorerRoot) {
				treeErrors.push(`No explorer root found for ${workspaceFolder.name}`);
				continue;
			}
			try {
				const tree = await constructDirectoryTree(explorerRoot, sortOrder);
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
}

export class ProjectTreeInputProcessor implements IToolInputProcessor {
	processInput(input: any) {
		// No input processing needed for this tool
		return input;
	}
}

const IGNORED_DIRECTORIES = [
	'node_modules',
	'__pycache__',
	'dist',
];
const IGNORED_FILES = [
	'.DS_Store',
	'Thumbs.db',
	'desktop.ini',
	'.Rhistory',
	'.RData',
	'.Ruserdata',
];
const IGNORED_EXTENSIONS = [
	'*.o',
	'*.a',
	'*.so',
	'*.pyo',
];

const isIgnoredDirectory = (dirName: string): boolean => {
	return dirName.startsWith('.') || IGNORED_DIRECTORIES.includes(dirName);
};

const isIgnoredFile = (fileName: string): boolean => {
	return IGNORED_FILES.includes(fileName) || IGNORED_EXTENSIONS.some(ext => fileName.endsWith(ext));
};

/**
 * Converts an explorer item to the directory item format
 * @param item The explorer item to convert
 * @returns A directory item array representing the file tree in the workspace
 */
export async function constructDirectoryTree(item: ExplorerItem, sortOrder: SortOrder): Promise<DirectoryItem[] | undefined> {
	// TODO: add in support for checking ignore files (e.g., .gitignore) and `files.exclude` setting
	if (item.isDirectory) {
		if (isIgnoredDirectory(item.name)) {
			return undefined;
		}

		if (!item.hasChildren) {
			return [[item.name, []]];
		}

		const children: DirectoryItem[] = [];
		const itemChildren = await item.fetchChildren(sortOrder);
		for (const child of itemChildren) {
			const childEntries = await constructDirectoryTree(child, sortOrder);
			if (childEntries === undefined) {
				continue;
			}
			children.push(...childEntries);
		}
		return [[item.name, children]];
	} else {
		if (isIgnoredFile(item.name)) {
			return undefined;
		}
		return [item.name];
	}
}

