/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./customFolderMenuItem';
import * as React from 'react';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
// import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
// import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';

/**
 * CustomFolderMenuItemProps interface.
 */
interface CustomFolderMenuItemProps {
	enabled: boolean;
	label: string;
	onSelected: () => void;
}

/**
 * CustomFolderMenuItem component.
 * @param props A CustomFolderMenuItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const CustomFolderMenuItem = (props: CustomFolderMenuItemProps) => {
	// Render.
	return (
		<PositronButton className='custom-folder-menu-item' onClick={props.onSelected}>
			<div className='title'>
				{props.label}
			</div>
		</PositronButton>
	);
};
