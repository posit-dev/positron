/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExplorerItem } from '../../files/common/explorerModel.js';
import { DirectoryItem } from './interfaces/positronWorkspaceService.js';

/**
 * Converts an explorer item to the directory item format
 * @param item The explorer item to convert
 * @returns A directory item array representing the file tree in the workspace
 */
export function constructDirectoryTree(item: ExplorerItem): DirectoryItem[] {
	const result: DirectoryItem[] = [];

	if (item.isDirectory) {
		const children: DirectoryItem[] = [];
		const sortedChildren = [...item.children.values()].sort((a, b) => {
			// Sort directories before files
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}
			// Sort alphabetically
			return a.name.localeCompare(b.name);
		});

		// Construct the directory tree for each child
		for (const child of sortedChildren) {
			const childEntries = constructDirectoryTree(child);
			children.push(...childEntries);
		}
	} else {
		// Add files directly
		result.push(item.name);
	}

	return result;
}

