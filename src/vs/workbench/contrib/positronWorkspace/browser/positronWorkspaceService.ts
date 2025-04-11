/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IExplorerService } from '../../files/browser/files.js';
import { DirectoryItem } from '../common/interfaces/positronWorkspaceService.js';
import { constructDirectoryTree } from '../common/positronWorkspaceUtils.js';

export const POSITRON_WORKSPACE_SERVICE_ID = 'positronWorkspaceService';

export const IPositronWorkspaceService = createDecorator<IPositronWorkspaceService>(POSITRON_WORKSPACE_SERVICE_ID);

export interface IPositronWorkspaceService {
	readonly _serviceBrand: undefined;

	/**
	 * Gets the directory tree of the current workspace.
	 * @returns A promise that resolves to an object containing the directory tree of the workspace
	 */
	getProjectTree(): Promise<object>;
}

export class PositronWorkspaceService extends Disposable implements IPositronWorkspaceService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IExplorerService private readonly _explorerService: IExplorerService,
	) {
		super();
	}

	/**
	 * Gets the directory tree of the current workspace.
	 * @returns A promise that resolves to an object containing the directory tree of the workspace
	 */
	async getProjectTree(): Promise<object> {
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			return {
				workspaceTrees: [],
				errors: 'No workspace folders found.'
			};
		}

		const workspaceTrees: DirectoryItem[][] = [];
		const treeErrors: string[] = [];
		const treeInfo: string[] = [];
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

		return {
			workspaceTrees,
			errors: treeErrors.length > 0 ? treeErrors.join('\n') : undefined,
			info: treeInfo.length > 0 ? treeInfo.join('\n') : undefined
		};
	}
}

registerSingleton(
	IPositronWorkspaceService,
	PositronWorkspaceService,
	InstantiationType.Delayed
);
