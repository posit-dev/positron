/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./customFolderMenuItem';
import * as React from 'react';
import { KeyboardModifiers, PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';

/**
 * CustomFolderMenuItemProps interface.
 */
interface CustomFolderMenuItemProps {
	enabled: boolean;
	label: string;
	onSelected: (e: KeyboardModifiers) => void;
}

/**
 * CustomFolderMenuItem component.
 * @param props A CustomFolderMenuItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const CustomFolderMenuItem = (props: CustomFolderMenuItemProps) => {
	// Render.
	return (
		<PositronButton className='custom-folder-menu-item' onPressed={props.onSelected}>
			<div className='title'>
				{props.label}
			</div>
		</PositronButton>
	);
};
