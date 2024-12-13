/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderRecentlyUsedMenuItem.css';

// React.
import React from 'react';

// Other dependencies.
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
				<div className='codicon codicon-positron-open-in-new-window' title={props.label} />
			</Button>
		</Button>
	);
};
