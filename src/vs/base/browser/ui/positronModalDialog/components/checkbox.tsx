/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./checkbox';
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

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
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Click handler.
	const clickHandler = () => {
		buttonRef.current.setAttribute('aria-checked', !checked ? 'true' : 'false');
		setChecked(!checked);
		onChanged(!checked);
	};


	// Render.
	return (
		<div className='checkbox'>
			<button ref={buttonRef} id={id} className='checkbox-button' aria-checked='false' tabIndex={0} role='checkbox' onClick={clickHandler}>
				{checked && <div className='check-indicator codicon codicon-check' />}
			</button>
			<label htmlFor={id}>{label}</label>
		</div>
	);
};
