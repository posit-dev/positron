/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderRecentlyUsedMenuItem.css';

// Other dependencies.
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { KeyboardModifiers, Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * CustomFolderRecentlyUsedMenuItemProps interface.
 */
interface CustomFolderRecentlyUsedMenuItemProps {
	enabled: boolean;
	label: string;
	onOpen: (e: KeyboardModifiers) => void;
	onOpenInNewWindow: (e: KeyboardModifiers) => void;
}

/**
 * CustomFolderRecentlyUsedMenuItem component.
 * @param props A CustomFolderRecentlyUsedMenuItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const CustomFolderRecentlyUsedMenuItem = (props: CustomFolderRecentlyUsedMenuItemProps) => {
	// Render.
	return (
		<Button className='custom-folder-recently-used-menu-item' onPressed={props.onOpen}>
			<div className='title' title={props.label}>
				{props.label}
			</div>
			<Button className='open-in-new-window' onPressed={props.onOpenInNewWindow}>
				<ThemeIcon icon={Codicon.positronOpenInNewWindow} title={props.label} />
			</Button>
		</Button>
	);
};
