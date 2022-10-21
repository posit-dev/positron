/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/css/positronTopBar';
const React = require('react');
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { TopBarRegion } from 'vs/workbench/browser/parts/positronTopBar/components/topBarRegion/topBarRegion';
import { PositronTopBarContextProvider } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarSeparator } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSeparator/topBarSeparator';
import { TopBarCommandButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarCommandButton/topBarCommandButton';
import { TopBarCommandCenter } from 'vs/workbench/browser/parts/positronTopBar/components/topBarCommandCenter/topBarCommandCenter';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { TopBarMenuButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarMenuButton/topBarMenuButton';
import { MenuId } from 'vs/platform/actions/common/actions';

/**
 * PositronTopBarServices interface. Defines the set of services that are required by the Positron top bar.
 */
export interface PositronTopBarServices {
	configurationService: IConfigurationService;
	quickInputService: IQuickInputService;
	commandService: ICommandService;
	keybindingService: IKeybindingService;
	contextMenuService: IContextMenuService;
}

/**
 * PositronTopBarProps interface.
 */
interface PositronTopBarProps extends PositronTopBarServices {
	testValue: string; // For now, as a tracer...
}

// commands that we bind to in the top bar (used so we can filter our interations w/ the MenuRegistry)
const kFileSave = 'workbench.action.files.save';
const kFileSaveAll = 'workbench.action.files.saveFiles';
const kNavigateBack = 'workbench.action.navigateBack';
const kNavigateForward = 'workbench.action.navigateForward';
const kTopBarCommands = [kFileSave, kFileSaveAll, kNavigateBack, kNavigateForward];

/**
 * PositronTopBar component.
 * @param props A PositronTopBarProps that contains the component properties.
 * @returns The component.
 */
export const PositronTopBar = (props: PositronTopBarProps) => {
	// Render.
	return (
		<PositronTopBarContextProvider {...props} commandIds={kTopBarCommands}>
			<div className='positron-top-bar'>
				<TopBarRegion align='left'>
					<TopBarButton iconClassName='new-file-icon' dropDown={true} tooltip='New file' />
					<TopBarSeparator />
					<TopBarButton iconClassName='new-project-icon' tooltip='New project' />
					<TopBarSeparator />
					<TopBarMenuButton menuId={MenuId.MenubarRecentMenu} iconClassName='open-file-icon' tooltip='Open file' />
					<TopBarSeparator />
					<TopBarCommandButton id={kFileSave} iconClassName='save-icon' />
					<TopBarCommandButton id={kFileSaveAll} iconClassName='save-all-icon' />
				</TopBarRegion>

				<TopBarRegion align='center'>
					<TopBarCommandButton id={kNavigateBack} iconClassName='back-icon' />
					<TopBarCommandButton id={kNavigateForward} iconClassName='forward-icon' />
					<TopBarCommandCenter {...props} />
				</TopBarRegion>

				<TopBarRegion align='right'>
					<TopBarButton iconClassName='print-icon' />
				</TopBarRegion>
			</div>
		</PositronTopBarContextProvider>
	);
};
