/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./directoryInput';
const React = require('react');

export interface DirectoryInputProps {
	label: string;
	value: string;
	onBrowse: VoidFunction;
	onChange: React.ChangeEventHandler<HTMLInputElement>;
}

export const DirectoryInput: React.FC<DirectoryInputProps> = (props: DirectoryInputProps) => {
	return (
		<div className='positron-dialog-directory-input'>
			<label>
				{props.label}: <br />
				<input
					readOnly
					type='text'
					value={props.value}
					onChange={props.onChange}
				/>
			</label>
			<button onClick={props.onBrowse}>
				Browse...
			</button>
		</div>
	);
};

