/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderModalPopup.css';

// Other dependencies.
import { CustomFolderMenuItems } from './customFolderMenuItems.js';
import { IRecentlyOpened } from '../../../../../platform/workspaces/common/workspaces.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalPopup } from '../../../positronComponents/positronModalPopup/positronModalPopup.js';

/**
 * CustomFolderModalPopupProps interface.
 */
interface CustomFolderModalPopupProps {
	anchorElement: HTMLElement;
	recentlyOpened: IRecentlyOpened;
	renderer: PositronModalReactRenderer;
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
				onMenuItemSelected={() => props.renderer.dispose()}
			/>
		</PositronModalPopup>
	);
};
