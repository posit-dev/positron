/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./checkbox';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * CheckboxProps interface.
 */
interface CheckboxProps {
	id: string;
	label: string;
	onChanged: (checked: boolean) => void;
}

// Toggle component.
export const Checkbox = ({ id, label, onChanged }: CheckboxProps) => {
	// Hooks.
	const [checked, setChecked] = useState(false);

	// Click handler.
	const clickHandler = () => {
		setChecked(!checked);
		onChanged(!checked);
	};


	// Render.
	return (
		<div className='checkbox'>
			<button id={id} className='checkbox-button' tabIndex={0} onClick={clickHandler}>
				{checked && <div className='check-indicator codicon codicon-check' />}
			</button>
			<label htmlFor={id}>{label}</label>
		</div>
	);
};
