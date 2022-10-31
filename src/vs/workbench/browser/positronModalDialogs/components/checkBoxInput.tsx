/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./checkBoxInput';
import * as React from 'react';

export interface CheckBoxInputProps {
	label: string;
	checked: boolean;
	onChange: React.ChangeEventHandler<HTMLInputElement>;
}

export const CheckBoxInput: React.FC<CheckBoxInputProps> = (props: CheckBoxInputProps) => {
	return (
		<div className='positron-dialog-checkbox-input'>
			<label>
				<input type='checkbox' checked={props.checked} onChange={props.onChange} /> {props.label}
			</label>
		</div>
	);
};

