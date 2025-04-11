/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a file or directory in the workspace.
 * The name is the file or directory name, and isExcluded indicates if the item is excluded from the workspace.
 */
export type DirectoryItemInfo = {
	name: string;
	isExcluded?: boolean;
};

/**
 * Represents either a file (DirectoryItemInfo) or a directory (tuple with DirectoryItemInfo and children).
 */
export type DirectoryItem = DirectoryItemInfo | [DirectoryItemInfo, DirectoryItem[]];

/**
 * Result of workspace tree query.
 */
export interface IWorkspaceTreeResult {
	workspaceTrees: DirectoryItem[][];
	errors?: string;
	info?: string;
}
