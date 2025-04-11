/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExplorerItem } from '../../files/common/explorerModel.js';
import { SortOrder } from '../../files/common/files.js';
import { DirectoryItem } from './interfaces/positronWorkspaceService.js';

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
