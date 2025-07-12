/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderModalPopup.css';

// React.
import React from 'react';

// Other dependencies.
import { CustomFolderMenuItems } from './customFolderMenuItems.js';
import { IRecentlyOpened } from '../../../../../platform/workspaces/common/workspaces.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalPopup } from '../../../positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../positronModalReactRenderer/positronModalReactRenderer.js';

/**
 * CustomFolderModalPopupProps interface.
 */
interface CustomFolderModalPopupProps {
	anchorElement: HTMLElement;
	recentlyOpened: IRecentlyOpened;
	renderer: PositronModalReactRenderer;
	services: PositronReactServices;
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
				recentlyOpened={props.recentlyOpened}
				services={props.services}
				onMenuItemSelected={() => props.renderer.dispose()}
			/>
		</PositronModalPopup>
	);
};
