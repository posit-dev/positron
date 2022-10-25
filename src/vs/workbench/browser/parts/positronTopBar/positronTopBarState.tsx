/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { ILabelService } from 'vs/platform/label/common/label';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { DisposableStore } from 'vs/base/common/lifecycle';

/**
 * The tooltip reset timeout in milliseconds.
 */
const kTooltipReset = 500;

/**
 * The Positron top bar state.
 */
export interface PositronTopBarState {
	configurationService: IConfigurationService;
	quickInputService: IQuickInputService;
	commandService: ICommandService;
	keybindingService: IKeybindingService;
	contextMenuService: IContextMenuService;
	contextKeyService: IContextKeyService;
	workspacesService: IWorkspacesService;
	labelService: ILabelService;
	hostService: IHostService;
	layoutService: ILayoutService;
	workspaceContextService: IWorkspaceContextService;
	workspaceFolder?: IWorkspaceFolder;
	showTooltipDelay(): number;
	tooltipHidden(): void;
}

/**
 * The usePositronTopBarState custom hook.
 * @param services A PositronTopBarServices that contains the Positron top bar services.
 * @returns The hook.
 */
export const usePositronTopBarState = ({
	configurationService,
	quickInputService,
	commandService,
	keybindingService,
	contextMenuService,
	contextKeyService,
	workspacesService,
	labelService,
	hostService,
	layoutService,
	workspaceContextService
}: PositronTopBarServices, commandIds: string[]): PositronTopBarState => {
	// Hooks.
	const [workspaceFolder, setWorkspaceFolder] = useState<IWorkspaceFolder | undefined>(singleWorkspaceFolder(workspaceContextService));
	const [lastTooltipHiddenAt, setLastTooltipHiddenAt] = useState<number>(0);

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(workspaceContextService.onDidChangeWorkspaceFolders(e => {
			setWorkspaceFolder(singleWorkspaceFolder(workspaceContextService));
		}));

		return () => disposableStore.dispose();
	});

	const showTooltipDelay = () => new Date().getTime() - lastTooltipHiddenAt < kTooltipReset ? 0 : configurationService.getValue<number>('workbench.hover.delay');
	const tooltipHidden = () => setLastTooltipHiddenAt(new Date().getTime());

	// Return the Positron top bar state.
	return {
		configurationService,
		quickInputService,
		commandService,
		keybindingService,
		contextMenuService,
		contextKeyService,
		workspacesService,
		labelService,
		hostService,
		layoutService,
		workspaceContextService,
		workspaceFolder,
		showTooltipDelay,
		tooltipHidden
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
