/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { PositronTopActionBarServices } from './positronTopActionBar.js';

/**
 * The Positron top action bar state.
 */
export interface PositronTopActionBarState extends PositronTopActionBarServices {
	workspaceFolder?: IWorkspaceFolder;
}

const singleWorkspaceFolder = (workspaceContextService: IWorkspaceContextService) => {
	const folders = workspaceContextService.getWorkspace().folders;
	if (folders.length) {
		return folders[0];
	} else {
		return undefined;
	}
};

/**
 * The usePositronTopActionBarState custom hook.
 * @param services A PositronTopActionBarServices that contains the Positron top action bar services.
 * @returns The hook.
 */
export const usePositronTopActionBarState = (services: PositronTopActionBarServices): PositronTopActionBarState => {
	// Hooks.
	const [workspaceFolder, setWorkspaceFolder] = useState<IWorkspaceFolder | undefined>(singleWorkspaceFolder(services.workspaceContextService));

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeWorkspaceFolders event handler.
		disposableStore.add(services.workspaceContextService.onDidChangeWorkspaceFolders(e => {
			setWorkspaceFolder(singleWorkspaceFolder(services.workspaceContextService));
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [services.workspaceContextService]);

	// Return the Positron top action bar state.
	return {
		...services,
		workspaceFolder
	};
};
