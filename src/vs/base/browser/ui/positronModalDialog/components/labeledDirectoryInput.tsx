/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./labeledDirectoryInput';
import * as React from 'react';
import { ChangeEventHandler } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * DirectoryInputProps interface.
 */
export interface DirectoryInputProps {
	label: string;
	value: string;
	onBrowse: VoidFunction;
	onChange: ChangeEventHandler<HTMLInputElement>;
}

/**
 * DirectoryInput component.
 * @param props A DirectoryInputProps that contains the component properties.
 * @returns The rendered component.
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

