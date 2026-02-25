/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './folderTemplateGroup.css';

// React.
import { PropsWithChildren, useState } from 'react';

// Other dependencies.
import { FolderTemplatePicker } from './folderTemplatePicker.js';
import { FolderTemplate } from '../../../services/positronNewFolder/common/positronNewFolder.js';

/**
 * FolderTemplateGroupProps interface.
 */
interface FolderTemplateGroupProps {
	name: string;
	folderTemplates: FolderTemplate[];
	selectedFolderTemplate?: string;
	labelledBy?: string;
	describedBy?: string;
	onSelectionChanged: (folderTemplate: FolderTemplate) => void;
}

/**
 * FolderTemplateGroup component.
 * @param props The component properties.
 * @returns The rendered component.
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/radio/ for accessibility guidelines.
 */
export const FolderTemplateGroup = (props: PropsWithChildren<FolderTemplateGroupProps>) => {
	// Hooks.
	const [currentSelection, setCurrentSelection] = useState(props.selectedFolderTemplate);
	const [activeIndexId, setActiveIndexId] = useState(props.selectedFolderTemplate ?? props.folderTemplates[0] ?? '');

	// On folder template selected, update the current selection and notify the parent.
	const onSelectionChanged = (folderTemplate: FolderTemplate) => {
		setCurrentSelection(folderTemplate);
		setActiveIndexId(folderTemplate);
		props.onSelectionChanged(folderTemplate);
	};

	// Render.
	return (
		<div
			aria-describedby={props.describedBy}
			aria-labelledby={props.labelledBy}
			className='folder-template-group'
			role='radiogroup'
		>
			{props.folderTemplates.map((folderTemplate, index) => {
				return (
					<FolderTemplatePicker
						key={index}
						activeTabIndex={folderTemplate === activeIndexId}
						groupName={props.name}
						identifier={folderTemplate}
						selected={folderTemplate === currentSelection}
						onSelected={() => onSelectionChanged(folderTemplate)}
					/>
				);
			})}
		</div>
	);
};
