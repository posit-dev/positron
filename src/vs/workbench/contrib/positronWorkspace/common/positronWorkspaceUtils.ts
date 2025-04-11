/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExplorerItem } from '../../files/common/explorerModel.js';
import { SortOrder } from '../../files/common/files.js';
import { DirectoryItem, DirectoryItemInfo } from './interfaces/positronWorkspaceService.js';

/**
 * Converts an explorer item to the directory item format
 * @param item The explorer item to convert
 * @returns A directory item array representing the file tree in the workspace
 */
export async function constructDirectoryTree(item: ExplorerItem, sortOrder: SortOrder): Promise<DirectoryItem[]> {
	const itemInfo: DirectoryItemInfo = {
		name: item.name
	};

	if (item.isExcluded) {
		itemInfo.isExcluded = item.isExcluded;
	}

	if (item.isDirectory) {
		if (!item.hasChildren) {
			return [[itemInfo, []]];
		}
		const children: DirectoryItem[] = [];
		const itemChildren = await item.fetchChildren(sortOrder);
		for (const child of itemChildren) {
			const childEntries = await constructDirectoryTree(child, sortOrder);
			children.push(...childEntries);
		}
		return [[itemInfo, children]];
	} else {
		// For files, return just the info wrapped as a single-element array
		return [itemInfo];
	}
}

