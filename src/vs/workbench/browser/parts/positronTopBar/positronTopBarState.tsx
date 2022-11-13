/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/components/positronTopBar';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

/**
 * The Positron top bar state.
 */
export interface PositronTopBarState extends PositronTopBarServices {
	workspaceFolder?: IWorkspaceFolder;
}

/**
 * The usePositronTopBarState custom hook.
 * @param services A PositronTopBarServices that contains the Positron top bar services.
 * @returns The hook.
 */
export const usePositronTopBarState = (services: PositronTopBarServices): PositronTopBarState => {
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

	// Return the Positron top bar state.
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
