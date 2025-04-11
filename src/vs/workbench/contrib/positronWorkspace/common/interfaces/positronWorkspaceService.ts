/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents either a file (string) or a directory (tuple with string and children).
 */
export type DirectoryItem = string | [string, DirectoryItem[]];

/**
 * Result of workspace tree query.
 */
export interface IWorkspaceTreeResult {
	workspaceTrees: DirectoryItem[][];
	errors?: string;
	info?: string;
}
