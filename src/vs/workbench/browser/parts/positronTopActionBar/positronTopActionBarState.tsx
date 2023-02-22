/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronTopActionBarServices } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBar';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

/**
 * The Positron top action bar state.
 */
export interface PositronTopActionBarState extends PositronTopActionBarServices {
	workspaceFolder?: IWorkspaceFolder;
}

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
		const disposableStore = new DisposableStore();

		disposableStore.add(services.workspaceContextService.onDidChangeWorkspaceFolders(e => {
			setWorkspaceFolder(singleWorkspaceFolder(services.workspaceContextService));
		}));

		return () => disposableStore.dispose();
	}, []);

	// Return the Positron top action bar state.
	return {
		...services,
		workspaceFolder
	};
};

function singleWorkspaceFolder(workspaceContextService: IWorkspaceContextService) {
	const folders = workspaceContextService.getWorkspace().folders;
	if (folders.length) {
		return folders[0];
	} else {
		return undefined;
	}
}
