/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./customFolderRecentlyUsedMenuItem';
import * as React from 'react';
import { KeyboardModifiers, Button } from 'vs/base/browser/ui/positronComponents/button/button';

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
