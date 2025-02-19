/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkbox.css';

// React.
import React, { useRef, useState } from 'react';

// Other dependencies.
import { generateUuid } from '../../../../../base/common/uuid.js';

/**
 * CheckboxProps interface.
 */
interface CheckboxProps {
	label: string;
	initialChecked?: boolean;
	onChanged: (checked: boolean) => void;
}

// Toggle component.
export const Checkbox = ({ label, initialChecked, onChanged }: CheckboxProps) => {
	// Hooks.
	const [id] = useState(generateUuid());
	const [checked, setChecked] = useState(initialChecked ?? false);
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
			<button ref={buttonRef} aria-checked='false' className='checkbox-button' id={id} role='checkbox' tabIndex={0} onClick={clickHandler}>
				{checked && <div className='check-indicator codicon codicon-check' />}
			</button>
			<label htmlFor={id}>{label}</label>
		</div>
	);
};
