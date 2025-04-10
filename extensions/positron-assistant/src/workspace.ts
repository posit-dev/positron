/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Represents either a file (string) or a directory (tuple with name and children).
 */
type DirectoryEntry = string | [string, DirectoryEntry[]];

/**
 * Result of workspace tree query.
 */
type WorkspaceTreeResult = {
	workspaceTrees: DirectoryEntry[][];
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

	const workspaceTrees: DirectoryEntry[][] = [];
	const treeErrors: string[] = [];
	for (const workspaceFolder of workspaceFolders) {
		try {
			const tree = await constructDirectoryTree(workspaceFolder.uri);
			workspaceTrees.push(tree);
		} catch (error) {
			treeErrors.push(`Failed to generate tree for ${workspaceFolder.name}: ${error}`);
		}
	}

	return {
		workspaceTrees,
		error: treeErrors.length > 0 ? treeErrors.join('\n') : undefined
	};
}

/**
 * Constructs an array representing a directory tree starting from the given URI.
 * @param uri The URI of the directory to start from
 * @returns A promise that resolves to the directory tree array
 */
async function constructDirectoryTree(uri: vscode.Uri): Promise<DirectoryEntry[]> {
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
		const result: DirectoryEntry[] = [];
		for (const [name, type] of sortedEntries) {
			const entryUri = vscode.Uri.joinPath(uri, name);
			if (type & vscode.FileType.Directory) {
				const children = await constructDirectoryTree(entryUri);
				if (children.length > 0) {
					result.push([name, children]);
				}
			} else {
				result.push(name);
			}
		}
		return result;
	} catch (error) {
		throw new Error(`Error reading directory: ${error}`);
	}
}
