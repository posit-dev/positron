/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./textInput';
import * as React from 'react';
import { forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports

export interface TextInputProps {
	label: string;
	value: string;
	onChange: React.ChangeEventHandler<HTMLInputElement>;
	autoFocus?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>((props: TextInputProps, ref) => {
	return (
		<div className='positron-dialog-text-input'>
			<label>
				{props.label}: <br />
				<input
					ref={ref}
					type='text'
					value={props.value}
					autoFocus={props.autoFocus}
					onChange={props.onChange}
				/>
			</label>
		</div>
	);
});

