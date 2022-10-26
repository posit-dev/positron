/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronTopBar';
const React = require('react');
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TopBarRegion } from 'vs/workbench/browser/parts/positronTopBar/components/topBarRegion/topBarRegion';
import { PositronTopBarContextProvider } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarSeparator } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSeparator/topBarSeparator';
import { TopBarCommandButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarCommandButton';
import { TopBarCommandCenter } from 'vs/workbench/browser/parts/positronTopBar/components/topBarCommandCenter/topBarCommandCenter';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { ILabelService } from 'vs/platform/label/common/label';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { TopBarNewMenu } from 'vs/workbench/browser/parts/positronTopBar/components/topBarNewMenu';
import { TopBarOpenMenu } from 'vs/workbench/browser/parts/positronTopBar/components/topBarOpenMenu';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { TopBarWorkspaceMenu } from 'vs/workbench/browser/parts/positronTopBar/components/topBarWorkspaceMenu';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { NavigateBackwardsAction, NavigateForwardAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { TopBarConsoleSelect } from 'vs/workbench/browser/parts/positronTopBar/components/topBarConsoleSelect/topBarConsoleSelect';

/**
 * PositronTopBarServices interface. Defines the set of services that are required by the Positron top bar.
 */
export interface PositronTopBarServices {
	commandService: ICommandService;
	configurationService: IConfigurationService;
	contextKeyService: IContextKeyService;
	contextMenuService: IContextMenuService;
	hostService: IHostService;
	keybindingService: IKeybindingService;
	labelService: ILabelService;
	layoutService: ILayoutService;
	quickInputService: IQuickInputService;
	workspaceContextService: IWorkspaceContextService;
	workspacesService: IWorkspacesService;
}

/**
 * PositronTopBarProps interface.
 */
interface PositronTopBarProps extends PositronTopBarServices { }

/**
 * PositronTopBar component.
 * @param props A PositronTopBarProps that contains the component properties.
 * @returns The component.
 */
export const PositronTopBar = (props: PositronTopBarProps) => {
	// Render.
	return (
		<PositronTopBarContextProvider {...props}>
			<div className='positron-top-bar'>
				<TopBarRegion align='left'>
					<TopBarNewMenu />
					<TopBarSeparator />
					<TopBarOpenMenu />
					<TopBarSeparator />
					<TopBarCommandButton iconId='positron-save' tooltipAlignment='left' commandId={'workbench.action.files.save'} />
					<TopBarCommandButton iconId='positron-save-all' tooltipAlignment='left' commandId={'workbench.action.files.saveFiles'} />
				</TopBarRegion>

				<TopBarRegion align='center'>
					<TopBarCommandButton iconId='positron-chevron-left' tooltipAlignment='left' commandId={NavigateBackwardsAction.ID} />
					<TopBarCommandButton iconId='positron-chevron-right' tooltipAlignment='left' commandId={NavigateForwardAction.ID} />
					<TopBarCommandCenter {...props} />
				</TopBarRegion>

				<TopBarRegion align='right'>
					<TopBarConsoleSelect />
					<TopBarWorkspaceMenu />
				</TopBarRegion>
			</div>
		</PositronTopBarContextProvider>
	);
};
