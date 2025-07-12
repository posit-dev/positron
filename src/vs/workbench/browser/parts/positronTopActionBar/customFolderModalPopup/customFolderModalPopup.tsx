/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderModalPopup.css';

// React.
import React from 'react';

// Other dependencies.
import { IRecentlyOpened } from '../../../../../platform/workspaces/common/workspaces.js';
import { PositronModalPopup } from '../../../positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../positronModalReactRenderer/positronModalReactRenderer.js';
import { CustomFolderMenuItems } from './customFolderMenuItems.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 * CustomFolderModalPopupProps interface.
 */
interface CustomFolderModalPopupProps {
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
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Render.
	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			height={'auto'}
			keyboardNavigationStyle='menu'
			minWidth={275}
			popupAlignment='right'
			popupPosition='bottom'
			renderer={props.renderer}
			width={'auto'}
		>
			<CustomFolderMenuItems
				commandService={services.commandService}
				contextKeyService={services.contextKeyService}
				hostService={services.hostService}
				labelService={services.labelService}
				recentlyOpened={props.recentlyOpened}
				onMenuItemSelected={() => props.renderer.dispose()}
			/>
		</PositronModalPopup>
	);
};
