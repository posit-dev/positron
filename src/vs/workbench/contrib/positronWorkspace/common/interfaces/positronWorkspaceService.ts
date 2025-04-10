/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

/**
 * Represents either a file (string) or a directory (tuple with name and children).
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

export const POSITRON_WORKSPACE_SERVICE_ID = 'positronWorkspaceService';

export const IPositronWorkspaceService = createDecorator<IPositronWorkspaceService>(POSITRON_WORKSPACE_SERVICE_ID);

export interface IPositronWorkspaceService {
	readonly _serviceBrand: undefined;

	/**
	 * Gets the directory tree of the current workspace.
	 * @returns A promise that resolves to an object containing the directory tree of the workspace
	 */
	getProjectTree(): Promise<IWorkspaceTreeResult>;
}
