/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./labeledDirectoryInput';
import * as React from 'react';

/**
 * DirectoryInputProps interface.
 */
export interface DirectoryInputProps {
	label: string;
	value: string;
	onBrowse: VoidFunction;
	onChange: React.ChangeEventHandler<HTMLInputElement>;
}

/**
 * DirectoryInput component.
 * @param props The properties
 * @returns
 */
export const DirectoryInput = (props: DirectoryInputProps) => {
	return (
		<div className='labeled-directory-input'>
			<label>
				{props.label}:
				<div className='directory-input'>
					<input className='text-input' readOnly type='text' value={props.value} onChange={props.onChange} />
					<button className='button browse-button' tabIndex={0} onClick={props.onBrowse}>
						Browse...
					</button>
				</div>
			</label>
		</div>
	);
};

