/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./customFolderModalPopup';

// React.
import * as React from 'react';

// Other dependencies.
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IRecentlyOpened, IWorkspacesService } from '../../../../../platform/workspaces/common/workspaces.js';
import { PositronModalPopup } from '../../../positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../positronModalReactRenderer/positronModalReactRenderer.js';
import { CustomFolderMenuItems } from './customFolderMenuItems.js';

/**
 * CustomFolderModalPopupProps interface.
 */
interface CustomFolderModalPopupProps {
	commandService: ICommandService;
	contextKeyService: IContextKeyService;
	hostService: IHostService;
	keybindingService: IKeybindingService;
	labelService: ILabelService;
	layoutService: ILayoutService;
	workspacesService: IWorkspacesService;
	renderer: PositronModalReactRenderer;
	recentlyOpened: IRecentlyOpened;
	anchorElement: HTMLElement;
}

/**
 * The custom folder modal popup.
 * @param propsThe component properties.
 * @returns The rendered component.
 */
export const CustomFolderModalPopup = (props: CustomFolderModalPopupProps) => {
	// Render.
	return (
		<PositronModalPopup
			renderer={props.renderer}
			anchorElement={props.anchorElement}
			popupPosition='bottom'
			popupAlignment='right'
			width={'max-content'}
			minWidth={275}
			height={'min-content'}
			keyboardNavigationStyle='menu'
		>
			<CustomFolderMenuItems
				commandService={props.commandService}
				contextKeyService={props.contextKeyService}
				hostService={props.hostService}
				labelService={props.labelService}
				recentlyOpened={props.recentlyOpened}
				onMenuItemSelected={() => props.renderer.dispose()}
			/>
		</PositronModalPopup>
	);
};
