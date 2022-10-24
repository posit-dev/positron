/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./textInput';
const React = require('react');

export interface TextInputProps {
	label: string;
	value: string;
	onChange: React.ChangeEventHandler<HTMLInputElement>;
	autoFocus?: boolean;
}

export const TextInput: React.FC<TextInputProps> = (props: TextInputProps) => {
	return (
		<div className='positron-dialog-text-input'>
			<label>
				{props.label}: <br />
				<input
					type='text'
					value={props.value}
					autoFocus={props.autoFocus}
					onChange={props.onChange}
				/>
			</label>
		</div>
	);
};

