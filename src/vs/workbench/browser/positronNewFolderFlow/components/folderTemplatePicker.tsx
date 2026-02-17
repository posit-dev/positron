/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './folderTemplatePicker.css';

// React.
import { useRef } from 'react';

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
	// Use undefined! instead of null to avoid optional chaining and so that an error is thrown if
	// the ref is accessed before it is assigned.
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// On project type selected, set the focus to the input element and notify the parent.
	const onSelected = () => {
		inputRef.current.focus();
		props.onSelected();
	};

	// Render.
	return (
		<div
			className={
				'folder-template' +
				(props.selected ? ' folder-template-selected' : '')
			}
			onClick={onSelected}
		>
			<div className='folder-template-icon'>
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
				ref={inputRef}
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
			/>
			<label htmlFor={props.identifier}>{props.identifier}</label>
		</div>
	);
};
