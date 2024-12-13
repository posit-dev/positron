/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderMenuItem.css';

// React.
import React from 'react';

// Other dependencies.
import { KeyboardModifiers, Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

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
		<Button className='custom-folder-menu-item' onPressed={props.onSelected}>
			<div className='title'>
				{props.label}
			</div>
		</Button>
	);
};
