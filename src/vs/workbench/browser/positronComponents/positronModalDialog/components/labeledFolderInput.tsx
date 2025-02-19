/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './labeledFolderInput.css';

// React.
import React, { ChangeEventHandler } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { checkIfPathExists, checkIfPathValid } from './fileInputValidators.js';
import { useDebouncedValidator } from './useDebouncedValidator.js';
import { IFileService } from '../../../../../platform/files/common/files.js';

/**
 * FolderInputProps interface.
 */
export interface LabeledFolderInputProps {
	label: string;
	value: string;
	error?: boolean;
	/**
	 * Custom error message. Will override the built-in validator error message if present.
	 */
	errorMsg?: string;
	/**
	 * Should validation be skipped? Defaults to false.
	 */
	skipValidation?: boolean;
	placeholder?: string;
	/**
	 * By default the user can type into the input field.
	 */
	readOnlyInput?: boolean;
	inputRef?: React.RefObject<HTMLInputElement>;
	onBrowse: VoidFunction;
	onChange: ChangeEventHandler<HTMLInputElement>;
}

interface LabeledExistingFolderInputProps extends LabeledFolderInputProps {
	mustExist: true;
	fileService: IFileService;
}

/**
 * LabeledFolderInput component.
 * @param props A LabeledFolderInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const LabeledFolderInput = ({ skipValidation = false, ...props }: LabeledFolderInputProps | LabeledExistingFolderInputProps) => {

	const validatorFn = skipValidation ?
		noOpValidator :
		'mustExist' in props ?
			(path: string | number) => checkIfPathExists(path, props.fileService) :
			checkIfPathValid;
	const validatorErrorMsg = useDebouncedValidator({ value: props.value, validator: validatorFn });
	const errorMsg = props.errorMsg || validatorErrorMsg;

	return (
		<div className='labeled-folder-input'>
			<label>
				{props.label}
				<div className='folder-input'>
					<input className='text-input' maxLength={255} placeholder={props.placeholder} readOnly={props.readOnlyInput} type='text' value={props.value} onChange={props.onChange} />
					<Button className='browse-button' onPressed={props.onBrowse}>
						{localize('positronFolderInputBrowse', 'Browse...')}
					</Button>
				</div>
				{errorMsg ? <span className='error error-msg'>{errorMsg}</span> : null}
			</label>
		</div>
	);
};

LabeledFolderInput.defaultProps = {
	readOnlyInput: false
};

function noOpValidator() { return undefined; }
