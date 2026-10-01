/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './folderTemplatePicker.css';

// Other dependencies.
import { LogoRProject } from './logos/logoRProject.js';
import { LogoEmptyProject } from './logos/logoEmptyProject.js';
import { LogoPythonProject } from './logos/logoPythonProject.js';
import { LogoJupyterNotebook } from './logos/logoJupyterNotebook.js';
import { useNewFolderFlowContext } from '../newFolderFlowContext.js';
import { FolderTemplate } from '../../../services/positronNewFolder/common/positronNewFolder.js';

/**
 * FolderTemplatePickerProps interface.
 */
interface FolderTemplatePickerProps {
	identifier: FolderTemplate;
	selected: boolean;
	groupName: string;
	activeTabIndex: boolean;
	onSelected: () => void;
}

/**
 * FolderTemplatePicker component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const FolderTemplatePicker = (props: FolderTemplatePickerProps) => {
	// State.
	const { folderTemplate } = useNewFolderFlowContext();
	// Render. The whole card is the radio button's label, so a click anywhere on it checks and
	// focuses the radio natively. Focus from a pointer shows no focus ring; focusing the radio from
	// script did, whenever the element focused before it (an autofocused card, a keyboard-focused
	// control) had shown one.
	return (
		<label
			className={
				'folder-template' +
				(props.selected ? ' folder-template-selected' : '')
			}
		>
			{/* Decorative: the template's name below is the label's text. */}
			<div aria-hidden='true' className='folder-template-icon'>
				{props.identifier === FolderTemplate.PythonProject ? (
					<LogoPythonProject />
				) : props.identifier === FolderTemplate.JupyterNotebook ? (
					<LogoJupyterNotebook />
				) : props.identifier === FolderTemplate.RProject ? (
					<LogoRProject />
				) : props.identifier === FolderTemplate.EmptyProject ? (
					<LogoEmptyProject />
				) : null}
			</div>
			<input
				autoFocus={folderTemplate && props.activeTabIndex}
				checked={props.selected}
				className='folder-template-input'
				id={props.identifier}
				name={props.groupName}
				tabIndex={props.activeTabIndex ? 0 : -1}
				type='radio'
				// Set the autofocus to the selected project type when the user navigates back to
				// the project type step.
				value={props.identifier}
				// Fires for a click on the card, and for Space and the arrow keys.
				onChange={props.onSelected}
			/>
			<span>{props.identifier}</span>
		</label>
	);
};
