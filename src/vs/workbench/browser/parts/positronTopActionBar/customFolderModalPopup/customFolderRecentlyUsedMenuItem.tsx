/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./customFolderRecentlyUsedMenuItem';
import * as React from 'react';
import { KeyboardModifiers, PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';

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
		<PositronButton className='custom-folder-recently-used-menu-item' onClick={props.onOpen}>
			<div className='title' title={props.label}>
				{props.label}
			</div>
			<PositronButton className='open-in-new-window' onClick={props.onOpenInNewWindow}>
				<div className='codicon codicon-positron-open-in-new-window' title={props.label} />
			</PositronButton>
		</PositronButton>
	);
};
