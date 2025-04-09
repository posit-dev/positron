/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

type DirectoryTree = { [name: string]: DirectoryTree | null };

type WorkspaceTreeResult = {
	workspaceTrees: DirectoryTree[];
	error?: string;
};

/**
 * Gets the directory tree of the current workspace.
 * @returns A promise that resolves to an object containing the directory tree of the workspace
 */
export async function getProjectTree(): Promise<WorkspaceTreeResult> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return {
			workspaceTrees: [],
			error: 'No workspace folders found.'
		};
	}

	const workspaceTrees: DirectoryTree[] = [];
	const treeErrors: string[] = [];
	for (const workspaceFolder of workspaceFolders) {
		console.log(`[HELLO] Workspace tree for: ${workspaceFolder.name}`);
		try {
			const tree = await constructDirectoryTree(workspaceFolder.uri);
			workspaceTrees.push(tree);
		} catch (error) {
			treeErrors.push(`Failed to generate tree for ${workspaceFolder.name}: ${error}`);
		}
	}

	const result = {
		workspaceTrees,
		error: treeErrors.length > 0 ? treeErrors.join('\n') : undefined
	};

	console.log(`[HELLO] Workspace tree result: ${JSON.stringify(result, null, 2)}`);
	console.log(`[HELLO] Tokens in workspace tree: ${JSON.stringify(workspaceTrees, null, 2).length}`);
	return result;
}

/**
 * Constructs an object representing a directory tree starting from the given URI
 * @param uri The URI of the directory to start from
 * @returns A promise that resolves to the directory tree object
 */
async function constructDirectoryTree(uri: vscode.Uri): Promise<any> {
	try {
		const entries = await vscode.workspace.fs.readDirectory(uri);

		// Filter out directories that start with `.`
		const filteredEntries = entries.filter(([name, type]) => !(name.startsWith('.') && (type & vscode.FileType.Directory)));

		// Sort entries - directories first, then files
		const sortedEntries = filteredEntries.sort((a, b) => {
			// If one is a directory and the other is not, the directory comes first
			if ((a[1] & vscode.FileType.Directory) !== (b[1] & vscode.FileType.Directory)) {
				return (b[1] & vscode.FileType.Directory) ? 1 : -1;
			}
			// Otherwise sort alphabetically
			return a[0].localeCompare(b[0]);
		});

		// Construct the tree
		const tree: DirectoryTree = {};
		for (const [name, type] of sortedEntries) {
			const entryUri = vscode.Uri.joinPath(uri, name);
			if (type & vscode.FileType.Directory) {
				tree[name] = await constructDirectoryTree(entryUri);
			} else {
				tree[name] = null; // Files are represented as null
			}
		}
		return tree;
	} catch (error) {
		throw new Error(`Error reading directory: ${error}`);
	}
}
