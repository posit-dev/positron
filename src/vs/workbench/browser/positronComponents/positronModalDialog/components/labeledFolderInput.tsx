/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./labeledFolderInput';

// React.
import * as React from 'react';
import { ChangeEventHandler } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';

// Other dependencies.
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { checkIfPathExists, checkIfPathValid } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/fileInputValidators';
import { useDebouncedValidator } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/useDebouncedValidator';
import { IFileService } from 'vs/platform/files/common/files';

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
					<input className='text-input' readOnly={props.readOnlyInput} placeholder={props.placeholder} type='text' value={props.value} onChange={props.onChange} maxLength={255} />
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
